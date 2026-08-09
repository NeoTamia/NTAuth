#!/usr/bin/env bash
set -euo pipefail

backup_dir=${BACKUP_DIR:-./backups}
retention_days=${BACKUP_RETENTION_DAYS:-30}

if [[ $backup_dir == / || $backup_dir == . || $backup_dir == .. || ! $retention_days =~ ^[0-9]+$ ]] \
  || (( retention_days < 7 )); then
  printf 'unsafe backup retention parameters\n' >&2
  exit 2
fi
test -d "$backup_dir"

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'ntauth-*.dump.gpg' -o -name 'ntauth-*.dump.gpg.sha256' -o -name 'ntauth-*.dump.gpg.json' \) \
  -mtime "+$retention_days" -print -delete
