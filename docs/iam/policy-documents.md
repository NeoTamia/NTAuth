# Documents de policy IAM V1

NTAuth accepte uniquement la version `2026-01-01`. Le parseur partagé
`parsePolicyDocument` échoue fermé : il refuse les champs inconnus, tableaux vides,
doublons, identifiants hors catalogue ou hors service et dépassements de taille.

Une action et une ressource commencent par le service puis utilisent `:` comme
séparateur. Un wildcard est autorisé uniquement comme dernier segment. Par exemple,
`ntscout:report:read` et `ntscout:report:*` sont valides ; `*:report:read` et
`ntscout:*:read` sont refusés.

```json
{
  "version": "2026-01-01",
  "statements": [
    {
      "sid": "ReadOwnReports",
      "effect": "Allow",
      "actions": ["ntscout:report:read"],
      "resources": ["ntscout:report:*"],
      "conditions": {
        "StringEquals": {
          "organization.id": "org_123"
        },
        "Bool": {
          "user.email_verified": true
        }
      }
    }
  ]
}
```

Les opérateurs V1 déclarés sont `StringEquals`, `StringLike`, `StringNotEquals` et
`Bool`. Les variables appartiennent exclusivement aux namespaces `user`,
`organization` et `service`. L’évaluateur applique ensuite un refus implicite par
défaut et donne toujours priorité à un `Deny` explicite.

Les variables V1 sont fermées : `user.id`, `user.email`, `user.email_verified`,
`user.name`, `organization.id`, `organization.slug`, `organization.role`,
`service.key` et `service.environment`. Une variable absente fait échouer la
condition. Les conditions d’un statement sont combinées avec AND ; les tableaux
de valeurs d’un même opérateur utilisent OR. `StringLike` accepte `*` et `?` sur
la chaîne complète, en traitant les autres caractères comme des littéraux.

Les limites exportées dans `POLICY_LIMITS` font partie du contrat : document de
64 Kio, 100 statements, 50 actions et 100 ressources par statement, 20 clés de
condition et 20 valeurs par clé. Les tests du package exécutent l’exemple ci-dessus
et les frontières de chaque règle.

L’évaluation locale utilise `evaluatePolicy({ statements, action, resource,
context })`. Son résultat indique `allowed`, la raison `explicit_allow`,
`explicit_deny` ou `implicit_deny`, et les SID Allow/Deny correspondants triés.
Un Deny correspondant gagne toujours, quel que soit l’ordre des statements. Un
identifiant de requête doit être concret ; seuls les motifs de policy peuvent se
terminer par `:*`.
