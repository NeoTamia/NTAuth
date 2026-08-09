# Charge et scénarios de récupération

## Seuils V1

Le harness sans dépendance `bun run load:test` exerce health, readiness et découverte OpenID avec
des utilisateurs virtuels concurrents. Il échoue si le taux de statut inattendu dépasse 1 % ou si
la latence p95 dépasse 1 seconde. Les variables `LOAD_CONCURRENCY`, `LOAD_DURATION_SECONDS`,
`LOAD_MAX_ERROR_RATE` et `LOAD_P95_MS` sont bornées pour éviter un tir accidentel illimité.

```sh
LOAD_TARGET_URL=https://auth.staging.example.com \
LOAD_CONCURRENCY=25 \
LOAD_DURATION_SECONDS=120 \
bun run load:test
```

Un refresh token staging jetable peut être fourni via `LOAD_REFRESH_TOKEN`. Le harness lance une
rafale concurrente sur la même famille; un succès suivi de rejets contrôlés `400` ou `429` est
attendu, jamais un `5xx`. Cette opération révoque potentiellement la famille et ne doit pas viser
un compte réel.

Conserver le JSON de résultat, digest, ressources VPS et captures Grafana. Mesurer au minimum 10,
25 puis 50 utilisateurs en staging avant de relever un seuil.

## Panne Redis

1. En staging uniquement, arrêter Redis pendant une requête de connexion et une lecture normale.
2. Attendre `503 rate_limit_unavailable` sur le chemin sensible et `/ready` à 503; les routes qui
   n’utilisent pas Redis ne doivent pas produire de corruption.
3. Redémarrer Redis, attendre son healthcheck, puis vérifier `/ready`, une connexion et les
   compteurs `store_unavailable`.
4. Si la reprise échoue, redémarrer seulement l’API après avoir conservé ses logs corrélés.

## Panne SMTP

1. Pointer le worker staging vers un port SMTP fermé ou arrêter Mailpit après l’enqueue.
2. Vérifier que le job revient `available` avec backoff, sans payload ni mot de passe dans les
   logs, puis devient `failed` après le nombre maximal d’essais.
3. Restaurer SMTP, créer un nouveau job et vérifier sa livraison. Ne pas réinitialiser en masse
   les jobs terminaux.

## Panne PostgreSQL

1. Prendre un backup chiffré et arrêter PostgreSQL staging.
2. Vérifier API/worker `/ready` à 503, arrêt de toute migration et absence de boucle de restart
   destructive.
3. Redémarrer PostgreSQL et contrôler migrations, audit append-only et reprise worker.
4. Si le volume est inutilisable, appliquer `backups.md` dans une base isolée, mesurer RPO/RTO,
   puis décider explicitement du basculement.

## Rollback applicatif

Exécuter au moins une fois `rollback-app.sh` en staging avec les anciens digests, puis rejouer
discovery, connexion, refresh et API NTScout. La preuve doit montrer que la migration expand reste
compatible N-1. Aucun scénario de récupération ne supprime un volume Docker.
