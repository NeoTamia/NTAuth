#!/usr/bin/env bash
set -euo pipefail

backup=${1:?usage: restore-postgres.sh BACKUP.dump.gpg RESTORE_DATABASE}
restore_database=${2:?usage: restore-postgres.sh BACKUP.dump.gpg RESTORE_DATABASE}
compose_file=${COMPOSE_FILE:-compose.production.yaml}
environment_file=${ENVIRONMENT_FILE:-deploy/production.env}

if [[ ! $restore_database =~ ^ntauth_restore_[a-zA-Z0-9_]+$ ]]; then
  printf 'restore database must match ntauth_restore_[a-zA-Z0-9_]+\n' >&2
  exit 2
fi
test -f "$backup"
test -f "$backup.sha256"
sha256sum --check "$backup.sha256"

started=$(date +%s)
docker compose --env-file "$environment_file" -f "$compose_file" exec -T postgres \
  createdb --username ntauth "$restore_database"
gpg --batch --decrypt "$backup" \
  | docker compose --env-file "$environment_file" -f "$compose_file" exec -T postgres \
      pg_restore --username ntauth --dbname "$restore_database" --exit-on-error --no-owner --no-acl

table_count=$(docker compose --env-file "$environment_file" -f "$compose_file" exec -T postgres \
  psql --username ntauth --dbname "$restore_database" --tuples-only --no-align \
  --command "select count(*) from information_schema.tables where table_schema = 'public'")
migration_count=$(docker compose --env-file "$environment_file" -f "$compose_file" exec -T postgres \
  psql --username ntauth --dbname "$restore_database" --tuples-only --no-align \
  --command "select count(*) from drizzle.__drizzle_migrations")
duration=$(($(date +%s) - started))

if (( table_count < 1 || migration_count < 1 )); then
  printf 'restoration validation failed: tables=%s migrations=%s\n' "$table_count" "$migration_count" >&2
  exit 1
fi
printf 'restore_database=%s tables=%s migrations=%s rto_seconds=%s\n' \
  "$restore_database" "$table_count" "$migration_count" "$duration"
