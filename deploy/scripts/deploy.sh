#!/usr/bin/env bash
set -euo pipefail

if [[ ${CONFIRM_DEPLOY:-} != yes ]]; then
  printf 'set CONFIRM_DEPLOY=yes after reviewing preflight and rollback\n' >&2
  exit 2
fi

compose_file=${COMPOSE_FILE:-compose.production.yaml}
environment_file=${ENVIRONMENT_FILE:-deploy/production.env}
healthcheck_url=${HEALTHCHECK_URL:?set HEALTHCHECK_URL to the public /ready endpoint}
release_dir=${RELEASE_DIR:-./deploy/releases}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)

deploy/scripts/preflight.sh
umask 077
mkdir -p "$release_dir"
cp -- "$environment_file" "$release_dir/production-$timestamp.env"
deploy/scripts/backup-postgres.sh

docker compose --env-file "$environment_file" -f "$compose_file" up -d postgres redis alertmanager
docker compose --env-file "$environment_file" -f "$compose_file" run --rm migrate up
docker compose --env-file "$environment_file" -f "$compose_file" up -d api worker web prometheus grafana

for attempt in {1..24}; do
  if curl --fail --silent --show-error --max-time 5 "$healthcheck_url" >/dev/null; then
    printf 'deployment=healthy release=%s\n' "$timestamp"
    exit 0
  fi
  sleep 5
done

printf 'post-deployment readiness failed; restore prior digests from %s\n' \
  "$release_dir/production-$timestamp.env" >&2
exit 1
