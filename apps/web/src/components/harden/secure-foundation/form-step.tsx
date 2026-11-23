import {
  SecureFoundationEmail,
  SecureFoundationName,
  type SecureFoundationOptions,
  type SecureFoundationSecrets,
  type SecureFoundationShell,
  type SecureFoundationTemplate,
} from "@codeden/contracts";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { projectPath } from "./consent";

export interface FormAnswers {
  name: string;
  adminEmail: string;
  /** The person typed in the email field: a late suggestion must not replace it. */
  emailTouched: boolean;
  secrets: SecureFoundationSecrets;
  shell: SecureFoundationShell;
  modules: string[];
  provider: string;
}

const SECRETS: Array<[SecureFoundationSecrets, string, string]> = [
  [
    "doppler",
    "Doppler",
    "Secrets live in a Doppler project. Needs the Doppler CLI installed and signed in on this computer.",
  ],
  [
    "env_local",
    ".env.local",
    "Secrets are written to a file in the project folder that git ignores. Nothing else to set up.",
  ],
];

const SHELLS: Array<[SecureFoundationShell, string, string]> = [
  ["minimal", "Minimal", "Login homepage and a blank dashboard. Add modules later."],
  ["all", "All modules", "Every content module the template has."],
  ["pick", "Pick", "Choose the content modules to install now."],
];

function Choice({
  name,
  checked,
  onSelect,
  title,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-2 rounded-lg border p-2.5 text-left transition-colors",
        checked ? "border-primary/50 bg-primary/[0.06]" : "border-border hover:bg-accent/40",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5" />
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-2xs leading-snug text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={htmlFor} className="text-xs">
      {label}
    </Label>
    {children}
  </div>
);

/** Step 1: everything the install would otherwise ask, collected up front. */
export function FormStep({
  options,
  template,
  templateError,
  onRetryTemplate,
  answers,
  onChange,
  onNext,
  onCancel,
}: {
  options: SecureFoundationOptions;
  template: SecureFoundationTemplate | undefined;
  templateError: string | null;
  onRetryTemplate: () => void;
  answers: FormAnswers;
  onChange: (next: FormAnswers) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<FormAnswers>) => onChange({ ...answers, ...patch });
  const name = SecureFoundationName.safeParse(answers.name);
  const email = SecureFoundationEmail.safeParse(answers.adminEmail);
  const path = name.success ? projectPath({ ...options, name: name.data }) : "";
  const pickOk = answers.shell !== "pick" || Boolean(template);
  const ready =
    name.success && email.success && Boolean(answers.provider) && Boolean(template) && pickOk;
  const provider = options.providers.find((p) => p.id === answers.provider);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onNext();
      }}
    >
      <Field label="Project name" htmlFor="sf-name">
        <Input
          id="sf-name"
          value={answers.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="My Site"
          maxLength={60}
          autoFocus
        />
        <p className="text-2xs text-muted-foreground" data-testid="secure-foundation-path">
          {answers.name && !name.success
            ? "Use letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit."
            : path
              ? `Also the site's name. Created in ${path}`
              : "Also the site's name and, in lower case with dashes, the folder's."}
        </p>
      </Field>
      <Field label="Admin email" htmlFor="sf-email">
        <Input
          id="sf-email"
          type="email"
          value={answers.adminEmail}
          onChange={(e) => set({ adminEmail: e.target.value, emailTouched: true })}
          placeholder="you@your-domain.com"
          autoComplete="off"
        />
        <p className="text-2xs text-muted-foreground">
          {answers.adminEmail && !email.success
            ? "Enter a real email address: the install refuses placeholders."
            : "Who signs in as the site's admin. Suggested from git on this computer when it has one; it goes to the install and nowhere else."}
        </p>
      </Field>
      <Field label="Secrets">
        <div className="grid gap-2 sm:grid-cols-2">
          {SECRETS.map(([id, title, text]) => (
            <Choice
              key={id}
              name="sf-secrets"
              title={title}
              checked={answers.secrets === id}
              onSelect={() => set({ secrets: id })}
            >
              {text}
            </Choice>
          ))}
        </div>
      </Field>
      <Field label="App shell">
        <div className="grid gap-2 sm:grid-cols-3">
          {SHELLS.map(([id, title, text]) => (
            <Choice
              key={id}
              name="sf-shell"
              title={title}
              checked={answers.shell === id}
              onSelect={() => set({ shell: id })}
            >
              {text}
            </Choice>
          ))}
        </div>
        {answers.shell === "pick" && (
          <div className="space-y-1 pt-1">
            {(template?.modules ?? []).map((m) => (
              <label key={m.name} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={answers.modules.includes(m.name)}
                  onChange={(e) =>
                    set({
                      modules: e.target.checked
                        ? [...answers.modules, m.name]
                        : answers.modules.filter((n) => n !== m.name),
                    })
                  }
                />
                <span>
                  <span className="font-medium">{m.title}</span>{" "}
                  <span className="text-muted-foreground">{m.description}</span>
                </span>
              </label>
            ))}
            {template && template.modules.length === 0 && (
              <p className="text-2xs text-muted-foreground">
                This template has no content modules.
              </p>
            )}
          </div>
        )}
      </Field>
      <Field label="Runs on" htmlFor="sf-provider">
        {options.providers.length > 1 ? (
          <select
            id="sf-provider"
            value={answers.provider}
            onChange={(e) => set({ provider: e.target.value })}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px]"
          >
            {options.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[13px]">{provider?.displayName ?? "No signed-in provider"}</p>
        )}
        <p className="text-2xs text-muted-foreground">
          {!provider
            ? "Sign an agent provider in under Settings › Providers first."
            : provider.runsCommandFiles
              ? "The setup session runs the template's /install command."
              : "This provider doesn't run command files: the setup session reads the template's install instructions and follows them."}
        </p>
      </Field>
      {templateError ? (
        <p className="text-xs text-destructive" role="alert">
          The template couldn't be reached: {templateError}{" "}
          <button type="button" className="underline" onClick={onRetryTemplate}>
            Try again
          </button>
        </p>
      ) : (
        !template && (
          <p className="text-2xs text-muted-foreground">Looking up the template's latest commit…</p>
        )
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready}>
          Review
        </Button>
      </div>
    </form>
  );
}
