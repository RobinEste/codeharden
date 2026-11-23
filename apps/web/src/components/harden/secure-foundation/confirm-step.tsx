import type { SecureFoundationOptions, SecureFoundationTemplate } from "@codeden/contracts";
import { Button } from "@/components/ui/button";
import { CREATED_STAYS, consentCreates, consentStatements } from "./consent";
import type { FormAnswers } from "./form-step";

/** The modules a form's answers install, as the server will work them out. */
function modulesOf(answers: FormAnswers, template: SecureFoundationTemplate): string[] {
  const names = template.modules.map((m) => m.name);
  if (answers.shell === "minimal") return [];
  return answers.shell === "all" ? names : names.filter((n) => answers.modules.includes(n));
}

/** Step 2: what will happen, in plain sentences. Nothing has been created yet. */
export function ConfirmStep({
  options,
  template,
  answers,
  moved,
  busy,
  error,
  onBack,
  onCancel,
  onConfirm,
}: {
  options: SecureFoundationOptions;
  template: SecureFoundationTemplate;
  answers: FormAnswers;
  /** The template gained a commit after it was first shown. */
  moved: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const provider = options.providers.find((p) => p.id === answers.provider);
  if (!provider) return null;
  const input = {
    ...options,
    name: answers.name.trim(),
    secrets: answers.secrets,
    convexTeam: answers.convexTeam,
    modules: modulesOf(answers, template),
    provider,
    template,
  };
  return (
    <div className="space-y-4" data-testid="secure-foundation-confirm">
      {moved && (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs"
          role="alert"
        >
          The template changed while you were reading. The commit below is the new one: check it and
          confirm again.
        </p>
      )}
      <div>
        <h3 className="mb-1.5 text-xs font-medium">What happens when you confirm</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-xs leading-snug">
          {consentStatements(input).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1.5 text-xs font-medium">What is created in your accounts</h3>
        <ul className="space-y-1.5 text-xs leading-snug">
          {consentCreates(input).map((c) => (
            <li key={c.service}>
              <span className="font-medium">{c.service}:</span> {c.item}.{" "}
              <span className="text-muted-foreground">Remove it in {c.removeAt}.</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-muted-foreground">{CREATED_STAYS}</p>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          data-testid="secure-foundation-confirm-button"
        >
          {busy ? "Cloning…" : "Create project and start setup"}
        </Button>
      </div>
    </div>
  );
}
