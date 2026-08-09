#!/usr/bin/env bash
set -euo pipefail

backup_dir=${BACKUP_DIR:-./backups}
compose_file=${COMPOSE_FILE:-compose.production.yaml}
environment_file=${ENVIRONMENT_FILE:-deploy/production.env}
recipient=${BACKUP_GPG_RECIPIENT:?set BACKUP_GPG_RECIPIENT}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$backup_dir/ntauth-$timestamp.dump.gpg"
partial="$output.partial"

umask 077
mkdir -p "$backup_dir"
trap 'rm -f -- "$partial"' EXIT

docker compose --env-file "$environment_file" -f "$compose_file" exec -T postgres \
  pg_dump --username ntauth --dbname ntauth --format custom --compress=9 --no-owner --no-acl \
  | gpg --batch --yes --trust-model always --recipient "$recipient" --encrypt --output "$partial"

test -s "$partial"
mv -- "$partial" "$output"
sha256sum "$output" > "$output.sha256"
printf '{"created_at":"%s","file":"%s","rpo_hours":24}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$output")" > "$output.json"
chmod 0600 "$output" "$output.sha256" "$output.json"
trap - EXIT
printf '%s\n' "$output"
