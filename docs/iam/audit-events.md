# Journal d’audit IAM

Chaque mutation de service, catalogue, grant, policy, version, groupe et
attachement écrit un événement dans la même transaction PostgreSQL que la
mutation métier. Une migration protège les lignes contre toute mise à jour : une
correction produit donc toujours un nouvel événement. Seule la purge de rétention
peut supprimer des lignes arrivées à expiration.

Un événement public contient uniquement :

- l’acteur (`user` ou `system`) ;
- la cible (`type` et identifiant) ;
- le scope (`organizationId` et `service`) ;
- l’action, le résultat, la date serveur et le `correlationId` issu du
  `x-request-id` ;
- les métadonnées IAM scalaires explicitement autorisées.

Les documents de policy, mots de passe, cookies, tokens et secrets ne sont ni
nécessaires aux événements IAM ni restitués par l’API. La projection de lecture
utilise une allowlist : une clé de metadata non déclarée reste invisible même si
elle a été insérée directement en base.

## Consultation

`GET /api/v1/audit-events` exige une session authentifiée. Un administrateur de
plateforme peut consulter toute organisation active ; un owner ou admin ne peut
consulter que son organisation active. Pour les événements globaux du catalogue,
le filtre `service` sans `organization_id` est réservé au propriétaire du service
ou à un administrateur plateforme. Les membres simples et les accès inter-tenant
sont refusés.

```http
GET /api/v1/audit-events?organization_id=00000000-0000-4000-8000-000000000001&service=ntscout&action=iam.policy.create&limit=50
Cookie: better-auth.session_token=...
```

Filtres optionnels : `service`, `action`, `outcome`, `limit` (1 à 100) et
`cursor`. `nextCursor` est opaque et ordonne les événements par date puis UUID,
ce qui évite les doublons quand plusieurs mutations partagent le même timestamp.
`organization_id` est requis pour un journal tenant ; sans organisation,
`service` devient obligatoire et sélectionne uniquement le journal global de ce
service.

```json
{
  "events": [
    {
      "action": "iam.policy.create",
      "actor": { "id": "user-id", "type": "user" },
      "correlationId": "request-id",
      "metadata": { "service": "ntscout", "version": 1 },
      "outcome": "success",
      "scope": { "organizationId": "organization-id", "service": "ntscout" },
      "target": { "id": "policy-id", "type": "iam_policy" }
    }
  ],
  "nextCursor": null,
  "retentionDays": 365
}
```

## Rétention

La durée V1 est fixée à 365 jours. Les lectures excluent toujours les événements
antérieurs à cette fenêtre. Le worker exécute la purge au démarrage puis toutes
les 24 heures ; une panne temporaire conserve donc trop d’historique au lieu de
supprimer prématurément des preuves.

Les tests exécutables couvrent la redaction, l’autorisation tenant-scoped, les
filtres invalides, la pagination concurrente à timestamps identiques,
l’immutabilité PostgreSQL et la purge bornée.
