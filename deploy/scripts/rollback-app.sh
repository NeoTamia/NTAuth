#!/usr/bin/env bash
set -euo pipefail

previous_environment=${1:?usage: rollback-app.sh PREVIOUS_ENVIRONMENT_FILE}
compose_file=${COMPOSE_FILE:-compose.production.yaml}
test -f "$previous_environment"

docker compose --env-file "$previous_environment" -f "$compose_file" config --quiet
docker compose --env-file "$previous_environment" -f "$compose_file" pull --quiet
docker compose --env-file "$previous_environment" -f "$compose_file" up -d --no-deps api worker web
docker compose --env-file "$previous_environment" -f "$compose_file" ps api worker web
