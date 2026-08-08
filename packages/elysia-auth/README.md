# @neotamia/elysia-auth

Protection typée des serveurs de ressources Elysia par les access tokens et policies NTAuth.

## Installation

```bash
bun add @neotamia/elysia-auth@<version-exacte> elysia@1.4.29
```

## Plugin

```ts
import { Elysia } from "elysia";
import { ntauth } from "@neotamia/elysia-auth";

const app = new Elysia()
  .use(
    ntauth({
      issuer: "https://auth.example.com",
      audience: "urn:neotamia:service:ntscout",
      service: "ntscout",
      requiredScopes: ["openid", "ntscout:access"],
    }),
  )
  .get("/reports/:id", ({ auth, params, status }) => {
    const decision = auth.authorize({
      action: "ntscout:report:read",
      resource: `ntscout:report:${params.id}`,
    });
    return decision.allowed ? loadReport(params.id) : status(403);
  });
```

Le plugin vérifie la signature ES256, l’issuer, l’audience, l’expiration, le service, les scopes et
les claims de portée. Il injecte `auth`, qui contient l’identité minimale, l’organisation, les
policies validées et l’évaluateur deny-first.

## Cache et invalidation

Les policies sont revalidées auprès de `/api/v1/iam/effective-policies` à chaque requête avec
`If-None-Match`. Une réponse `304` réutilise le document local ; un nouvel ETag remplace le cache ;
un `401` ou `403` le supprime immédiatement. `ntauthClient.invalidate()` permet également de vider
le cache complet, ou seulement un triplet sujet/organisation/service.

## Erreurs

Les erreurs sont des problèmes JSON stables :

- `401 authentication_required` : header Bearer absent ;
- `401 invalid_token` : signature, issuer, audience, expiration ou claims invalides ;
- `403 insufficient_scope` : scope ou grant refusé ;
- `503 policy_unavailable` : NTAuth ou le document effectif est indisponible.

Les réponses `401` et `403` incluent un header `WWW-Authenticate` cohérent. Le package n’inscrit
jamais les tokens ni les documents de policy dans ses messages d’erreur.

## Compatibilité

Le package publie des modules ESM et leurs types, cible Bun 1.3.14+, Elysia 1.4.29 et Node.js 20+.
Les changements incompatibles suivent la politique SemVer du dépôt NTAuth.
