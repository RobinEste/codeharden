import { execFileSync } from "node:child_process";
import {
  CreateSecureFoundationRequest,
  isSecureFoundationSetup,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SecureFoundationOptions,
  type Session,
  secureFoundationStatus,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sameRealPath } from "../src/services/projects/detect";
import { createSecureFoundation } from "../src/services/secure-foundation";
import { type Harness, startHarness, waitUntil } from "./support/harness";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

/**
 * Secure Foundation end to end on a real server and runner with the Fake provider: the project
 * made from the fixture template, and its setup session running in the project folder.
 */
const EMAIL = "person@site.test";
let h: Harness;
let fixture: TemplateFixture;

beforeAll(async () => {
  fixture = makeTemplateFixture();
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
  await removeTree(fixture.root);
});

const SETTLED = new Set(["idle", "failed", "stopped", "completed", "interrupted"]);

describe("Secure Foundation with the Fake provider", () => {
  it("is behind the sign-in like every other route", async () => {
    const res = await fetch(`${h.server.url}/api/secure-foundation`);
    expect(res.status).toBe(401);
    const post = await fetch(`${h.server.url}/api/secure-foundation/projects`, { method: "POST" });
    expect(post.status).toBe(401);
  });

  it("offers the option with the signed-in providers", async () => {
    const options = SecureFoundationOptions.parse((await h.api("GET", "/secure-foundation")).body);
    expect(options.enabled).toBe(true);
    expect(options.providers.map((p) => p.id)).toContain("fake");
    expect(options.providers.find((p) => p.id === "fake")?.runsCommandFiles).toBe(false);
    expect(options.autonomy).toBe(SECURE_FOUNDATION_SETUP_AUTONOMY);
  });

  it("creates the project and runs its setup session in the project folder", async () => {
    const s = h.server.services;
    const service = createSecureFoundation({
      exec: (await import("../src/services/exec")).runTool,
      projectsDir: `${h.home}/made`,
      projects: s.projects,
      sessions: () => s.sessions,
      runner: s.runner,
      setup: s.setup,
      template: fixture.source,
    });
    const seqBefore = s.store.headSeq();
    const template = await service.template();
    await service.prefill();
    // Resolving and prefilling write nothing to the event log.
    expect(s.store.headSeq()).toBe(seqBefore);

    const result = await service.create(
      CreateSecureFoundationRequest.parse({
        name: "Flow Site",
        adminEmail: EMAIL,
        secrets: "env_local",
        provider: "fake",
        commit: template.commit,
      }),
    );
    expect(result.project.name).toBe("Flow Site");
    expect(result.project.kind).toBe("local");
    expect(result.project.isGitRepo).toBe(true);
    const count = execFileSync("git", ["-C", result.project.path, "rev-list", "--count", "HEAD"], {
      encoding: "utf8",
    });
    expect(count.trim()).toBe("1");

    const session: Session = await waitUntil(() => {
      const found = s.sessionRepo.get(result.sessionId);
      return SETTLED.has(found.status) && !s.sessions.launching.has(found.id) ? found : undefined;
    });
    expect(session.status).toBe("idle");
    expect(isSecureFoundationSetup(session)).toBe(true);
    expect(session.autonomy).toBe(SECURE_FOUNDATION_SETUP_AUTONOMY);
    expect(session.worktreePath).toBeNull();
    expect(sameRealPath(session.cwd, result.project.path)).toBe(true);
    // The Fake provider reports no progress: between turns the status asks the person to look.
    expect(secureFoundationStatus(session)).toEqual({ phase: "waiting", url: null });

    // The email is in the brief (the session's first message, which the Fake provider echoes)
    // and nowhere else: not in the project, the session's row or any event outside its transcript.
    expect(JSON.stringify([result.project, session])).not.toContain(EMAIL);
    const mentioning = s.store
      .listAfter(seqBefore, 100_000)
      .filter((e) => JSON.stringify(e).includes(EMAIL));
    expect(mentioning.length).toBeGreaterThan(0);
    for (const event of mentioning) {
      expect(event.sessionId).toBe(result.sessionId);
      expect(event.type.startsWith("agent."), event.type).toBe(true);
    }
  });
});
