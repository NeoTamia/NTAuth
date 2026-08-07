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
bun --filter @neotamia/db db:migrate
bun --filter @neotamia/db db:rollback
```

The worker exposes liveness and database readiness on `http://localhost:3002/health` and `/ready`. Enqueue a persistent test job with `bun --filter @neotamia/ntauth-worker enqueue:test`; pass a number from `1` to `4` to exercise retries, for example `enqueue:test 2`.

Application emails use the PostgreSQL outbox and are committed in the same transaction as their business mutation. A deduplication key returns the existing job, SMTP retries use bounded exponential backoff, stable `Message-ID` values make attempts identifiable, and exhausted messages remain visible as `failed` without persisting the SMTP error or credentials.

Invitation creation is authenticated and authorized through `POST /api/v1/invitations`; cancellation uses `DELETE /api/v1/invitations/:id`. Tokens expire after 72 hours, only their SHA-256 hash is retained in the invitation table, and successful email jobs scrub their payload after delivery. `POST /api/v1/invitations/accept` uses a uniform error response for unknown, expired, cancelled, or reused tokens and atomically verifies the email and creates the organization membership.

To stop the stack while keeping its data, run `docker compose down`. To deliberately reset all local data, run `docker compose down --volumes`; this permanently deletes the three development volumes. After a reset, the next `docker compose up --build -d` recreates and migrates the database automatically.

## Validation

```bash
bun run check
```

This command checks Oxc formatting and linting, TypeScript, tests, and production builds across the workspaces. External dependencies are always added with an explicit version and `--exact`.

GitHub Actions runs the same command after a frozen install, with healthy PostgreSQL and Redis services. The workflow pins Bun, service images, and every third-party action; it caches only Bun's download cache using the exact lockfile hash. New pushes cancel an older run for the same branch, and each validation job has a 20-minute timeout.

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).
