# Runbook de revue sécurité

Ce runbook produit une preuve reproductible pour NTAUTH-108. Il ne contient aucun secret et peut
être exécuté localement ou sur staging.

## Préconditions

- checkout exact du commit candidat ;
- Bun et images de service aux versions déclarées dans le dépôt ;
- base et Redis de test isolés ;
- aucune donnée réelle dans l'environnement de validation.

## Procédure

1. Exécuter `bun install --frozen-lockfile`.
2. Exécuter `bun run check` avec `TEST_DATABASE_URL` et `REDIS_URL` isolés.
3. Exécuter `bun test tooling/security-review.test.ts`.
4. Construire chaque target du Dockerfile et confirmer l'utilisateur non-root.
5. Exécuter les scénarios négatifs OAuth/IAM : mauvais issuer, audience, scope, organisation,
   token expiré/révoqué, grant retiré et ETag modifié.
6. Rechercher les canaris `ntauth_test_secret`, `ntauth_test_token` et `test@example.invalid` dans
   les logs, métriques, exports d'audit et couches OCI. La preuve doit montrer zéro occurrence.
7. Relire chaque ligne `Planned` du registre STRIDE. L'associer à un test vert, ou conserver le
   finding ouvert.
8. Archiver commit, date, résultats, digests OCI et findings dans le ticket YouTrack concerné.

## Diagnostic attendu

Un échec indique le contrôle, la commande et le finding associé sans imprimer de credential. Les
résultats de CI et staging doivent être exploitables uniquement avec le commit et les identifiants
de corrélation.

## Retour arrière

La revue ne modifie pas la production. Si une mitigation casse un flux, revenir au dernier digest
applicatif validé, conserver les migrations compatibles expand/contract et rouvrir le finding. Il
est interdit de désactiver silencieusement un contrôle ou de marquer un risque accepté sans décision
du propriétaire.

## Critère de sortie

- aucun finding Critical/Major à l'état `Planned` ;
- toutes les preuves automatisées vertes ;
- risques résiduels Moderate/Minor documentés ;
- décision go/no-go reportée dans NTAUTH-114.
