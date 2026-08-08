# Service grants

Un service grant autorise un utilisateur à entrer dans un service pour une
organisation précise. NTAuth refuse l’émission de `ntscout:access` si le grant,
le membership ou l’organisation n’est pas actif.

Un owner ou admin d’organisation crée un grant avec une requête authentifiée :

```http
POST /api/v1/service-grants
Content-Type: application/json
X-Request-Id: provision-ntscout-alice

{
  "organizationId": "8eb6278b-d83c-47f8-a506-5a3957d3d782",
  "service": "ntscout",
  "userId": "user_alice"
}
```

`PATCH /api/v1/service-grants/:id` avec `{ "active": false }` suspend le grant
de manière réversible. `DELETE /api/v1/service-grants/:id` le révoque de manière
terminale et idempotente. Une nouvelle attribution crée ensuite un nouvel
identifiant ; l’ancien enregistrement révoqué reste disponible dans l’historique.

Le triplet organisation, service et utilisateur n’accepte qu’un grant courant.
Toutes les mutations sont transactionnelles et corrélées par `X-Request-Id`. Une
cible sans membership actif dans l’organisation est refusée sans créer de donnée.
Les tests d’intégration DB, API et OAuth exécutent ces exemples, y compris la
concurrence, l’isolation cross-tenant et le refus d’émission sans grant actif.
