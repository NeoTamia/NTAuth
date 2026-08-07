# NTScout OAuth client

NTScout is provisioned as the stable public client `ntscout`. It has no client secret and uses Authorization Code with PKCE S256 as its only interactive grant; `refresh_token` is enabled for renewal after an `offline_access` consent. Its fixed scopes are `openid`, `profile`, `email`, `offline_access`, and `ntscout:access`.

Run migrations first, then execute the idempotent seed against the target NTAuth database:

```bash
bun --filter @neotamia/db db:migrate
bun --filter @neotamia/db db:seed:ntscout
```

The seed requires `DATABASE_URL`, `NTSCOUT_ENVIRONMENT`, and `NTSCOUT_REDIRECT_URIS`. The URI list is comma-separated. Running it again updates the same client and removes redirect URIs no longer present; it never creates or prints a secret. Each execution writes a correlated `oauth.client.seed` audit event containing only the environment and URI count.

## Redirect URIs

Configure the exact callback exposed by each NTScout deployment:

| Environment   | Required form                                                         |
| ------------- | --------------------------------------------------------------------- |
| `development` | Exact HTTPS URI, or HTTP only on `localhost`, `127.0.0.1`, or `[::1]` |
| `staging`     | Exact HTTPS callback of the staging deployment                        |
| `production`  | Exact HTTPS callback of the production deployment                     |

Fragments, embedded credentials, wildcards, duplicates, non-HTTP protocols, and non-loopback HTTP callbacks are rejected. Paths, ports, query strings, and trailing slashes are significant because authorization requests are compared with the stored value exactly.

Example for the local NTScout callback shipped in `.env.example`:

```dotenv
NTSCOUT_ENVIRONMENT=development
NTSCOUT_REDIRECT_URIS=http://127.0.0.1:3003/auth/callback
```

For staging and production, inject their real HTTPS callback values through deployment secrets or environment configuration. Do not add preview or historical callbacks to production unless those endpoints are still controlled and intentionally supported.
