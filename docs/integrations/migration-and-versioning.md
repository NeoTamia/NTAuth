# Migration et versionnement des packages

## Politique de compatibilité

- patch : correction sans modification de contrat ;
- minor : ajout rétrocompatible ;
- major : retrait ou changement incompatible ;
- tant qu’un package est en `0.x`, une rupture incrémente la version mineure et porte un
  `BREAKING CHANGE` explicite.

Les packages utilisent des exports ESM publics uniquement. Un chemin `src/*` ou `dist/*` non
déclaré dans `exports` est privé et peut changer sans préavis.

## Procédure de mise à jour

1. Lisez le changelog et les éventuels `BREAKING CHANGE`.
2. Mettez à jour un package à la fois avec une version exacte.
3. Compilez les types consommateurs.
4. Lancez les exemples de contrat et les parcours OAuth négatifs.
5. Déployez d’abord sur un environnement avec un issuer et des redirect URI exacts.
6. Vérifiez les métriques `401`, `403`, refresh et invalidation ETag avant généralisation.

## Ruptures usuelles

- catalogue IAM : mettez d’abord les services producteurs à jour, puis les consommateurs ;
- claim OAuth : acceptez l’ancien et le nouveau contrat pendant la fenêtre annoncée ;
- BFF Nuxt : faites évoluer les handlers serveur avant le composable client ;
- ETag : purgez le cache applicatif avec `ntauthClient.invalidate()` après mise à jour.

Un rollback repointe vers la version exacte précédente. Une version publiée n’est jamais écrasée.
