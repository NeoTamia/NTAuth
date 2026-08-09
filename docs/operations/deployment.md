# Déploiement staging et production

## Flux contrôlé

1. La CI et le workflow OCI doivent être verts pour le même commit.
2. Recopier les quatre digests GHCR complets dans `deploy/production.env`.
3. Exécuter `deploy/scripts/preflight.sh` : permissions, secrets, digests, rendu Compose et pulls
   sont vérifiés sans modifier les services.
4. Tester en staging le backup, le lock de migration, `/ready`, OAuth et un rollback applicatif.
5. Définir `CONFIRM_DEPLOY=yes`, `HEALTHCHECK_URL` et `BACKUP_GPG_RECIPIENT`, puis lancer
   `deploy/scripts/deploy.sh` pendant la fenêtre approuvée.

Le script archive l’environnement de digests précédent, produit une sauvegarde, démarre les
dépendances, exécute une migration unique, recrée les applications puis sonde `/ready` pendant
deux minutes. Il n’effectue jamais de push Git et n’imprime aucun secret.

## Premier administrateur de plateforme

L’inscription publique est désactivée. Après les migrations du premier déploiement, amorcer une
seule fois l’administrateur de plateforme avec l’image `migrate` déjà validée par digest.

1. Remplacer `NTAUTH_BOOTSTRAP_ADMIN_EMAIL` et `NTAUTH_BOOTSTRAP_ADMIN_NAME` dans
   `deploy/production.env`.
2. Conserver exactement
   `NTAUTH_BOOTSTRAP_CONFIRM=create-first-platform-admin` pendant cette opération.
3. Générer le mot de passe dans `deploy/secrets/bootstrap-admin-password`, puis limiter son accès :

```sh
umask 077
openssl rand -base64 32 > deploy/secrets/bootstrap-admin-password
chmod 0600 deploy/secrets/bootstrap-admin-password
```

4. Exécuter le job isolé après le démarrage de PostgreSQL et les migrations :

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml up -d postgres
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm migrate up
docker compose --profile bootstrap --env-file deploy/production.env \
  -f compose.production.yaml run --rm bootstrap-admin
```

La commande prend un verrou transactionnel, crée une identité vérifiée avec un credential hashé,
attribue `platform_admin` et écrit un événement d’audit sans secret. Une nouvelle exécution pour le
même email est sans effet ; un email différent est refusé dès qu’un administrateur existe.

Après une connexion et un enrôlement MFA réussis, supprimer immédiatement le fichier en clair et
retirer les variables `NTAUTH_BOOTSTRAP_*` du fichier d’environnement. La récupération de mot de
passe authentifiée remplace ensuite tout besoin de conserver ce secret d’amorçage.

## Rollback applicatif

En cas de readiness non conforme, utiliser le snapshot d’environnement annoncé par le script :

```sh
deploy/scripts/rollback-app.sh deploy/releases/production-20260809T120000Z.env
```

Ce rollback ne touche ni au job de migration ni aux volumes. Suivre
`docs/operations/migrations.md` si le schéma doit aussi revenir en arrière.

## Accès VPS attendu

Le dépôt ne contient volontairement ni clé SSH, ni hostname, ni canal d’alerte. L’opérateur doit
provisionner un compte non-root membre du groupe Docker, un `known_hosts` vérifié, le répertoire
de secrets `0600`, le réseau proxy et les règles TLS. Le premier déploiement, sans base existante,
se fait manuellement jusqu’au démarrage PostgreSQL; les déploiements suivants utilisent le script
avec sauvegarde obligatoire.
