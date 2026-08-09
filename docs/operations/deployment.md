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
