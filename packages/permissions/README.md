# @neotamia/permissions

Contrats IAM V1, validation stricte et évaluateur `Deny` prioritaire, sans dépendance à NTAuth,
à un serveur ou à un framework.

## Installation

```bash
bun add @neotamia/permissions@<version-exacte>
```

Le package publie uniquement des modules ESM et leurs types TypeScript. Il cible Bun 1.3.14 ou
plus récent, Node.js 20 ou plus récent, ainsi que les bundles client/serveur Nuxt.

## Valider un document

```ts
import { parsePolicyDocument } from "@neotamia/permissions";

const policy = parsePolicyDocument(input, {
  expectedService: "ntscout",
  actions: new Set(["ntscout:report:read"]),
  resources: new Set(["ntscout:report:*"]),
});
```

`validatePolicyDocument` retourne toutes les erreurs localisées sans lever d’exception.
`parsePolicyDocument` lève une `PolicyValidationError` dont la propriété `issues` contient les
mêmes codes, chemins et messages. Un champ, opérateur, service ou identifiant inconnu est refusé.

## Évaluer une permission

```ts
import { evaluatePolicy } from "@neotamia/permissions";

const decision = evaluatePolicy({
  action: "ntscout:report:read",
  resource: "ntscout:report:quarterly",
  statements: policy.statements,
  context: {
    organization: { id: "organization-id", role: "member" },
    service: { key: "ntscout", environment: "production" },
    user: { id: "user-id", email: "user@example.com", email_verified: true },
  },
});

if (!decision.allowed) {
  // implicit_deny ou explicit_deny ; un Deny correspondant gagne toujours.
}
```

Les explications sont déterministes : `reason`, `matchedAllowStatements` et
`matchedDenyStatements` peuvent être journalisés sans exposer le document complet.

## Compatibilité

- les ajouts compatibles suivent une version mineure ;
- une rupture incrémente la version majeure, ou la version mineure tant que le package reste en
  `0.x` ;
- `POLICY_DOCUMENT_VERSION` identifie le schéma accepté ;
- les nouvelles conditions échouent fermées avec une ancienne version du package.

Consultez les contrats complets dans `docs/iam/` du dépôt NTAuth.
