# NTAuth

Central identity, OAuth/OIDC and authorization service for NeoTamia.

## Requirements

- Bun 1.3.14
- Docker Engine with Docker Compose

## Development

```bash
cp .env.example .env
bun install --frozen-lockfile
docker compose up -d postgres redis mailpit
bun run db:migrate
bun run dev
```

To run the complete stack in containers instead, use `docker compose up --build -d`. Compose waits for PostgreSQL, applies migrations once, waits for Redis and Mailpit, then starts the API, worker, and web application in dependency order. Inspect it with `docker compose ps` and `docker compose logs --tail=100 <service>`.

PostgreSQL is exposed on `localhost:5432`, Redis on `localhost:6379`, and the Mailpit inbox is available at [http://localhost:8025](http://localhost:8025). Their data is persisted in named Docker volumes. The host ports can be changed with `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `SMTP_HOST_PORT`, and `MAILPIT_HTTP_PORT`; keep the corresponding application URLs and ports aligned.

Check the local services with:

```bash
docker compose ps
docker compose exec postgres pg_isready -U ntauth -d ntauth
docker compose exec redis redis-cli ping
```

The API exposes `GET /health` for process liveness and `GET /ready` for PostgreSQL and Redis readiness. It returns HTTP `503` with per-dependency availability when either service is unavailable.

Better Auth is mounted under `/api/auth` with persistent PostgreSQL sessions. Email/password authentication is enabled for accounts provisioned by NTAuth, but the public sign-up endpoint is disabled; account creation will be introduced only through the invitation flow. Email verification is required before authentication and passwords must contain between 12 and 128 characters.

Authenticated users can list and revoke sessions through Better Auth's `/api/auth/list-sessions`, `/revoke-session`, `/revoke-other-sessions`, and `/revoke-sessions` endpoints. Session cookie caching is explicitly disabled so revocation takes effect on the next request. NTAuth does not retain session IP addresses and reduces user agents to a browser family; administrative or compromise-driven global revocations are audited without recording tokens.

Apply or roll back the latest database migration with:

```bash
bun run db:migrate
bun run db:rollback
```

The worker exposes liveness and database readiness on `http://localhost:3002/health` and `/ready`. Enqueue a persistent test job with `bun --filter @neotamia/ntauth-worker enqueue:test`; pass a number from `1` to `4` to exercise retries, for example `enqueue:test 2`.

Application emails use the PostgreSQL outbox and are committed in the same transaction as their business mutation. A deduplication key returns the existing job, SMTP retries use bounded exponential backoff, stable `Message-ID` values make attempts identifiable, and exhausted messages remain visible as `failed` without persisting the SMTP error or credentials.

Invitation creation is authenticated and authorized through `POST /api/v1/invitations`; cancellation uses `DELETE /api/v1/invitations/:id`. Tokens expire after 72 hours, only their SHA-256 hash is retained in the invitation table, and successful email jobs scrub their payload after delivery. `POST /api/v1/invitations/accept` uses a uniform error response for unknown, expired, cancelled, or reused tokens and atomically verifies the email and creates the organization membership.

Platform administrators manage the user lifecycle with `PATCH /api/v1/users/:id/status` (`active`, `suspended`, or `deactivated`) and `DELETE /api/v1/users/:id`. Every transition is audited and immediately revokes existing sessions; non-active identities cannot create new sessions. Deletion is terminal: credentials, memberships, roles, sessions, and personal profile fields are removed while an anonymized identity row remains to preserve audit and referential integrity.

Password recovery uses `POST /api/v1/password/forgot` and `/reset`; its response does not reveal whether an address exists. Reset tokens expire after 30 minutes, are stored only as SHA-256 hashes, become unusable after one attempt, and revoke every session after success. Authenticated password changes use `/api/v1/password/change`, verify the current password, and also revoke existing sessions.

Platform administrators enroll TOTP through `POST /api/v1/mfa/enroll` and confirm the initial provisioning URI with `/api/v1/mfa/verify`. TOTP secrets are encrypted with AES-GCM at rest and are never logged or returned after enrollment. Privileged requests must send a fresh six-digit code in `X-NTAuth-TOTP`; each 30-second counter is consumed atomically, so an expired or replayed code is rejected. Non-platform organization administrators are not subject to this platform step-up.

Invitation acceptance verifies the invited address immediately. Other unverified accounts request or resend verification through `POST /api/v1/email-verification/request` and consume the link through `/verify`. Responses do not reveal account existence; SHA-256 token hashes expire after 24 hours, resending invalidates the prior link, and verified or suspended accounts receive no new token. Authentication and password recovery reject unverified identities.

The Better Auth OAuth provider is mounted under `/api/auth/oauth2` and persists its clients, consents, tokens, and signing keys through the shared Drizzle adapter. V1 enables only authorization code and refresh token grants, keeps dynamic registration and public pre-login disabled, hashes stored tokens and client secrets, issues asymmetric JWTs, and fixes authorization codes to 5 minutes, access/ID tokens to 15 minutes, and refresh tokens to 30 days. Sensitive protocol requests receive a correlation ID and a metadata-only audit event.

OIDC discovery is available at `/.well-known/openid-configuration`, OAuth authorization-server metadata at `/.well-known/oauth-authorization-server/api/auth`, and public keys at `/api/auth/jwks`. These responses expose only the configured V1 endpoints, grants, scopes, S256 challenge method, and active public ES256 keys. They carry a five-minute public cache policy, stale-while-revalidate allowance, and an ETag supporting conditional `304` responses.

Provision the stable public NTScout client after migrations with `bun run db:seed:ntscout`. The command is idempotent and takes its exact environment-specific callbacks from `NTSCOUT_REDIRECT_URIS`; see [the NTScout OAuth client runbook](./docs/operations/ntscout-oauth-client.md).

Every authorization request must include an explicit `organization_id` UUID selected by the client. NTAuth verifies that the signed-in user has an active membership in that active organization, binds the UUID to the authorization code and refresh-token family, and verifies it again before each token issuance. Invalid, altered, suspended, or missing organization contexts receive the same protocol-safe error.

The closed V1 scope catalogue and minimal claim contract are documented in [OAuth scopes and claims](./docs/oauth/scopes-and-claims.md). Unknown scopes, client-disallowed scopes, and refresh-time scope escalation are rejected.

ES256 signing keys rotate lazily every 90 days and remain published for a 24-hour grace window, which exceeds the 15-minute JWT lifetime. An authenticated platform administrator can force an immediate replacement with `POST /api/v1/oauth/signing-keys/rotate`, body `{ "reason": "emergency" }`, and a fresh `X-NTAuth-TOTP`; the operation returns only the old and new public `kid` values and is audited.

To stop the stack while keeping its data, run `docker compose down`. To deliberately reset all local data, run `docker compose down --volumes`; this permanently deletes the three development volumes. After a reset, the next `docker compose up --build -d` recreates and migrates the database automatically.

## Validation

```bash
bun run check
```

This command checks Oxc formatting and linting, TypeScript, tests, and production builds across the workspaces. External dependencies are always added with an explicit version and `--exact`.

GitHub Actions runs the same command after a frozen install, with healthy PostgreSQL and Redis services. The workflow pins Bun, service images, and every third-party action; it caches only Bun's download cache using the exact lockfile hash. New pushes cancel an older run for the same branch, and each validation job has a 20-minute timeout.

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).

Package consumers can start with the [integration guide](./docs/integrations/packages.md), the
[migration policy](./docs/integrations/migration-and-versioning.md), and the executable examples in
`examples/`.
