FROM oven/bun:1.3.14-slim AS workspace
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM workspace AS migrate
CMD ["bun", "--filter", "@neotamia/db", "db:migrate"]

FROM workspace AS api-build
RUN bun --filter @neotamia/ntauth-api build

FROM oven/bun:1.3.14-slim AS api
WORKDIR /app
COPY --from=api-build --chown=bun:bun /app/apps/api/dist ./dist
USER bun
EXPOSE 3001
CMD ["bun", "dist/index.js"]

FROM workspace AS worker-build
RUN bun --filter @neotamia/ntauth-worker build

FROM oven/bun:1.3.14-slim AS worker
WORKDIR /app
COPY --from=worker-build --chown=bun:bun /app/apps/worker/dist ./dist
USER bun
EXPOSE 3002
CMD ["bun", "dist/index.js"]

FROM node:24.6.0-bookworm-slim AS web-build
WORKDIR /app
COPY --from=workspace /app /app
WORKDIR /app/apps/web
RUN node node_modules/nuxt/bin/nuxt.mjs build

FROM oven/bun:1.3.14-slim AS web
WORKDIR /app
COPY --from=web-build --chown=bun:bun /app/apps/web/.output ./.output
USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
