# `@neotamia/config`

Configuration statique partagée par le monorepo NTAuth.

## TypeScript

Les projets TypeScript étendent `tsconfig/base.json`. La résolution dans le monorepo utilise un chemin relatif afin que les outils fonctionnent avant publication du package.

## Oxlint

La configuration racine `.oxlintrc.json` étend `oxlint/base.json`. Les catégories correctness, suspicious et perf sont communes à toutes les applications et tous les packages.

Oxfmt ne propose pas d’héritage de configuration. Sa configuration canonique reste donc à la racine dans `.oxfmtrc.json` et s’applique à tout le monorepo.

## Invariants

- aucune configuration ESLint ;
- TypeScript strict ;
- erreurs de variables inutilisées et index non vérifiés ;
- dépendances exactes ;
- validation avec `bun test tooling/config.test.ts`.
