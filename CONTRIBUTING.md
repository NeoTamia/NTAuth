# Contribuer à NTAuth

## Pré-requis

- Bun `1.3.14` exactement ;
- les services de développement décrits dans `.env.example` ;
- un ticket YouTrack `NTAUTH-*` prêt à être travaillé.

Installez les dépendances avec le lockfile :

```bash
bun install --frozen-lockfile
```

## Déroulement d’une tâche

1. Vérifier objectif, périmètre, dépendances et critères d’acceptation dans YouTrack.
2. Passer le ticket à `In Progress`.
3. Implémenter la plus petite unité cohérente couvrant tout le ticket.
4. Ajouter ou adapter les tests.
5. Exécuter les vérifications locales.
6. Créer un commit Conventional Commit.
7. Documenter les preuves dans YouTrack.
8. Passer le ticket à `Done` uniquement lorsque tous les critères sont satisfaits.

Une tâche commencée doit être terminée ou explicitement remise dans un état non actif avant de changer de sujet.

## Commandes de vérification

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

- `oxfmt` est l’unique formateur ;
- `oxlint` est l’unique linter ;
- ESLint et Prettier ne doivent pas être ajoutés ;
- TypeScript reste en mode strict.

Appliquez le format avec :

```bash
bun run format
```

## Dépendances

Toutes les dépendances externes sont épinglées à une version exacte.

Autorisé :

```json
"zod": "4.4.3"
```

Interdit :

```json
"zod": "^4.4.3"
"zod": "~4.4.3"
"zod": "latest"
```

Ajoutez une dépendance avec :

```bash
bun add --exact <package>@<version>
bun add --dev --exact <package>@<version>
```

`workspace:*` reste autorisé pour les packages internes : il référence le workspace courant et n’introduit pas de résolution externe flottante.

Toute mise à jour de dépendance doit inclure le lockfile et passer l’ensemble des validations.

## TypeScript

- préférer `unknown` à `any` ;
- exporter des contrats explicites aux frontières de packages ;
- éviter d’exposer les types internes Better Auth dans l’API métier ;
- valider les entrées réseau et les données persistées ;
- traiter les valeurs optionnelles explicitement ;
- utiliser des unions discriminées pour les états métier ;
- garder les fonctions d’autorisation déterministes et sans effet de bord.

## Nommage

- fichiers TypeScript : `kebab-case.ts` ;
- composants Vue : `PascalCase.vue` ;
- variables et fonctions : `camelCase` ;
- types, interfaces et classes : `PascalCase` ;
- constantes globales : `UPPER_SNAKE_CASE` uniquement lorsqu’elles sont réellement constantes ;
- tables et colonnes PostgreSQL : `snake_case` ;
- routes HTTP et tags : `kebab-case` ;
- packages : scope `@neotamia/` et nom en `kebab-case`.

## Frontières du monorepo

- une application peut dépendre d’un package ;
- un package ne dépend jamais d’une application ;
- `packages/db` ne contient pas de logique HTTP ;
- `packages/permissions` reste indépendant d’Elysia et de Nuxt ;
- les packages publiés n’importent aucun chemin privé d’un autre package ;
- les modules métier ne lisent pas directement `process.env` en dehors de la couche de configuration.

## Conventional Commits

Format :

```text
type(scope): sujet impératif court

Corps expliquant le pourquoi et les conséquences si nécessaire.
```

Types autorisés :

- `feat` : fonctionnalité observable ;
- `fix` : correction de bug ;
- `docs` : documentation uniquement ;
- `test` : tests uniquement ;
- `refactor` : changement interne sans comportement ajouté ;
- `perf` : amélioration de performance ;
- `build` : build ou dépendances ;
- `ci` : automatisation CI/CD ;
- `chore` : maintenance ;
- `revert` : annulation d’un commit.

Scopes recommandés : `api`, `web`, `worker`, `auth`, `oauth`, `iam`, `db`, `permissions`, `config`, `release`, `infra`.

Un changement incompatible utilise `!` et un footer :

```text
feat(api)!: version effective policies response

BREAKING CHANGE: clients must read the new statements envelope.
```

Le body peut contenir plusieurs paragraphes. Un commit doit rester cohérent et réversible.

## Branches et publication

- `main` représente la branche intégrable ;
- les branches de travail utilisent `type/description-courte` ;
- aucun force-push sur `main` après le démarrage normal du projet ;
- aucun push n’est effectué par un agent sans autorisation explicite ;
- les commits locaux peuvent être créés au fil des tickets terminés.

## Tests

- test unitaire pour toute règle métier ;
- test d’intégration pour les frontières base, cache, SMTP et OAuth ;
- test E2E pour les parcours critiques ;
- test de non-régression pour tout bug ;
- tests négatifs obligatoires pour authentification et autorisation ;
- fixtures sans token, email réel ou secret.

Chaque application, package ou exemple range ses tests hors du code de production :

```text
workspace/
├── src/                 # code de production, sans fichier de test
└── tests/
    ├── unit/            # règles isolées, suffixe .test.ts
    ├── integration/     # plusieurs composants ou services, suffixe .integration.test.ts
    └── e2e/             # parcours externes complets, suffixe .e2e.test.ts
```

Un sous-dossier n’est créé que lorsque sa catégorie contient au moins un test. Les tests de contrat
de packaging appartiennent à `tests/integration`. `bun test` découvre récursivement ces trois
catégories, et les `tsconfig.json` des workspaces incluent `tests/**/*.ts` dans le contrôle de types.

## Revue

Une revue vérifie au minimum :

- conformité au ticket ;
- sécurité et absence de fuite de secret ;
- migrations et rollback ;
- compatibilité API et packages ;
- observabilité ;
- tests couvrant le comportement, pas seulement les lignes ;
- changeset lorsque nécessaire.

## Changesets

Ajoutez un changeset lorsqu’un package public change :

```bash
bun run changeset
```

Choisissez `patch`, `minor` ou `major` selon SemVer. Les applications privées ne sont pas versionnées par Changesets.

Le processus complet est décrit dans `docs/releases.md`.
