# ADR 0001 — Architecture NTAuth V1

- Statut : accepté
- Date : 2026-08-08
- Ticket : NTAUTH-42
- Décideurs : équipe NTAuth

## Contexte

NeoTamia a besoin d’une autorité d’identité unique pour ses applications. NTAuth doit authentifier les utilisateurs, émettre des tokens OAuth 2.1/OIDC, centraliser les organisations et les droits, puis fournir des bibliothèques clientes cohérentes à NTScout et aux futurs services.

La V1 utilise NTScout comme client pilote. Les comptes sont créés sur invitation, l’inscription publique est interdite et le MFA TOTP est obligatoire pour les administrateurs plateforme. Le déploiement cible un VPS Docker derrière TLS.

## Décision

NTAuth est un monorepo Bun/Turborepo composé de trois applications et de packages partagés. PostgreSQL est la source de vérité, Redis ne contient que des données reconstructibles, et Better Auth fournit l’identité ainsi que le protocole OAuth 2.1/OIDC.

### Applications

#### `apps/api`

API Elysia responsable de :

- monter Better Auth sous `/api/auth/*` ;
- exposer discovery OAuth/OIDC et JWKS sur les chemins annoncés par l’issuer ;
- exposer l’API métier versionnée sous `/api/v1` ;
- valider authentification, organisation active et rôle plateforme ;
- gérer organisations, invitations, services, grants, policies et audit ;
- publier les health checks `/health` et `/ready`.

`/health` prouve que le processus répond. `/ready` vérifie les dépendances obligatoires avant d’accepter du trafic.

#### `apps/web`

Application Nuxt 4 responsable de :

- connexion, récupération de compte et acceptation d’invitation ;
- configuration MFA ;
- consentement OAuth ;
- sélection de l’organisation active ;
- administration des utilisateurs, organisations, clients, grants et policies ;
- consultation du journal d’audit.

En production, le web et l’API sont servis sous `https://auth.neotamia.re`. Le reverse proxy route `/api` vers Elysia et le reste vers Nuxt. Ce modèle même origine évite d’utiliser CORS pour le navigateur de production. En développement, CORS utilise une liste explicite d’origines locales.

#### `apps/worker`

Worker Bun responsable de :

- consommer l’outbox email PostgreSQL ;
- envoyer invitations, vérifications et réinitialisations via SMTP ;
- appliquer retries bornés et backoff ;
- déplacer les messages définitivement échoués vers un état terminal observable ;
- exécuter ultérieurement les nettoyages et rotations planifiées.

Le worker ne reçoit aucun trafic public.

### Packages

| Package                 | Responsabilité                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `@neotamia/config`      | Configuration TypeScript et conventions partagées                              |
| `@neotamia/db`          | Schéma Drizzle, client PostgreSQL, migrations et repositories                  |
| `@neotamia/permissions` | Types, validation et évaluation déterministe des policies                      |
| `@neotamia/elysia-auth` | Validation JWT/JWKS, scopes et chargement des policies dans un resource server |
| `@neotamia/nuxt-auth`   | PKCE, session cliente, middleware et composables Nuxt                          |
| `@neotamia/test-utils`  | Fixtures et utilitaires d’intégration sans secrets                             |

Les packages publiables ne dépendent jamais d’un chemin interne aux applications.

## Provider d’identité et OAuth

NTAuth utilise :

- `better-auth@1.6.26` ;
- `@better-auth/oauth-provider@1.6.26` ;
- le plugin JWT Better Auth ;
- l’adapter Drizzle PostgreSQL.

Le choix du provider est détaillé dans le spike 0001. L’ancien `oidcProvider` est exclu car il est déprécié et supprimé par Better Auth 1.7.

Paramètres protocolaires V1 :

- issuer canonique : `https://auth.neotamia.re/api/auth` ;
- Authorization Code uniquement pour les utilisateurs ;
- PKCE S256 obligatoire pour NTScout ;
- Dynamic Client Registration désactivée ;
- redirect URIs comparées exactement ;
- authorization code : 5 minutes et usage unique ;
- access token : 15 minutes ;
- refresh token : 30 jours, rotation à chaque usage ;
- JWT asymétriques vérifiables via JWKS ;
- secrets clients et tokens opaques hashés ;
- révocation RFC 7009, introspection RFC 7662 et logout OIDC fournis par le provider.

Les routes ne sont pas copiées dans les clients. Les clients découvrent les endpoints à partir de la metadata de l’issuer.

## Identités et organisations

Better Auth possède les tables techniques utilisateur, session, compte, vérification, MFA, OAuth et JWKS. NTAuth ajoute son domaine métier sans dupliquer ces données.

