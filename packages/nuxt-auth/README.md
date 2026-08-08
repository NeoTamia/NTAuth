# @neotamia/nuxt-auth

Composables de session, middleware et primitives OAuth PKCE pour intégrer NTAuth à Nuxt sans
exposer les tokens au JavaScript du navigateur.

## Installation

```bash
bun add @neotamia/nuxt-auth@<version-exacte> nuxt@4.5.2 vue@3.5.41
```

## Modèle BFF recommandé

Le navigateur appelle uniquement des routes same-origin `/api/ntauth/*`. Le serveur Nuxt échange
le code, conserve access token et refresh token dans des cookies `HttpOnly; Secure; SameSite=Lax`,
et ne retourne au composable que l’identité minimale et l’expiration.

```ts
// plugins/ntauth.ts
import { createNTAuthSession } from "@neotamia/nuxt-auth";

export default defineNuxtPlugin(() => ({
  provide: { ntauth: createNTAuthSession({ expectedIssuer: "https://auth.example.com" }) },
}));
```

```ts
// middleware/auth.ts
import { createNTAuthMiddleware } from "@neotamia/nuxt-auth";

export default defineNuxtRouteMiddleware((to) =>
  createNTAuthMiddleware(useNuxtApp().$ntauth, navigateTo)(to),
);
```

Le composable fournit `hydrate`, `login`, `handleCallback`, `refresh`, `logout`, `session`,
`identity`, `status` et `isAuthenticated`. Les appels `refresh` concurrents partagent la même
promesse. Aucun état global n’est créé à l’import : chaque application ou requête SSR possède son
instance.

## Transaction PKCE serveur

`createAuthorizationRequest` génère un verifier PKCE, un challenge S256, un `state` et un `nonce`
cryptographiquement aléatoires. `sealAuthorizationTransaction` chiffre et authentifie cette
transaction avec AES-GCM avant son placement dans un cookie HttpOnly. Au callback,
`openAuthorizationTransaction` vérifie le sceau, le state, l’âge maximal de cinq minutes et le
chemin de retour local avant que le serveur utilise le verifier et le nonce.

## Routes BFF

Le transport HTTP attend :

- `GET /api/ntauth/login?returnTo=/...` → `{ authorizationUrl }` ;
- `POST /api/ntauth/callback` → snapshot de session ;
- `GET /api/ntauth/session` → snapshot ou `401` ;
- `POST /api/ntauth/refresh` → snapshot ou `401` ;
- `POST /api/ntauth/logout` → révocation puis suppression des cookies.

Les erreurs de callback, transaction et session sont des `NTAuthProtocolError` avec un code stable.
Le logout local est appliqué même si la révocation distante échoue.

## Compatibilité

Le package publie des modules ESM et leurs types pour Nuxt 4.5.2, Vue 3.5.41, Bun 1.3.14+ et
Node.js 20+. Les changements incompatibles suivent la politique SemVer du dépôt NTAuth.
