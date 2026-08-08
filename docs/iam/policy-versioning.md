# Versionnement des policies IAM

Une policy appartient à une organisation et à un service. Sa création produit la
version 1 après validation stricte du document contre le catalogue actif du
service. Son nom est unique dans ce périmètre.

```http
POST /api/v1/iam/policies
Content-Type: application/json

{
  "organizationId": "00000000-0000-4000-8000-000000000001",
  "service": "ntscout",
  "name": "Lecture des rapports",
  "document": {
    "version": "2026-01-01",
    "statements": [{
      "effect": "Allow",
      "actions": ["ntscout:report:read"],
      "resources": ["ntscout:report:*"]
    }]
  }
}
```

Chaque modification ajoute une ligne immuable dans `iam_policy_versions`. Le
client doit envoyer la version qu’il a lue ; une écriture concurrente rend cette
précondition obsolète et retourne `409 policy_conflict`.

```http
PUT /api/v1/iam/policies/:id
Content-Type: application/json

{
  "expectedVersion": 1,
  "document": {
    "version": "2026-01-01",
    "statements": [{
      "effect": "Deny",
      "actions": ["ntscout:report:read"],
      "resources": ["ntscout:report:*"]
    }]
  }
}
```

Le rollback ne réécrit jamais l’historique : il copie le document cible dans une
nouvelle version et renseigne `sourceVersion`. L’historique complet reste lisible
avec `GET /api/v1/iam/policies/:id/history`.

```http
POST /api/v1/iam/policies/:id/rollback
Content-Type: application/json

{"expectedVersion":3,"targetVersion":1}
```

Une policy peut être retirée de l’évaluation sans supprimer son historique avec
`PATCH /api/v1/iam/policies/:id/status` et `{ "status": "inactive" }`.

Toutes les routes exigent une session, appliquent la politique MFA de NTAuth et
sont réservées aux owners/admins actifs de l’organisation ou aux platform admins.
Les documents hors catalogue et les accès inter-tenant échouent fermés. Les
créations, modifications, rollbacks, changements de statut et refus sont audités.
