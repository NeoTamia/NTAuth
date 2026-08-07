# Refonte complète de NTAuth

## Objectif

Repartir de zéro avec :

- YouTrack `NTAUTH` comme unique source de vérité ;
- une nouvelle histoire Git sans sauvegarde de l’ancien commit ;
- Bun, Turborepo, Nuxt 4, Elysia, Better Auth, Drizzle, PostgreSQL et Redis ;
- une V1 centrée sur NTScout ;
- des comptes créés uniquement par invitation ;
- un MFA obligatoire pour les administrateurs ;
- des organisations et un IAM centralisés ;
- des packages publiés sur npm public et GitHub Packages ;
- un déploiement Docker sur VPS.

## 1. Nettoyage de YouTrack

Pour les 31 tickets existants :

1. Retirer les métadonnées et liens Linear.
2. Ajouter une note indiquant qu’ils sont archivés par la refonte d’août 2026.
3. Ajouter un commentaire de remplacement.
4. Passer leur état à `Canceled`.
5. Conserver leurs IDs uniquement comme historique.

Les nouveaux tickets utiliseront :

- `Milestone` pour les epics ;
- `Subtask` pour leurs tâches ;
- `Task` pour les travaux transverses ;
- `alwyn974` comme responsable initial ;
- des estimations, priorités, dépendances et critères d’acceptation explicites.

Aucune échéance ne sera fixée sans date de lancement officielle.

## 2. Nouveau backlog

### A — Cadrage et redémarrage

- Comparer Better Auth OAuth 2.1 Provider et OIDC Provider — `Critical`, `2d`
- Écrire l’ADR d’architecture — `Critical`, `1d`
- Recréer l’histoire Git et initialiser le monorepo — `Critical`, `1d`
- Définir les conventions de code, commits et releases — `Major`, `4h`

Le spike choisira selon la conformité OAuth/OIDC, PKCE, JWT/JWKS, rotation, refresh tokens, révocation, claims organisationnels et compatibilité Bun/Elysia. En cas d’égalité, OAuth 2.1 Provider sera retenu.

### B — Fondations

- Turborepo et Bun workspaces
- API Elysia avec health/readiness
- Web Nuxt 4
- Worker d’emails
- `packages/config`
- `packages/db` avec Drizzle
- PostgreSQL 18, Redis et SMTP de test
- CI GitHub Actions
- Validation des variables d’environnement
- Docker Compose de développement

### C — Identités et organisations

- Better Auth avec adapter Drizzle
- Organisations, membres et rôles
- Invitations valables 72 heures
- Vérification email obligatoire
- Configuration et récupération du mot de passe
- Gestion et révocation des sessions
- MFA TOTP obligatoire pour les administrateurs
- Suspension et suppression d’utilisateur
- Outbox SMTP avec retry

L’inscription publique restera entièrement désactivée.

### D — OAuth 2.1 et OIDC

- Intégration du provider choisi
- Discovery OAuth/OIDC et JWKS
- Registre administré des clients
- Client public NTScout
- Authorization Code avec PKCE S256
- Access et ID tokens
- Refresh token avec rotation et détection de rejeu
- Révocation et logout OIDC
- Sélection de l’organisation active
- Scopes et claims NTAuth
- Rotation des clés
- Tests de conformité OAuth

Valeurs initiales :

- access token : 15 minutes ;
- refresh token : 30 jours ;
- authorization code : 5 minutes, usage unique ;
- redirect URI comparée exactement ;
- dynamic client registration désactivée ;
- rotation des clés tous les 90 jours.

### E — IAM centralisé

- Catalogue des services, actions et ressources
- Grants par utilisateur, organisation et service
- Schéma des policies IAM
- CRUD et versionnement
- Attachments utilisateur, groupe et rôle
- Évaluateur Allow/Deny
- Conditions `StringEquals`, `StringLike`, `StringNotEquals` et `Bool`
- Résolution des policies effectives
- ETag par utilisateur, organisation et service
- Invalidation de cache
- Audit des changements IAM

Un `Deny` explicite sera toujours prioritaire. L’absence d’`Allow` signifiera un refus.

### F — Administration

- Connexion et récupération de compte
- Acceptation d’invitation
- Configuration MFA
- Gestion des utilisateurs et sessions
- Organisations et membres
- Clients OAuth et redirect URIs
- Services et grants
- Éditeur visuel/JSON de policies
- Consultation de l’audit
- Accessibilité et états d’erreur

### G — Packages et NTScout

