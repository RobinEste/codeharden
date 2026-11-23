import {
  CreateSecureFoundationRequest,
  SECURE_FOUNDATION_TEMPLATE_MOVED,
  type SecureFoundationOptions,
  type Snapshot,
} from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/api/http";
import { snapshotKey } from "@/lib/queries";
import { withCreatedProject } from "@/lib/snapshot-reducer";
import { useUiStore } from "@/stores/ui";
import { ConfirmStep } from "./confirm-step";
import { ConnectionsStep } from "./connections-step";
import {
  SECURE_FOUNDATION_SUBTITLE,
  SECURE_FOUNDATION_TITLE,
  secureFoundationDocsUrl,
} from "./copy";
import { type FormAnswers, FormStep } from "./form-step";
import { useSecureFoundationPrefill, useSecureFoundationTemplate } from "./use-secure-foundation";

/**
 * The Secure Foundation form: answers first, then a confirm step that says what will happen.
 * Nothing is created until the person confirms; closing it at any point leaves nothing behind.
 */
export function SecureFoundationDialog({
  options,
  onClose,
}: {
  options: SecureFoundationOptions;
  onClose: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeAddProject = useUiStore((s) => s.setAddProjectOpen);
  const template = useSecureFoundationTemplate(true);
  const prefill = useSecureFoundationPrefill(true);
  const [step, setStep] = useState<"form" | "connections" | "confirm">("form");
  const [moved, setMoved] = useState(false);
  const [answers, setAnswers] = useState<FormAnswers>({
    name: "",
    adminEmail: "",
    emailTouched: false,
    secrets: options.defaults.secrets,
    shell: options.defaults.shell,
    modules: [],
    provider: options.providers[0]?.id ?? "",
  });
  // The suggestion fills the field once, and only while the person hasn't typed in it.
  const suggested = prefill.data?.adminEmail;
  useEffect(() => {
    if (suggested)
      setAnswers((a) => (a.emailTouched || a.adminEmail ? a : { ...a, adminEmail: suggested }));
  }, [suggested]);

  const create = useMutation({
    mutationFn: () =>
      client.secureFoundation.create(
        CreateSecureFoundationRequest.parse({
          name: answers.name,
          adminEmail: answers.adminEmail,
          secrets: answers.secrets,
          shell: answers.shell,
          modules: answers.shell === "pick" ? answers.modules : [],
          provider: answers.provider,
          commit: template.data?.commit,
          convexTeam: answers.convexTeam,
        }),
      ),
    onSuccess: ({ project, sessionId }) => {
      queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
        s ? withCreatedProject(s, project) : s,
      );
      onClose();
      closeAddProject(false);
      void navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    },
    onError: (error) => {
      // The template gained a commit since it was shown: show the new one and ask again.
      if (error instanceof ApiRequestError && error.code === SECURE_FOUNDATION_TEMPLATE_MOVED) {
        setMoved(true);
        void template.refetch();
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
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
        {step === "form" ? (
          <FormStep
            options={options}
            template={template.data}
            templateError={template.error?.message ?? null}
            onRetryTemplate={() => void template.refetch()}
            answers={answers}
            onChange={setAnswers}
            onNext={() => setStep("connections")}
            onCancel={onClose}
          />
        ) : step === "connections" ? (
          <ConnectionsStep
            answers={answers}
            onChange={setAnswers}
            onBack={() => setStep("form")}
            onCancel={onClose}
            onNext={() => {
              create.reset();
              setStep("confirm");
            }}
          />
        ) : (
          template.data && (
            <ConfirmStep
              options={options}
              template={template.data}
              answers={answers}
              moved={moved}
              busy={create.isPending || template.isFetching}
              error={moved ? null : (create.error?.message ?? null)}
              onBack={() => setStep("connections")}
              onCancel={onClose}
              onConfirm={() => {
                setMoved(false);
                create.mutate();
              }}
            />
          )
        )}
        <DialogFooter className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
