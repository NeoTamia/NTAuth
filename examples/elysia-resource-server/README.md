# Exemple Elysia resource server

```bash
bun --filter @neotamia/example-elysia-resource-server start
```

Le serveur écoute sur `3101`, vérifie les access tokens NTAuth et protège
`GET /reports/:id` avec l’action `ntscout:report:read`. Définissez `NTAUTH_ISSUER` pour cibler une
instance autre que `http://localhost:3001`.

Le test instancie réellement l’application et vérifie son contrat Bearer ; le build et le test sont
exécutés par `bun run check`.