Règles :

- un utilisateur possède une identité globale ;
- un utilisateur peut appartenir à plusieurs organisations ;
- chaque membership porte un rôle d’organisation ;
- les rôles plateforme sont distincts des rôles d’organisation ;
- un token utilisateur représente une organisation active et un service cible ;
- changer d’organisation nécessite un nouveau contexte d’autorisation ;
- une suspension globale révoque toutes les sessions et tous les accès ;
- une suspension de membership ne touche que l’organisation concernée.

L’invitation est un objet métier à usage unique, expire après 72 heures et peut préconfigurer l’organisation, le rôle et les grants. Son acceptation vérifie l’email et crée le membership dans une transaction.

## IAM

NTAuth centralise deux niveaux :

1. `service_grant` autorise l’entrée dans un service pour un utilisateur et une organisation ;
2. les policies décrivent les actions fines autorisées ou refusées.

Une policy est un document versionné contenant des statements :

- `effect` : `Allow` ou `Deny` ;
- `actions` : actions déclarées dans le catalogue du service ;
- `resources` : ressources déclarées ou motifs valides ;
- `conditions` : opérateurs explicitement supportés.

Règles d’évaluation :

- refus implicite par défaut ;
- `Deny` explicite prioritaire ;
- toutes les entrées sont validées avant persistance ;
- une version publiée est immuable ;
- les attachments ciblent un utilisateur, un groupe ou un rôle dans une organisation ;
- l’évaluateur pur vit dans `@neotamia/permissions` ;
- l’API calcule les policies effectives et un ETag par sujet, organisation et service.

Les resource servers ne peuvent pas modifier les policies. Ils vérifient le token, chargent les policies effectives et évaluent localement les requêtes métier.

## Claims des access tokens

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

Le JWT ne contient pas la policy complète ni de metadata arbitraire. Les données changeantes restent récupérées via l’API IAM.

## API publique

L’API métier utilise `/api/v1`. Les familles de ressources sont :

- `/invitations` ;
- `/users` et `/users/:id/sessions` ;
- `/organizations` et `/organizations/:id/members` ;
- `/services` ;
- `/oauth-clients` ;
- `/service-grants` ;
- `/iam/catalog` ;
- `/iam/policies` et leurs versions ;
- `/iam/policy-attachments` ;
- `/iam/effective-policies` ;
- `/audit-events`.

Les réponses d’erreur non Better Auth utilisent `application/problem+json` :

```ts
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  requestId: string;
  errors?: Record<string, string[]>;
}
```

Les endpoints de collection utilisent une pagination par curseur. Les mutations supportant un retry acceptent un header `Idempotency-Key`. Les dates sont encodées en ISO 8601 UTC. Les IDs applicatifs sont des UUID.

## Données et transactions

PostgreSQL 18 est la source de vérité. Drizzle fournit le schéma et les migrations versionnées.

Les transactions couvrent notamment :

- acceptation d’invitation et création de membership ;
- création ou révocation d’un grant et écriture d’audit ;
- publication d’une version de policy et invalidation logique ;
- création d’un événement d’outbox avec la mutation métier associée.

Les migrations sont monotones en production. Une migration destructive est découpée en expand/migrate/contract. Un rollback applicatif ne suppose jamais qu’une colonne supprimée puisse être recréée avec ses données.

## Cache et invalidation

Redis contient uniquement :

- compteurs de rate limiting ;
- caches de policies effectives ;
- signaux d’invalidation ;
- verrous courts nécessaires aux workers.

Une indisponibilité Redis ne doit jamais accorder un droit. Pour l’autorisation, le système revient à PostgreSQL ou refuse de façon sûre selon l’opération. Les clés de cache incluent version de schéma, sujet, organisation, service et ETag.

## Email et outbox

L’API n’attend pas le serveur SMTP. Elle écrit un événement `email_outbox` dans la même transaction que l’action métier. Le worker réserve les événements avec `FOR UPDATE SKIP LOCKED`, enregistre chaque tentative et applique un backoff exponentiel borné.

Les tokens bruts d’invitation et de récupération ne sont jamais journalisés. La base ne conserve que leur représentation hashée lorsque le fournisseur ne le fait pas déjà.

## Audit

Les opérations sensibles écrivent un événement append-only contenant :

- acteur et type d’acteur ;
- organisation et service éventuels ;
- action et ressource ;
- résultat ;
- adresse IP normalisée et user agent ;
- request ID ;
- timestamp serveur ;
- metadata filtrée sans secret.

