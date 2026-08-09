# Preuve de charge locale — 2026-08-09

## Contexte

- cible : API NTAuth locale sur `127.0.0.1:3301` ;
- base : PostgreSQL de test isolée ;
- cache et limites : Redis de test isolé avec rate limiting actif ;
- harness : `bun tooling/load-test.ts` ;
- concurrence : 10 utilisateurs virtuels ;
- durée : 10 secondes ;
- seuils : taux d'erreur maximal 1 %, p95 maximal 1 000 ms.

## Résultat

```json
{
  "concurrency": 10,
  "duration_seconds": 10,
  "error_rate": 0,
  "p50_ms": 0.7585,
  "p95_ms": 1.983,
  "p99_ms": 2.9848,
  "requests": 117705,
  "scenarios": {
    "health": 39236,
    "openid-discovery": 39233,
    "readiness": 39236
  },
  "unexpected": 0
}
```

Le tir local respecte les deux seuils. Il prouve le fonctionnement du harness, des endpoints de
sonde et de la découverte OpenID sous concurrence ; il ne constitue pas une mesure de capacité du
VPS.

## Preuves restant à produire en staging

- paliers de 10, 25 puis 50 utilisateurs avec ressources conteneur et captures Grafana ;
- concurrence d'une famille de refresh tokens jetable ;
- pannes contrôlées Redis, SMTP et PostgreSQL ;
- rollback applicatif N-1 avec anciens digests OCI.
