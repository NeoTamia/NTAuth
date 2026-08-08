# Cache et invalidation des permissions

La réponse de `GET /api/v1/iam/effective-policies` est mise en cache dans Redis
par utilisateur, organisation, service et génération de scope. Chaque entrée a un
TTL de 5 secondes ; Redis ne devient jamais la source de vérité IAM.

```text
ntauth:iam:effective:{organization}:{service}:{user}:{generation}
```

Après une mutation de grant, policy, attachement ou membre de groupe, l’API
incrémente la génération des scopes concernés. Les anciennes entrées deviennent
alors inaccessibles immédiatement et expirent naturellement.

L’invalidation utilise un script Lua atomique. Un événement est identifié par le
`x-request-id`, le type de mutation et le scope. Redis mémorise cet identifiant
pendant 24 heures avec `SET NX EX` ; rejouer le même événement ne ré-incrémente
donc pas la génération.

```text
mutation PostgreSQL validée
  -> événement Redis accepté une fois
  -> génération du scope incrémentée
  -> prochaine lecture recalculée depuis PostgreSQL
```

Les mutations restent valides si Redis est indisponible. Une erreur de connexion,
lecture, parsing ou écriture du cache provoque un calcul direct depuis PostgreSQL.
La réponse conserve alors son ETag normal. Une invalidation Redis en échec ne
masque pas la mutation ; les entrées éventuellement présentes restent en outre
bornées par le TTL de 5 secondes.

Le test E2E couvre le cache initial, le TTL Redis, le rejeu idempotent d’un
événement, une nouvelle version de policy, la révocation d’un service grant et le
fallback PostgreSQL avec un store Redis indisponible.
