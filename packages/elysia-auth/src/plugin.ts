import { Elysia } from "elysia";

import { createNTAuthClient, type NTAuthClientOptions } from "./client";
import { NTAuthError } from "./errors";

export function ntauth(options: NTAuthClientOptions) {
  const client = createNTAuthClient(options);
  return new Elysia({ name: "@neotamia/elysia-auth" })
    .decorate("ntauthClient", client)
    .derive({ as: "scoped" }, async ({ request }) => ({ auth: await client.authenticate(request) }))
    .onError({ as: "scoped" }, ({ error }) => {
      if (error instanceof NTAuthError) return error.toResponse();
    });
}
