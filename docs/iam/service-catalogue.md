# Catalogue IAM des services

Le catalogue est global et fermé. Un platform admin crée un service avec une clé
unique, un nom, un propriétaire utilisateur actif et un statut. Le propriétaire
ou un platform admin peut ensuite déclarer ses actions et ressources.

```http
POST /api/v1/services
Content-Type: application/json

{"key":"ntscout","name":"NTScout","ownerUserId":"user_service_owner"}
```

```http
POST /api/v1/iam/catalog
Content-Type: application/json

{"service":"ntscout","kind":"action","identifier":"ntscout:report:read"}
```

Les identifiants appartiennent obligatoirement au service indiqué. Les doublons,
wildcards non terminaux, services inactifs et mutations par un autre propriétaire
échouent fermés. Une action ou ressource peut être désactivée avec
`PATCH /api/v1/iam/catalog/:id` et `{ "status": "inactive" }`.

`GET /api/v1/iam/catalog/:service` ne retourne que les entrées actives et expose
uniquement la clé/nom du service ainsi que les identifiants/descriptions. Les IDs
des propriétaires et créateurs ne font pas partie de la réponse publique.

Lors de la validation d’une policy, NTAuth fournit les deux ensembles actifs à
`validatePolicyDocument`. Toute action ou ressource absente est alors refusée avec
une erreur localisée `catalogue`. Les tests DB et API exécutent ces exemples et
couvrent unicité, ownership, statuts, transfert contrôlé et isolation de service.
