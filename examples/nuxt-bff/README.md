# Exemple Nuxt BFF

```bash
bun --filter @neotamia/example-nuxt-bff dev
```

L’exemple montre le plugin, le middleware et les frontières same-origin attendues par
`@neotamia/nuxt-auth`. Les handlers fournis sont volontairement non authentifiés : remplacez-les
par l’échange OAuth serveur décrit dans `docs/integrations/packages.md` avant tout déploiement.

Le build Nuxt, le typecheck et le test de non-exposition des tokens sont exécutés par
`bun run check`.
