import { Elysia } from "elysia";

import { ntauth, type NTAuthClientOptions } from "@neotamia/elysia-auth";

export function createExampleResourceServer(options: NTAuthClientOptions) {
  return new Elysia().use(ntauth(options)).get("/reports/:id", ({ auth, params, status }) => {
    const decision = auth.authorize({
      action: "ntscout:report:read",
      resource: `ntscout:report:${params.id}`,
    });
    if (!decision.allowed) return status(403, { decision: decision.reason });
    return {
      id: params.id,
      organizationId: auth.organizationId,
      subject: auth.identity.id,
    };
  });
}
