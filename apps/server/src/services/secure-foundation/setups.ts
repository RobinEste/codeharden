import { chmodSync } from "node:fs";
import { join } from "node:path";
import {
  SECURE_FOUNDATION_NO_DEV_PREVIEW,
  type SecureFoundationDevPreview,
  type SecureFoundationSecrets,
  SecureFoundationSetupRecord,
  secureFoundationDevPreview,
  secureFoundationSetupRecord,
} from "@codeden/contracts";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";

/**
 * What the app keeps about the projects Secure Foundation created:
 * `<home>/secure-foundation.json`, by project id. It holds the answers of the setup form that a
 * dev preview depends on (the secrets mode, and with Doppler the project and config names made
 * from the project's name). Names only: no secret is ever written here.
 *
 * The only writer is `SecureFoundationService.create`, with the form the person confirmed with
 * Go. The only reader is the suggestion for the dev preview's settings form
 * (`secureFoundationDevPreview`), which a person still has to save and confirm there. The file
 * sits in the app's home, which agents are kept out of like the app's other files.
 */
const StoreFile = z.object({ projects: z.record(z.string(), z.unknown()).default({}) });

export class SecureFoundationSetups {
  private readonly file: string;
  private readonly records = new Map<string, SecureFoundationSetupRecord>();

  constructor(home: string) {
    this.file = join(home, "secure-foundation.json");
    const parsed = StoreFile.safeParse(readJsonFile(this.file));
    if (!parsed.success) return;
    for (const [projectId, raw] of Object.entries(parsed.data.projects)) {
      // An entry this build can't read is treated as never kept.
      const record = SecureFoundationSetupRecord.safeParse(raw);
      if (record.success) this.records.set(projectId, record.data);
    }
  }

  /** What was kept for the project; null for any other project, and for one made earlier. */
  get(projectId: string): SecureFoundationSetupRecord | null {
    return this.records.get(projectId) ?? null;
  }

  /**
   * Keep the answers of a setup that was just created. It never throws: a project whose
   * answers couldn't be written is, after a restart, offered what a project made before
   * anything was kept is offered, and its setup is not failed over that.
   */
  record(
    projectId: string,
    answers: { name: string; secrets: SecureFoundationSecrets },
    at: Date,
  ): SecureFoundationSetupRecord {
    const record = secureFoundationSetupRecord(answers, at);
    this.records.set(projectId, record);
    try {
      writeJsonFile(this.file, { projects: Object.fromEntries(this.records) }, 0o600);
      chmodSync(this.file, 0o600);
    } catch {
      // Not written (or, on Windows, not narrowed: the profile's own access rules apply).
    }
    return record;
  }
}

/**
 * What the dev preview's settings form is filled with for a project
 * (`secureFoundationDevPreview`): a suggestion, built from what was kept when it was created.
 * `setUp` says whether the project has a setup session, for one made before anything was kept;
 * any other project gets nothing. It stores nothing and starts nothing: the form's own Save and
 * its confirmation do.
 */
export function devPreviewOffer(
  setups: Pick<SecureFoundationSetups, "get"> | undefined,
  projectId: string,
  known: { setUp: () => boolean; baseCheckout: string | null },
): SecureFoundationDevPreview {
  const kept = setups?.get(projectId) ?? null;
  if (!kept && !known.setUp()) return SECURE_FOUNDATION_NO_DEV_PREVIEW;
  return secureFoundationDevPreview(kept, { baseCheckout: known.baseCheckout });
}
