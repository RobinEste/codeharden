import type { HardenChannelOptions } from "./channel-define.mjs";

/** The manifest's file name in the web app's public folder and in its build. */
export const MANIFEST_FILE: string;

/** `html` with the page title and the home-screen title set to `name`; throws when one is gone. */
export function titledHtml(html: string, name: string): string;

/** The web manifest `text` with `name` and `short_name` set to `name`. */
export function namedManifest(text: string, name: string): string;

/** The Vite plugin that names the page and the web manifest after this build's product. */
export function hardenWebIdentity(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): { name: string; transformIndexHtml(html: string): string; [hook: string]: unknown };
