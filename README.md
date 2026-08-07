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

Apply or roll back the latest database migration with:

```bash
bun --filter @neotamia/db db:migrate
bun --filter @neotamia/db db:rollback
```

The worker exposes liveness and database readiness on `http://localhost:3002/health` and `/ready`. Enqueue a persistent test job with `bun --filter @neotamia/ntauth-worker enqueue:test`; pass a number from `1` to `4` to exercise retries, for example `enqueue:test 2`.

To stop the stack while keeping its data, run `docker compose down`. To deliberately reset all local data, run `docker compose down --volumes`; this permanently deletes the three development volumes. After a reset, the next `docker compose up --build -d` recreates and migrates the database automatically.

## Validation

```bash
bun run check
```

This command checks Oxc formatting and linting, TypeScript, tests, and production builds across the workspaces. External dependencies are always added with an explicit version and `--exact`.

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).