L’audit est écrit dans la transaction métier lorsqu’il prouve une mutation. Les événements ne sont ni modifiés ni supprimés par l’API d’administration courante.

## Sécurité

- TLS obligatoire en production ;
- cookies `Secure`, `HttpOnly` et `SameSite` adaptés au flux ;
- CORS en allowlist stricte en développement et inutile pour le flux navigateur même origine en production ;
- CSP définie par Nuxt/reverse proxy ;
- protection CSRF de Better Auth conservée ;
- rate limiting global et renforcé sur login, token, invitation et récupération ;
- MFA obligatoire pour les rôles plateforme ;
- secrets fournis par l’environnement ou des fichiers Docker secrets, jamais committés ;
- logs structurés avec redaction ;
- validation stricte de l’issuer, de l’audience, de l’expiration et des scopes par les resource servers.

## Déploiement

Le déploiement VPS utilise des images OCI immuables :

- `ntauth-api` ;
- `ntauth-web` ;
- `ntauth-worker`.

PostgreSQL, Redis et SMTP sont configurables comme services externes ou conteneurisés selon l’environnement. Le reverse proxy termine TLS. Les migrations s’exécutent dans une étape unique avant le déploiement applicatif, jamais au démarrage simultané de plusieurs replicas.

## Observabilité

Chaque application émet des logs JSON avec `requestId`. L’API propage W3C Trace Context. Les métriques minimales couvrent latence, erreurs, connexions, émissions de tokens, échecs d’authentification, rate limits, profondeur d’outbox et échecs SMTP.

Aucune métrique ne contient email, token, secret ou contenu de policy.

## Publication des packages

Les packages `@neotamia/*` utilisent SemVer. npm public est le registre principal et GitHub Packages reçoit le même tarball et la même version. Une release ne peut pas republier une version existante.

## Alternatives considérées

### Services indépendants

Séparer immédiatement identité, OAuth et IAM augmenterait les frontières réseau, les transactions distribuées et la charge d’exploitation sans bénéfice pour la V1. Le monolithe modulaire est retenu ; les packages et modules préservent des frontières extractibles.

### IAM local dans chaque application

Cette approche réduit le rôle de NTAuth mais reproduit catalogues, rôles et administration. Elle est rejetée car NeoTamia veut une gouvernance centralisée.

### Tokens contenant toutes les permissions

Cette approche évite un fetch mais produit de gros tokens et rend la révocation moins réactive. Elle est rejetée au profit d’un ETag et de policies effectives mises en cache.

### File externe pour les emails dès la V1

Une infrastructure supplémentaire n’est pas nécessaire au volume initial. Une outbox PostgreSQL assure durabilité et atomicité. Elle pourra alimenter un broker ultérieurement sans changer les producteurs métier.

### Kubernetes

Le coût d’exploitation n’est pas justifié pour la V1. Les images OCI et health checks restent compatibles avec une migration future.

## Conséquences

### Positives

- une seule source de vérité pour l’identité et l’autorisation ;
- flux OAuth standard et découvrable ;
- droits révocables sans attendre l’expiration complète d’un JWT ;
- transactions métier, audit et outbox cohérents ;
- packages clients réutilisables ;
- déploiement initial simple et migration future possible.

### Négatives

- NTAuth devient une dépendance critique des services NeoTamia ;
- le modèle IAM central demande une gouvernance stricte des catalogues ;
- la sélection d’organisation ajoute une étape au flux utilisateur ;
- l’outbox et l’invalidation demandent une exploitation attentive ;
- Better Auth doit être suivi activement, notamment lors du passage à 1.7.

### Risques maîtrisés

- indisponibilité : health checks, sauvegardes, restauration testée et dégradation sûre ;
- compromission de token : durées courtes, rotation, révocation et audit ;
- divergence des permissions : versionnement, ETag et invalidation ;
- verrou fournisseur : contrats NTAuth isolés dans les modules et packages, sans exposer directement les types internes Better Auth dans l’API métier.

## Décisions désormais fermées pour le milestone B

- monorepo Bun/Turborepo ;
- Elysia, Nuxt 4 et worker Bun ;
- PostgreSQL 18 comme source de vérité ;
- Drizzle pour schéma et migrations ;
- Redis uniquement pour données reconstructibles ;
- Better Auth OAuth 2.1 Provider avec JWT/JWKS ;
- API même origine en production ;
- outbox PostgreSQL et SMTP configurable ;
- organisations centrales et tokens scoped par organisation/service ;
- IAM central avec évaluation locale dans les resource servers ;
- Docker sur VPS et images OCI ;
- npm public avec miroir GitHub Packages.
