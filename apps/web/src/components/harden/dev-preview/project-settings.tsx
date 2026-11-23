import { type DevPreviewSettings, hardenDocsUrl, type Project } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Segmented, SettingRow, SettingsSection } from "@/components/settings/settings-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";
import { formChanged, formOf, type PreviewForm, settingsOf } from "./form";
import { devPreviewKey } from "./use-dev-preview";

const mono = "h-8 font-mono text-xs";

/**
 * Project page > Settings > Dev preview: the commands the app may run for this project.
 * They are typed here and nowhere else, and Save asks before it stores them: nothing is ever
 * taken from the repository. On another device the form is read-only.
 */
export function DevPreviewProjectSettings({ project }: { project: Project }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const key = [...devPreviewKey, "project", project.id] as const;
  const view = useQuery({ queryKey: key, queryFn: () => client.devPreview.project(project.id) });
  const config = view.data?.config ?? null;
  const [form, setForm] = useState<PreviewForm>(formOf(null));
  const [asking, setAsking] = useState<DevPreviewSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const confirmedAt = config?.confirmedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when what is stored changes
  useEffect(() => setForm(formOf(config)), [confirmedAt, config?.pmEnabled]);

  const stored = () => {
    void queryClient.invalidateQueries({ queryKey: devPreviewKey });
    setAsking(null);
  };
  const save = useMutation({
    mutationFn: (settings: DevPreviewSettings) =>
      client.devPreview.confirmProject(project.id, settings),
    onSuccess: () => {
      stored();
      toast.success("Dev preview saved");
    },
    onError: (e) => toast.error("Dev preview not saved", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: () => client.devPreview.removeProject(project.id),
    onSuccess: stored,
    onError: (e) => toast.error("Dev preview not removed", { description: e.message }),
  });

  if (!view.data) return null;
  const { remote, suggestion, baseBranch } = view.data;
  const set = (patch: Partial<PreviewForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setProblem(null);
  };
  const ask = () => {
    const result = settingsOf(form);
    if (result.ok) setAsking(result.settings);
    else setProblem(result.problem);
  };

  return (
    <div data-testid="dev-preview-settings">
      <SettingsSection
        title="Dev preview"
        description="Run this project's dev server for a session, in that session's own worktree, so the page reloads as the agent works. The PM thread gets one for the base branch."
      >
        <SettingRow
          label="Dev command"
          stacked
          help={
            <>
              Your shell runs it in the worktree, with free local ports in the variables below. You
              can also write <code>{"{port}"}</code> and <code>{"{port2}"}</code> in the command.{" "}
              <code>HOST=127.0.0.1</code> is passed too, but the dev server listens however this
              command makes it listen: keep it on this computer.{" "}
              <a
                href={hardenDocsUrl("dev-preview.md")}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                How it works
              </a>
            </>
          }
        >
          <Input
            aria-label="Dev command"
            data-testid="dev-preview-command"
            className={mono}
            placeholder="pnpm dev"
            value={form.command}
            disabled={remote}
            onChange={(e) => set({ command: e.target.value })}
          />
          {suggestion && !config && !form.command && !remote && (
            <p className="text-2xs text-muted-foreground" data-testid="dev-preview-suggestion">
              This project looks like it uses <code>{suggestion.command}</code> ({suggestion.reason}
              ).{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => set({ command: suggestion.command })}
              >
                Fill it in
              </button>
            </p>
          )}
        </SettingRow>
        <SettingRow
          label="Prepare command"
          stacked
          help="Optional. Runs before the first start in a worktree and again when its lockfile changes: a fresh worktree has no installed dependencies."
        >
          <Input
            aria-label="Prepare command"
            data-testid="dev-preview-prepare"
            className={mono}
            placeholder="pnpm install --frozen-lockfile"
            value={form.prepareCommand}
            disabled={remote}
            onChange={(e) => set({ prepareCommand: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Port variables"
          help="Each gets a free port. The first is the one the link opens."
        >
          <Input
            aria-label="Port variables"
            data-testid="dev-preview-port-vars"
            className={`${mono} w-56`}
            placeholder="PORT"
            value={form.portVars}
            disabled={remote}
            onChange={(e) => set({ portVars: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Link"
          stacked={form.urlFrom === "output"}
          help={
            form.urlFrom === "port"
              ? "http://localhost on the first port, once something answers there."
              : "The first local URL the command prints, once something answers there. For dev servers that pick their own port. A pattern narrows it down: its first group is the URL."
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<PreviewForm["urlFrom"]>
              value={form.urlFrom}
              onChange={(urlFrom) => !remote && set({ urlFrom })}
              options={[
                { value: "port", label: "First port", disabled: remote },
                { value: "output", label: "From the output", disabled: remote },
              ]}
            />
            {form.urlFrom === "output" && (
              <Input
                aria-label="URL pattern"
                className={`${mono} w-64`}
                placeholder="Local:\s+(\S+)"
                value={form.urlPattern}
                disabled={remote}
                onChange={(e) => set({ urlPattern: e.target.value })}
              />
            )}
          </div>
        </SettingRow>
        <SettingRow
          label="On the PM thread"
          help={`Keep a preview of ${baseBranch ? `the base branch (${baseBranch})` : "the base branch"} running from a checkout of its own, updated as the branch moves.`}
        >
          <Switch
            aria-label="Dev preview on the PM thread"
            data-testid="dev-preview-pm"
            checked={form.pmEnabled}
            disabled={remote}
            onCheckedChange={(pmEnabled) => set({ pmEnabled })}
          />
        </SettingRow>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
          {remote ? (
            <p className="text-2xs text-muted-foreground" data-testid="dev-preview-remote">
              Set this up on the computer running the app.
            </p>
          ) : (
            <>
              <Button
                size="sm"
                onClick={ask}
                disabled={save.isPending || !formChanged(form, config)}
                data-testid="dev-preview-save"
              >
                {config ? "Save changes…" : "Save…"}
              </Button>
              {config && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  data-testid="dev-preview-remove"
                >
                  Remove
                </Button>
              )}
            </>
          )}
          {problem && (
            <span className="text-2xs text-status-failed" role="alert">
              {problem}
            </span>
          )}
          <span className="ml-auto text-2xs text-muted-foreground">
            {config
              ? `Confirmed ${new Date(config.confirmedAt).toLocaleString()}`
              : "Nothing runs until you save a command."}
          </span>
        </div>
      </SettingsSection>
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent data-testid="dev-preview-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Run these commands on this computer?</AlertDialogTitle>
            <AlertDialogDescription>
              The app will run them as you, in this project's worktrees, whenever a preview starts.
              Running previews stop now and start again with the new commands.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-xs">
            <Shown label="Dev command" command={asking?.command} />
            {asking?.prepareCommand && (
              <Shown label="Prepare command" command={asking.prepareCommand} />
            )}
            <p className="text-2xs text-muted-foreground">
              Ports go in {asking?.portVars.join(", ")}.{" "}
              {asking?.pmEnabled
                ? "A preview of the base branch starts for the PM thread."
                : "No preview starts for the PM thread."}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="dev-preview-confirm-run"
              disabled={save.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (asking) save.mutate(asking);
              }}
            >
              Save and allow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Shown({ label, command }: { label: string; command: string | undefined }) {
  return (
    <div>
      <div className="mb-1 text-2xs text-muted-foreground">{label}</div>
      <pre className="overflow-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap wrap-anywhere">
        {command}
      </pre>
    </div>
  );
}
