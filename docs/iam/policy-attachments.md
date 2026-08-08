# Attachements des policies IAM

Une policy peut être attachée à un utilisateur, un groupe ou un rôle de la même
organisation. Le service et l’organisation sont toujours ceux de la policy : ils
ne sont pas fournis par le client et ne peuvent donc pas diverger.

Les groupes sont propres à une organisation. Leur création et l’ajout d’un membre
vérifient que l’acteur peut administrer l’organisation et que l’utilisateur en est
un membre actif.

```http
POST /api/v1/iam/groups
Content-Type: application/json

{"organizationId":"00000000-0000-4000-8000-000000000001","name":"Auditeurs"}
```

```http
PUT /api/v1/iam/groups/:groupId/members/:userId
```

Les trois formes d’attachement utilisent le même endpoint :

```http
POST /api/v1/iam/policies/:policyId/attachments
Content-Type: application/json

{"principalType":"user","principalId":"user_123"}
```

```json
{ "principalType": "group", "principalId": "00000000-0000-4000-8000-000000000002" }
```

```json
{ "principalType": "role", "principalId": "member" }
```

Les seuls rôles valides sont `owner`, `admin` et `member`. Un utilisateur doit
être actif dans l’organisation, et un groupe doit appartenir à celle-ci. Un seul
attachement actif d’un principal donné est permis par policy, y compris sous
concurrence.

`GET /api/v1/iam/policies/:policyId/attachments` liste les attachements actifs.
`DELETE /api/v1/iam/attachments/:attachmentId` détache sans effacer l’historique ;
répéter la requête produit le même résultat et un audit marqué idempotent. Un
nouvel attachement du même principal reste ensuite possible.

Toutes les opérations exigent une session, appliquent la politique MFA de NTAuth,
sont auditées et échouent fermées pour les entrées invalides ou inter-tenant.
