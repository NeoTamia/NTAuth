# Spike 0001 — Better Auth OAuth 2.1 Provider ou OIDC Provider

- Statut : accepté
- Date : 2026-08-08
- Ticket : NTAUTH-41
- Décision : `@better-auth/oauth-provider`
- Versions évaluées : `better-auth@1.6.26` et `@better-auth/oauth-provider@1.6.26`

## Question

Quel plugin Better Auth doit servir de base au serveur d’autorisation NTAuth ?

## Matrice de décision

| Critère                | OAuth 2.1 Provider                               | OIDC Provider historique                           |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------- |
| Maintenance            | Plugin activement recommandé                     | Déprécié en 1.6, supprimé en 1.7                   |
| Authorization Code     | OAuth 2.1, `response_type=code`                  | OAuth 2.0/OIDC historique                          |
| PKCE                   | Requis par défaut, S256 pour les clients publics | Configuration globale plus permissive              |
| Clients                | Publics et confidentiels                         | Publics et confidentiels                           |
| JWT/JWKS               | Intégration JWT active par défaut                | Intégration JWT optionnelle                        |
| Refresh tokens         | Rotation à chaque refresh                        | Support historique, politique moins stricte        |
| Révocation RFC 7009    | Endpoint intégré                                 | Non exposé par le prototype                        |
| Introspection RFC 7662 | Endpoint intégré                                 | Non exposé par le prototype                        |
| Logout OIDC            | RP-Initiated Logout intégré                      | End-session historique                             |
| Client credentials     | Intégré                                          | Non couvert par le périmètre historique testé      |
| Secrets clients        | Hashés par défaut                                | Migration nécessaire depuis le stockage historique |
| Rate limiting OAuth    | Configuration par endpoint                       | Dépend davantage du rate limiting global           |
| Claims personnalisés   | Access token et UserInfo                         | UserInfo et ID token historiques                   |
| Compatibilité Bun      | Import et instanciation validés                  | Import validé avec avertissement de dépréciation   |
| Pérennité              | Cible de migration officielle                    | Suppression annoncée                               |

## Preuves

La documentation officielle du provider moderne indique :

- OAuth 2.1 et compatibilité OIDC ;
- PKCE obligatoire par défaut ;
- JWT/JWKS ;
- Authorization Code, Refresh Token et Client Credentials ;
- introspection RFC 7662, révocation RFC 7009 et logout OIDC.

La documentation de migration et le guide Better Auth 1.7 annoncent la suppression de l’ancien `oidcProvider`. La mise à jour de sécurité de juin 2026 recommande également la migration vers `@better-auth/oauth-provider`.

Sources :

- <https://better-auth.com/docs/plugins/oauth-provider>
- <https://better-auth.com/docs/guides/1-7-upgrade-guide>
- <https://better-auth.com/blog/security-update-june-2026>
- <https://better-auth.com/blog/1-6>

## Prototype

Le prototype se trouve dans :

- `apps/api/src/auth/oauth-provider.ts`
- `apps/api/src/auth/oauth-provider.test.ts`

Il prouve que :

- le plugin moderne s’instancie sous Bun ;
- les endpoints token, introspection, révocation, UserInfo et end-session existent ;
- les durées et options de sécurité NTAuth sont configurables ;
- le plugin historique émet un avertissement de dépréciation ;
- le plugin historique testé n’expose pas les endpoints modernes d’introspection et de révocation.

Commande de validation :

```bash
bun test apps/api/src/auth/oauth-provider.test.ts
```

## Décision

NTAuth utilise `@better-auth/oauth-provider`.

L’ancien `oidcProvider` ne sera pas intégré au produit. Son import reste limité au test du spike et sera supprimé lorsque Better Auth 1.7 sera adopté.

## Conséquences

- PKCE S256 reste obligatoire pour NTScout.
- Dynamic Client Registration reste désactivée.
- Le JWT plugin reste actif.
- Les secrets clients et tokens opaques sont hashés.
- L’issuer et les chemins discovery seront validés dans les tests d’intégration.
- Le contexte organisationnel sera ajouté avec `customAccessTokenClaims` après l’implémentation du modèle d’organisations.
- Une migration Better Auth 1.7 devra retirer le test d’import du plugin historique.
