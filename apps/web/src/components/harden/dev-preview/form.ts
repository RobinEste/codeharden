import {
  DEV_PREVIEW_DEFAULT_PORT_VAR,
  type DevPreviewConfig,
  DevPreviewSettings,
} from "@codeden/contracts";

/** The settings form as the person types it. */
export interface PreviewForm {
  command: string;
  prepareCommand: string;
  /** Comma-separated, as typed. */
  portVars: string;
  urlFrom: "port" | "output";
  urlPattern: string;
  pmEnabled: boolean;
}

export function formOf(config: DevPreviewConfig | null): PreviewForm {
  return {
    command: config?.command ?? "",
    prepareCommand: config?.prepareCommand ?? "",
    portVars: (config?.portVars ?? [DEV_PREVIEW_DEFAULT_PORT_VAR]).join(", "),
    urlFrom: config?.urlFrom ?? "port",
    urlPattern: config?.urlPattern ?? "",
    pmEnabled: config?.pmEnabled ?? true,
  };
}

const FIELD: Record<string, string> = {
  command: "Dev command",
  prepareCommand: "Prepare command",
  portVars: "Port variables",
  urlPattern: "URL pattern",
};

/** The form as settings to confirm, or what is wrong with it. */
export function settingsOf(
  form: PreviewForm,
): { ok: true; settings: DevPreviewSettings } | { ok: false; problem: string } {
  if (!form.command.trim()) return { ok: false, problem: "Enter the dev command." };
  const parsed = DevPreviewSettings.safeParse({
    command: form.command,
    prepareCommand: form.prepareCommand.trim() ? form.prepareCommand : null,
    portVars: form.portVars
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter(Boolean),
    urlFrom: form.urlFrom,
    urlPattern: form.urlFrom === "output" && form.urlPattern.trim() ? form.urlPattern : null,
    pmEnabled: form.pmEnabled,
  });
  if (parsed.success) return { ok: true, settings: parsed.data };
  const issue = parsed.error.issues[0];
  const field = FIELD[String(issue?.path[0] ?? "")] ?? "Settings";
  return { ok: false, problem: `${field}: ${issue?.message ?? "not valid"}` };
}

/** Does the form differ from what is stored? */
export function formChanged(form: PreviewForm, config: DevPreviewConfig | null): boolean {
  return JSON.stringify(form) !== JSON.stringify(formOf(config));
}
