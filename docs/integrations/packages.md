# Intégrer les packages NTAuth

## Versions et installation

Épinglez toujours les versions publiées. npm public est le registre principal.

```bash
bun add --exact @neotamia/permissions@0.1.0
bun add --exact @neotamia/elysia-auth@0.1.0 elysia@1.4.29
bun add --exact @neotamia/nuxt-auth@0.1.0 nuxt@4.5.2 vue@3.5.41
```

Les versions `0.1.0` illustrent la première release ; utilisez la version exacte annoncée dans le
changelog au moment de l’intégration.

## Serveur Elysia

1. Enregistrez l’audience et le service attendus, jamais ceux du token reçu.
2. Installez `ntauth(...)` avant les routes protégées.
3. Utilisez `auth.authorize` sur chaque ressource métier.
4. Journalisez `reason` et les identifiants de statements, jamais le JWT ni la policy complète.
5. Traitez `401` comme une réauthentification et `403` comme un refus de scope ou de grant.

L’exemple exécutable est dans `examples/elysia-resource-server`.

## Client Nuxt

Le modèle supporté est un Backend for Frontend :

1. le serveur génère puis scelle `state`, `nonce` et le verifier PKCE dans un cookie HttpOnly ;
2. le navigateur suit uniquement l’URL d’autorisation ;
3. le callback serveur vérifie issuer, state, nonce et code avant l’échange ;
4. access et refresh tokens restent dans des cookies `Secure; HttpOnly; SameSite=Lax` ;
5. les routes `/api/ntauth/session`, `/refresh` et `/logout` retournent seulement un snapshot ;
6. le middleware redirige vers un chemin local et le refresh concurrent est sérialisé.

L’exemple compilé est dans `examples/nuxt-bff`. Ses handlers 401 sont des frontières pédagogiques,
pas un échange OAuth prêt à déployer ; l’intégration NTScout E2E fournit l’implémentation complète.

## Contrats et erreurs

| Package       | Succès                                  | Erreurs stables                                                                        |
| ------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `permissions` | décision deny-first et explication      | `PolicyValidationError.issues`                                                         |
| `elysia-auth` | contexte identité/organisation/policies | `authentication_required`, `invalid_token`, `insufficient_scope`, `policy_unavailable` |
| `nuxt-auth`   | snapshot de session sans token          | `callback_error`, `invalid_callback`, `invalid_transaction`, `session_unavailable`     |

Les packages sont ESM-only. `permissions` fonctionne sur Bun, Node et dans un bundle Nuxt ;
`elysia-auth` cible les serveurs Bun/Elysia ; `nuxt-auth` cible Nuxt SSR et le navigateur moderne.

## Vérifier l’adoption

```bash
bun install --frozen-lockfile
bun run check
bun --filter @neotamia/example-elysia-resource-server test
bun --filter @neotamia/example-nuxt-bff build
```
