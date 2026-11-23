import type { SettingsInput } from "@codeden/contracts";
import { describe, expect, it, vi } from "vitest";
import { withRoles } from "./support/role-env";

describe("role sessions: moving the orchestrator or a PM to another provider (§8.1)", () => {
  it(
    "retires the PM when its role's provider changes, and starts a fresh one on next use",
    withRoles(async ({ roles, repo, set, settle, stopped }) => {
      const first = await roles.ensure("pm", "p1");
      expect(first.provider).toBe("claude");
      // Its turn failed, e.g. "Not logged in".
      settle(first.id, "failed");

      await set({ providers: { pm: { provider: "codex" } } });

      expect(stopped).toEqual([first.id]);
      expect(repo.get(first.id).archivedAt).not.toBeNull();
      // The role shows as not started until its next message.
      expect(roles.find("pm", "p1")).toBeUndefined();
      expect(roles.refs().pms).toEqual({});

      const second = await roles.ensure("pm", "p1");
      expect(second.id).not.toBe(first.id);
      expect(second.provider).toBe("codex");
      expect(roles.refs().pms).toEqual({ p1: second.id });
      // Settled on the chosen provider: nothing more to retire.
      settle(second.id);
      await roles.applyProviderSettings();
      expect((await roles.ensure("pm", "p1")).id).toBe(second.id);
    }),
  );

  it(
    "leaves a session with a turn under way, and moves it when it is next used",
    withRoles(async ({ roles, repo, set, settle }) => {
      const first = await roles.ensure("orchestrator", null);
      settle(first.id, "running");
      await set({ providers: { orchestrator: { provider: "codex" } } });
      expect(repo.get(first.id).archivedAt).toBeNull();
      expect((await roles.ensure("orchestrator", null)).id).toBe(first.id);

      settle(first.id);
      const second = await roles.ensure("orchestrator", null);
      expect(second.provider).toBe("codex");
      expect(repo.get(first.id).archivedAt).not.toBeNull();
    }),
  );

  it(
    "leaves a session whose turn is on its way to the runner",
    withRoles(async ({ roles, repo, sessions, set, settle }) => {
      const first = await roles.ensure("pm", "p1");
      settle(first.id);
      // Idle in the database, but a message is being handed to the runner.
      const delivering = vi.spyOn(sessions, "isDelivering").mockReturnValue(true);
      await set({ providers: { pm: { provider: "codex" } } });
      expect(repo.get(first.id).archivedAt).toBeNull();
      expect((await roles.ensure("pm", "p1")).id).toBe(first.id);

      delivering.mockReturnValue(false);
      expect((await roles.ensure("pm", "p1")).provider).toBe("codex");
    }),
  );

  it(
    "dismisses the retired session's failed runs, whose Retry would bring it back",
    withRoles(async ({ roles, repo, inbox, set, settle }) => {
      const first = await roles.ensure("orchestrator", null);
      settle(first.id, "failed");
      const failed = inbox.raiseRunFailed(repo.get(first.id), "turn-1:failed", "Not logged in");
      expect(failed.status).toBe("open");

      await set({ providers: { orchestrator: { provider: "codex" } } });

      expect(repo.get(first.id).archivedAt).not.toBeNull();
      expect(inbox.get(failed.id)).toMatchObject({
        status: "dismissed",
        resolution: { reason: "moved to another provider" },
      });
    }),
  );

  it(
    "keeps the session for Auto, for the other role's setting and for a provider the runner lacks",
    withRoles(async ({ roles, repo, set, settle }) => {
      const pm = await roles.ensure("pm", "p1");
      settle(pm.id);
      for (const providers of [
        { pm: { provider: "auto" } },
        { orchestrator: { provider: "codex" }, agent: { provider: "codex" } },
        { pm: { provider: "gemini" } },
        { pm: { provider: "claude" } },
      ] satisfies SettingsInput["providers"][]) {
        await set({ providers });
        expect(repo.get(pm.id).archivedAt).toBeNull();
        expect((await roles.ensure("pm", "p1")).id).toBe(pm.id);
      }
    }),
  );
});
