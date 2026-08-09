#!/usr/bin/env bash
set -euo pipefail

compose_file=${COMPOSE_FILE:-compose.production.yaml}
environment_file=${ENVIRONMENT_FILE:-deploy/production.env}
secret_dir=${SECRET_DIR:-deploy/secrets}

command -v docker >/dev/null
docker compose version >/dev/null
test -f "$compose_file"
test -f "$environment_file"
test -d "$secret_dir"

environment_mode=$(stat -c '%a' "$environment_file")
if (( 8#$environment_mode & 8#077 )); then
  printf '%s must not be readable by group or others\n' "$environment_file" >&2
  exit 1
fi
while IFS= read -r secret; do
  mode=$(stat -c '%a' "$secret")
  if (( 8#$mode & 8#077 )); then
    printf '%s must have mode 0600 or stricter\n' "$secret" >&2
    exit 1
  fi
done < <(find "$secret_dir" -maxdepth 1 -type f -print)

for variable in API_IMAGE_DIGEST MIGRATE_IMAGE_DIGEST WEB_IMAGE_DIGEST WORKER_IMAGE_DIGEST; do
  value=$(sed -n "s/^${variable}=//p" "$environment_file")
  if [[ ! $value =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '%s must contain one complete sha256 digest\n' "$variable" >&2
    exit 1
  fi
done

docker compose --env-file "$environment_file" -f "$compose_file" config --quiet
docker compose --env-file "$environment_file" -f "$compose_file" pull --quiet
printf 'preflight=ok\n'
