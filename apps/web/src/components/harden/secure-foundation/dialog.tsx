import type { SecureFoundationOptions, Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { snapshotKey } from "@/lib/queries";
import { withCreatedProject } from "@/lib/snapshot-reducer";
import { useUiStore } from "@/stores/ui";
import {
  SECURE_FOUNDATION_SUBTITLE,
  SECURE_FOUNDATION_TITLE,
  secureFoundationDocsUrl,
} from "./copy";
import { type FormAnswers, FormStep } from "./form-step";
import { useGo } from "./use-go";
import {
  secureFoundationKey,
  useSecureFoundationPrefill,
  useSecureFoundationTemplate,
} from "./use-secure-foundation";
import { VerifyStep } from "./verify-step";

/**
 * Secure Foundation: one form with a Go button, and a verification view beside it. Go checks
 * everything first and creates only when it all holds; otherwise it opens the verification view
 * on what stopped it. Closing the dialog at any point leaves nothing behind.
 */
export function SecureFoundationDialog({
  options,
  onClose,
}: {
  options: SecureFoundationOptions;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeAddProject = useUiStore((s) => s.setAddProjectOpen);
  const template = useSecureFoundationTemplate(true);
  const prefill = useSecureFoundationPrefill(true);
  const [view, setView] = useState<"form" | "verify">("form");
  /** The verification view was opened by a Go that created nothing. */
  const [stopped, setStopped] = useState(false);
  const [answers, setAnswers] = useState<FormAnswers>({
    name: "",
    adminEmail: "",
    emailTouched: false,
    secrets: options.defaults.secrets,
    shell: options.defaults.shell,
    modules: [],
    provider: options.providers[0]?.id ?? "",
    deploy: options.defaults.deploy,
  });
  // The suggestion fills the field once, and only while the person hasn't typed in it.
  const suggested = prefill.data?.adminEmail;
  useEffect(() => {
    if (suggested)
      setAnswers((a) => (a.emailTouched || a.adminEmail ? a : { ...a, adminEmail: suggested }));
  }, [suggested]);

  const go = useGo({
    answers,
    setAnswers,
    shownCommit: template.data?.commit,
    onTemplate: (now) => queryClient.setQueryData([...secureFoundationKey, "template"], now),
    onCreated: ({ project, sessionId }) => {
      queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
        s ? withCreatedProject(s, project) : s,
      );
      onClose();
      closeAddProject(false);
      void navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    },
  });
  const press = (from: "form" | "view") => {
    void go.go(from).then((created) => {
      if (created) return;
      setStopped(true);
      setView("verify");
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && go.busy !== "creating" && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-testid="secure-foundation-dialog"
      >
        <DialogHeader>
          <DialogTitle>{SECURE_FOUNDATION_TITLE}</DialogTitle>
          <DialogDescription>
            {SECURE_FOUNDATION_SUBTITLE}{" "}
            <a
              href={secureFoundationDocsUrl()}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              What this does
            </a>
          </DialogDescription>
        </DialogHeader>
        {view === "form" ? (
          <FormStep
            options={options}
            template={template.data}
            templateError={template.error?.message ?? null}
            onRetryTemplate={() => void template.refetch()}
            answers={answers}
            onChange={setAnswers}
            busy={go.busy}
            onGo={() => press("form")}
            onVerify={() => {
              setStopped(false);
              setView("verify");
              void go.check();
            }}
            onCancel={onClose}
          />
        ) : (
          <VerifyStep
            options={options}
            template={template.data}
            answers={answers}
            onChange={setAnswers}
            go={go}
            stopped={stopped}
            onGo={() => press("view")}
            onBack={() => setView("form")}
            onCancel={onClose}
          />
        )}
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
