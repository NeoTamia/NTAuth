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

The implementation roadmap is available in [PROJECT_PLAN.md](./PROJECT_PLAN.md).
