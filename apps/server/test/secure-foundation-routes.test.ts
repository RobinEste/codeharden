import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { secureFoundationRoutes } from "../src/routes/secure-foundation";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import type { SecureFoundationService } from "../src/services/secure-foundation";

/**
 * The routes with the peer address injected the way `@hono/node-server` provides it, so a
 * request from another device can be told from one on this computer.
 */
const CLAIM = "https://dashboard.clerk.com/apps/claim?token=fixture";
const calls: unknown[] = [];
const verified: unknown[] = [];
const stub = {
  prefill: async () => ({ adminEmail: "person@site.test" }),
  finish: () => ({ clerkClaimUrl: CLAIM, deployedUrl: "https://my-site.vercel.app" }),
  verify: async (req: unknown) => {
    verified.push(req);
    return { checks: [], template: null };
  },
  create: async (req: unknown) => {
    calls.push(req);
    return { project: {}, sessionId: "s1", commit: "a".repeat(40) };
  },
} as unknown as SecureFoundationService;

const app = new Hono()
  .onError((e, c) => errorResponse(e, c))
  .route("/", secureFoundationRoutes({ secureFoundation: stub } as AppServices));

const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
const get = async (path: string, address: string) =>
  (await app.request(path, {}, from(address))).json();

describe("what is personal is answered on this computer only", () => {
  it("suggests the email locally and gives another device nothing", async () => {
    expect(await get("/prefill", "127.0.0.1")).toEqual({ adminEmail: "person@site.test" });
    expect(await get("/prefill", "192.168.1.20")).toEqual({ adminEmail: null });
  });

  it("gives the Clerk claim link locally and not to another device", async () => {
    expect(await get("/projects/p1/finish", "::1")).toEqual({
      clerkClaimUrl: CLAIM,
      deployedUrl: "https://my-site.vercel.app",
    });
    expect(await get("/projects/p1/finish", "100.101.102.103")).toEqual({
      clerkClaimUrl: null,
      deployedUrl: null,
    });
  });
});

describe("create validates the form on the server", () => {
  const post = (body: unknown) =>
    app.request(
      "/projects",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      from("127.0.0.1"),
    );
  const good = {
    name: "My Site",
    adminEmail: "person@site.test",
    provider: "alpha",
    commit: "a".repeat(40),
  };

  it.each([
    ["a path as the name", { ...good, name: "../x" }],
    ["an address without a dot", { ...good, adminEmail: "person@site" }],
    ["shell characters in the address", { ...good, adminEmail: 'a"$(id)@site.test' }],
    ["a placeholder address the install refuses", { ...good, adminEmail: "admin@example.com" }],
    ["an unknown secrets mode", { ...good, secrets: "vault" }],
    ["a module name that is a path", { ...good, shell: "pick", modules: ["../blog"] }],
    ["a short commit", { ...good, commit: "abc1234" }],
    ["no provider", { ...good, provider: undefined }],
  ])("refuses %s", async (_label, body) => {
    const before = calls.length;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(calls.length).toBe(before);
  });

  it("passes a valid form on with the defaults filled in", async () => {
    const res = await post(good);
    expect(res.status).toBe(201);
    expect(calls.at(-1)).toEqual({ ...good, secrets: "doppler", shell: "all", modules: [] });
  });

  it("refuses bad input on create whether or not it was verified first", async () => {
    // Verifying takes the form as it stands and reports on it...
    const bad = { ...good, name: "../x", adminEmail: "admin@example.com" };
    const checked = await app.request(
      "/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bad),
      },
      from("127.0.0.1"),
    );
    expect(checked.status).toBe(200);
    expect(verified.at(-1)).toMatchObject({ name: "../x" });
    // ...and a create that never asked, or didn't listen, is still refused before the service.
    const before = calls.length;
    expect((await post(bad)).status).toBe(400);
    expect((await post({ ...good, commit: undefined })).status).toBe(400);
    expect(calls.length).toBe(before);
  });
});
