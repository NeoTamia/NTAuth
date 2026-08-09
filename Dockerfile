FROM oven/bun:1.3.14-slim AS workspace
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun --filter @neotamia/permissions build

FROM oven/bun:1.3.14-slim AS runtime
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    libcap2=1:2.75-10+deb13u1+b1 \
    libssl3t64=3.5.6-1~deb13u2 \
    openssl-provider-legacy=3.5.6-1~deb13u2 \
  && rm -rf /var/lib/apt/lists/*

FROM workspace AS migrate-build
RUN bun build packages/db/src/migrate.ts packages/db/src/bootstrap-admin-cli.ts \
  --outdir /app/migrate-dist --target bun

FROM runtime AS migrate
WORKDIR /app
COPY --from=migrate-build --chown=bun:bun /app/migrate-dist ./dist
COPY --from=migrate-build --chown=bun:bun /app/packages/db/migrations ./migrations
USER bun
ENTRYPOINT ["bun", "dist/migrate.js"]
CMD ["up"]

FROM workspace AS api-build
RUN bun --filter @neotamia/ntauth-api build

FROM runtime AS api
WORKDIR /app
COPY --from=api-build --chown=bun:bun /app/apps/api/dist ./dist
USER bun
EXPOSE 3001
CMD ["bun", "dist/index.js"]

FROM workspace AS worker-build
RUN bun --filter @neotamia/ntauth-worker build

FROM runtime AS worker
WORKDIR /app
COPY --from=worker-build --chown=bun:bun /app/apps/worker/dist ./dist
USER bun
EXPOSE 3002
CMD ["bun", "dist/index.js"]

FROM node:24.19.0-bookworm-slim AS web-build
WORKDIR /app
COPY --from=workspace /app /app
WORKDIR /app/apps/web
RUN node node_modules/nuxt/bin/nuxt.mjs build

FROM runtime AS web
WORKDIR /app
COPY --from=web-build --chown=bun:bun /app/apps/web/.output ./.output
USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
