# NTAuth

Central identity, OAuth/OIDC and authorization service for NeoTamia.

## Requirements

- Bun 1.3.14
- PostgreSQL 18
- Redis

## Development

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

## Validation

```bash
bun run check
```

This command checks Oxc formatting and linting, TypeScript, tests, and production builds across the workspaces. External dependencies are always added with an explicit version and `--exact`.

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).
