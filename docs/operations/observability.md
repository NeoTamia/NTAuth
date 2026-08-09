# Observabilité et alertes

## Données exposées

L’API et le worker écrivent une ligne JSON par événement avec `timestamp`, `level`, `service` et
`event`. Les requêtes API ajoutent `request_id`, méthode, route normalisée, statut et durée. Les
segments UUID sont remplacés par `:id`; les paramètres de requête, corps, cookies et en-têtes
d’autorisation ne sont jamais journalisés. Les clés sensibles et les identifiants intégrés à une
URI sont redacted en dernier recours.

`/metrics` expose le format Prometheus. Le reverse proxy public doit refuser ce chemin pour l’API;
Prometheus le collecte par le réseau Docker `data`. Le tableau Grafana provisionné couvre débit,
p95, résultats worker et profondeur de file. Sa route publique doit être protégée par TLS et une
restriction opérateur.

## Objectifs initiaux

- Disponibilité API sur 30 jours : 99,9 %.
- Taux de réponses API 5xx sur 10 minutes : inférieur à 5 %.
- Latence API p95 sur 15 minutes : inférieure à 1 seconde.
- Aucun job terminal en échec et moins de 100 jobs disponibles pendant plus de 15 minutes.
- Aucun échec d’accès Redis sur le chemin de rate limiting.

Ces seuils sont un point de départ V1. Les ajuster uniquement à partir d’une mesure staging ou
production conservée avec le changement.

## Configuration Alertmanager

`deploy/observability/alertmanager.yml` définit le groupement et un receiver opérateur sans
destination. Avant le go-live, ajouter au receiver un canal réellement surveillé (webhook,
PagerDuty, email ou équivalent), placer son secret dans un fichier Docker secret et effectuer un
test synthétique. Un receiver vide est volontairement un état de préflight visible, pas une
configuration de production achevée.

Valider la syntaxe et les règles depuis les images exactes utilisées en production :

```sh
docker run --rm --entrypoint /bin/promtool -v "$PWD/deploy/observability:/etc/prometheus:ro" prom/prometheus:v3.7.3 check config /etc/prometheus/prometheus.yml
docker run --rm --entrypoint /bin/promtool -v "$PWD/deploy/observability:/etc/prometheus:ro" prom/prometheus:v3.7.3 check rules /etc/prometheus/alerts.yml
docker run --rm --entrypoint /bin/amtool -v "$PWD/deploy/observability:/etc/alertmanager:ro" prom/alertmanager:v0.30.1 check-config /etc/alertmanager/alertmanager.yml
```

## Runbooks

### API indisponible

Vérifier dans l’ordre le conteneur, `/health`, `/ready`, puis les checks PostgreSQL et Redis. Lier
les logs avec le `request_id`. Si le nouveau digest est seul en cause, restaurer l’ancien digest
API sans toucher aux volumes. Si la base est indisponible, geler migrations et écritures avant
toute restauration.

### Worker indisponible

Contrôler `/ready`, l’accès PostgreSQL et l’état du processeur. Redémarrer un seul worker; ne pas
multiplier les instances avant d’avoir exclu un job empoisonné. Les verrous expirés sont repris et
les handlers doivent rester idempotents.

### Erreurs API

Ventiler `ntauth_http_requests_total` par route et classe de statut. Comparer au dernier digest,
aux migrations et aux dépendances. Une erreur 5xx ne doit pas révéler sa cause au client; le log
corrélé conserve uniquement le nom sûr de l’événement.

### Latence API

Comparer p50/p95 par route, saturation CPU/mémoire, connexions PostgreSQL et latence Redis. En cas
de régression liée au digest, revenir à l’image précédente. Ne relever un seuil qu’après analyse
et mesure de charge reproductible.

### Redis et rate limiting

Le rate limiting échoue fermé sur les routes sensibles. Vérifier le conteneur Redis, son volume,
sa mémoire et les erreurs de connexion. Ne désactiver temporairement `RATE_LIMIT_ENABLED` que
derrière une restriction réseau compensatoire et avec une décision d’incident horodatée.

### Échecs authentification

Comparer les routes, les statuts et les rejets de quota. Une hausse peut signaler attaque,
mauvaise configuration OAuth ou panne d’un client. Les identités sont pseudonymisées dans Redis
et ne doivent pas être ajoutées aux labels Prometheus.

### Jobs en échec

Identifier le type et l’identifiant depuis les logs, puis vérifier le transport SMTP et la ligne
de job sans afficher son payload. Corriger la cause avant toute remise à disposition manuelle.
Ne jamais réinitialiser `attempts` en masse.

### Retard de file

Comparer le débit complété au nombre `available`. Examiner la latence SMTP, les retries et les
ressources du worker. Une montée contrôlée du nombre de workers n’est sûre qu’après validation de
l’idempotence et de la capacité PostgreSQL.
