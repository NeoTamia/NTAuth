# Sauvegarde et restauration PostgreSQL

## Objectifs et rétention

- RPO cible : 24 heures, avec une sauvegarde quotidienne après la fenêtre d’activité principale.
- RTO cible V1 : 60 minutes jusqu’à une base restaurée et validée.
- Rétention locale chiffrée : 30 jours. Une copie hors VPS, chiffrée avec une clé distincte, est
  obligatoire avant production.
- Un exercice de restauration isolée est exécuté au moins mensuellement et avant une migration
  destructive.

## Sauvegarde

`backup-postgres.sh` produit un `pg_dump` custom, le chiffre directement vers le destinataire GPG
sans écrire de dump clair, calcule SHA-256 et écrit une métadonnée UTC. La clé privée de
déchiffrement ne doit pas être présente sur le VPS de production.

```sh
export BACKUP_GPG_RECIPIENT=operations@example.com
export BACKUP_DIR=/srv/ntauth/backups
deploy/scripts/backup-postgres.sh
```

Transférer ensuite le triplet `.dump.gpg`, `.sha256`, `.json` vers le stockage hors site. La
rétention locale s’applique avec `BACKUP_RETENTION_DAYS=30 deploy/scripts/prune-backups.sh`; le
script refuse `/`, `.` et toute rétention inférieure à sept jours.

## Restauration isolée

Ne jamais restaurer directement dans `ntauth`. Le script exige un nom `ntauth_restore_*`, vérifie
le checksum, crée une nouvelle base, lance `pg_restore --exit-on-error`, vérifie tables et journal
de migrations, puis affiche le RTO mesuré.

```sh
deploy/scripts/restore-postgres.sh \
  /srv/ntauth/backups/ntauth-20260809T120000Z.dump.gpg \
  ntauth_restore_20260809
```

Après validation fonctionnelle en lecture seule, consigner nombre de tables, migrations, durée,
taille et âge du backup. La suppression de la base de restauration est une opération opérateur
séparée afin de préserver les preuves en cas d’échec.

## Échec et récupération

Un checksum invalide ou un `pg_restore` non nul rend le backup inutilisable. Garder les fichiers,
ouvrir un incident et tester la sauvegarde précédente. Si l’objectif RPO/RTO est dépassé, bloquer
toute migration destructive jusqu’à un nouvel exercice conforme.
