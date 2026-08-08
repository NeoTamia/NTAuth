# Résolution des policies effectives

Le resolver expose les statements applicables au sujet authentifié dans un scope
organisation/service précis :

```http
GET /api/v1/iam/effective-policies?organization_id=00000000-0000-4000-8000-000000000001&service=ntscout
```

L’utilisateur n’est jamais accepté comme paramètre. NTAuth le prend dans la
session, puis vérifie dans cet ordre :

1. l’utilisateur, son membership et l’organisation sont actifs ;
2. le service demandé est actif ;
3. un service grant actif existe pour ce triplet utilisateur/organisation/service ;
4. les policies et leurs versions courantes sont actives et cohérentes ;
5. au moins un attachement actif correspond directement à l’utilisateur, à son
   rôle ou à l’un de ses groupes dans l’organisation.

Sans service grant actif, la réponse contient des listes vides. Un scope
inter-tenant est refusé. Les policies trouvées par plusieurs chemins sont
dédupliquées, triées par nom puis ID, et leurs statements conservent l’ordre du
document. Le résultat est ainsi stable pour une même version des données.

```json
{
  "organizationId": "00000000-0000-4000-8000-000000000001",
  "service": "ntscout",
  "subjectUserId": "user_123",
  "policies": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "name": "Lecture des rapports",
      "version": 3,
      "documentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "statements": [
        {
          "effect": "Allow",
          "actions": ["ntscout:report:read"],
          "resources": ["ntscout:report:*"]
        }
      ]
    }
  ],
  "statements": [
    {
      "effect": "Allow",
      "actions": ["ntscout:report:read"],
      "resources": ["ntscout:report:*"]
    }
  ]
}
```

Une policy désactivée, un attachement détaché, un membership suspendu ou un grant
révoqué disparaît immédiatement de la résolution. Le tableau `statements` peut
être transmis à l’évaluateur IAM, qui applique ensuite la priorité du Deny
explicite et le refus implicite en l’absence d’Allow.