- `@neotamia/permissions`
- `@neotamia/elysia-auth`
- `@neotamia/nuxt-auth`
- Documentation et exemples
- Publication npm publique
- Publication miroir GitHub Packages
- Intégration NTScout de bout en bout

npm sera le registre principal. Les deux registries recevront la même version et le même artefact.

### H — Sécurité et production

- Rate limiting et verrouillage temporaire
- Cookies, CORS et CSP
- Threat model
- Audit append-only et rétention
- Logs structurés, métriques et alertes
- Images OCI et GHCR
- Docker Compose de production
- Déploiement VPS
- Migrations contrôlées
- Sauvegarde/restauration PostgreSQL
- Tests de charge et récupération
- Checklist de mise en production

### Post-V1

- GitHub, Google et Microsoft OAuth
- Passkeys/WebAuthn
- Codes de récupération MFA
- Introspection RFC 7662
- NTMetrics
- NTPortal
- NTNewsletter
- Grafana
- Client credentials machine-to-machine

## 3. Structure du dépôt

```text
apps/
  api/
  web/
  worker/

packages/
  config/
  db/
  permissions/
  elysia-auth/
  nuxt-auth/
  test-utils/

infra/
  docker/
  scripts/
```

## 4. Contrats publics

API métier sous `/api/v1` :

```text
/invitations
/users
/users/:id/sessions
/organizations
/organizations/:id/members
/services
/oauth-clients
/service-grants
/iam/catalog
/iam/policies
/iam/policy-attachments
/iam/effective-policies
/audit-events
```

Claims des access tokens :

```ts
interface NTAuthAccessTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  jti: string;
  organization_id: string;
  service: string;
  scope: string;
  policies_etag: string;
}
```

Policy IAM :

```ts
interface PolicyDocument {
  version: "2026-01-01";
  statements: PolicyStatement[];
}

interface PolicyStatement {
  sid?: string;
  effect: "Allow" | "Deny";
  actions: string[];
  resources: string[];
  conditions?: Record<string, Record<string, string | boolean | string[]>>;
}
```

## 5. Nouvelle histoire Git

1. Vérifier que `origin/main` n’a pas changé.
2. Créer une branche orpheline.
3. Retirer l’ancien README et l’ancienne licence.
4. Créer le squelette minimal du monorepo.
5. Vérifier installation, lint, typecheck, tests et build.
6. Créer le commit racine `chore: initialize NTAuth monorepo`.
7. Remplacer localement `main`.
8. Publier avec `git push --force-with-lease origin main`.
9. Vérifier le nouvel historique sur GitHub.

Aucun tag, bundle ou branche de sauvegarde ne sera créé.

## 6. Validation de la V1

Le parcours obligatoire sera :

1. Un administrateur protégé par MFA invite un utilisateur.
2. L’utilisateur accepte l’invitation et configure son compte.
3. L’administrateur lui attribue NTScout et une policy.
4. NTScout démarre un flux OAuth avec PKCE.
5. NTAuth émet un token lié à l’organisation.
6. `@neotamia/elysia-auth` valide le token.
7. Les permissions sont récupérées et évaluées.
8. Une révocation invalide l’ETag et bloque l’accès.
9. Toutes les actions sensibles apparaissent dans l’audit.

Seront également testés : redirect URI incorrecte, rejeu de code ou refresh token, token expiré, mauvaise audience, invitation expirée, utilisateur suspendu, grant absent, policy invalide, conflit Allow/Deny, indisponibilité SMTP/Redis/PostgreSQL et restauration d’une sauvegarde.

## Définition de terminé

- aucune référence Linear active dans YouTrack ;
- ancien backlog annulé ;
- nouveau backlog estimé et relié ;
- nouvelle histoire Git publiée ;
- CI entièrement verte ;
- parcours NTScout validé ;
- tests de sécurité verts ;
- sauvegarde/restauration testée ;
- images de production publiées ;
- packages npm et GitHub identiques ;
- documentation développeur et exploitation disponible.

## Hypothèses retenues

- `NTAUTH` reste le projet YouTrack officiel.
- `alwyn974` est l’unique responsable initial.
- NTScout est le seul client bloquant pour la V1.
- Les organisations sont gérées centralement par NTAuth.
- L’inscription reste strictement désactivée.
- Le SMTP est configurable et sans fournisseur imposé.
- Le déploiement cible un VPS Docker derrière TLS.
- L’absence de sauvegarde de l’ancien historique Git est volontaire.
- La date de livraison sera définie après le spike OAuth et l’estimation réelle du premier milestone.
