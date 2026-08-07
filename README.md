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

PostgreSQL is exposed on `localhost:5432`, Redis on `localhost:6379`, and the Mailpit inbox is available at [http://localhost:8025](http://localhost:8025). Their data is persisted in named Docker volumes. The host ports can be changed with `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `SMTP_HOST_PORT`, and `MAILPIT_HTTP_PORT`; keep the corresponding application URLs and ports aligned.

Check the local services with:

```bash
docker compose ps
docker compose exec postgres pg_isready -U ntauth -d ntauth
docker compose exec redis redis-cli ping
```

To stop the services while keeping their data, run `docker compose down`. To deliberately reset all local data, run `docker compose down --volumes`; this permanently deletes the three development volumes.

## Validation

```bash
bun run check
```

This command checks Oxc formatting and linting, TypeScript, tests, and production builds across the workspaces. External dependencies are always added with an explicit version and `--exact`.

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).
