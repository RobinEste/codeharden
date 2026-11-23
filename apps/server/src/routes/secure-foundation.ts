import {
  CreateSecureFoundationRequest,
  type CreateSecureFoundationResponse,
  type SecureFoundationFinish,
  type SecureFoundationOptions,
  type SecureFoundationPrefill,
  type SecureFoundationTemplate,
} from "@codeden/contracts";
import { Hono } from "hono";
import { isRemoteRequest } from "../security";
import type { AppServices } from "../services/container";
import { jsonBody } from "./validate";

/**
 * `/api/secure-foundation`: the add-project option that creates a project from the build's
 * template and starts its setup session (`docs/secure-foundation.md`). Behind the same sign-in
 * as every other route. What is personal (the suggested email, the Clerk claim link) is only
 * answered on this computer: another device gets nulls, never an error.
 */
export function secureFoundationRoutes(s: AppServices) {
  const sf = s.secureFoundation;
  return new Hono()
    .get("/", async (c) => c.json<SecureFoundationOptions>(await sf.options()))
    .get("/prefill", async (c) =>
      c.json<SecureFoundationPrefill>(
        isRemoteRequest(c) ? { adminEmail: null } : await sf.prefill(),
      ),
    )
    .post("/template", async (c) => c.json<SecureFoundationTemplate>(await sf.template()))
    .post("/projects", jsonBody(CreateSecureFoundationRequest), async (c) =>
      c.json<CreateSecureFoundationResponse>(await sf.create(c.req.valid("json")), 201),
    )
    .get("/projects/:id/finish", (c) =>
      c.json<SecureFoundationFinish>(
        isRemoteRequest(c) ? { clerkClaimUrl: null } : sf.finish(c.req.param("id")),
      ),
    );
}
