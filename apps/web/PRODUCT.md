# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

NTAuth sert les utilisateurs NeoTamia invités dans une ou plusieurs organisations,
les owners et administrateurs d’organisation qui gèrent leurs membres et leurs
droits, ainsi que les administrateurs plateforme responsables des opérations les
plus sensibles.

## Product Purpose

NTAuth est l’autorité d’identité centrale de NeoTamia. L’application permet de se
connecter, récupérer un compte, accepter une invitation et administrer les
organisations, utilisateurs, sessions, clients OAuth, services, grants, policies
et événements d’audit. La réussite signifie qu’un utilisateur accomplit son
action dans le bon contexte d’organisation sans ambiguïté sur sa portée ni
affaiblissement des contrôles serveur.

## Positioning

Une identité globale est combinée à un contexte explicite d’organisation et de
service. Les décisions fines restent centralisées dans un IAM versionné à refus
implicite, avec `Deny` prioritaire, tandis que chaque mutation sensible est
auditable.

## Operating Context

L’interface Nuxt et l’API Elysia sont servies en même origine en production sur
`auth.neotamia.re`. Les comptes sont créés par invitation ; l’inscription publique
est interdite. NTScout est le premier client OAuth/OIDC. Les utilisateurs peuvent
changer d’organisation, tandis que les actions plateforme exigent une session
d’administration activée par un challenge TOTP récent.

## Capabilities and Constraints

- Interface et messages en français cohérent.
- Nuxt 4, Vue 3 et TypeScript strict ; aucune confiance dans l’état client.
- PostgreSQL est la source de vérité et Redis ne contient que des données
  reconstructibles.
- Authentification Better Auth par e-mail et mot de passe de 12 à 128 caractères.
- Récupération anti-énumération, jetons à usage unique et redirections locales
  protégées.
- Les états vide, chargement, erreur, interdit et succès sont explicites.
- Les actions sensibles affichent leur portée et sont autorisées côté serveur.
- Les dépendances externes restent épinglées à une version exacte ; Oxc assure le
  formatage et le lint.

## Brand Commitments

Le nom produit est NTAuth et la marque mère NeoTamia. Le ton est sobre, direct,
rassurant et précis, sans promesse marketing inventée.

## Evidence on Hand

Le contrat produit et sécurité est décrit dans
`../../docs/adr/0001-ntauth-v1-architecture.md`. Les routes API, tests
d’intégration et documents `../../docs/` constituent les preuves exécutables. Le
projet ne contient encore ni logo final, ni photographie, ni témoignage ; ces
éléments ne doivent pas être fabriqués.

## Product Principles

- Refuser de façon sûre quand le contexte ou l’autorisation manque.
- Montrer clairement l’identité, l’organisation, le service et l’impact d’une
  action.
- Garder les parcours sensibles courts, explicites et récupérables.
- Faire de l’accessibilité et du clavier des chemins principaux, pas des ajouts.
- Ne jamais exposer un secret après l’instant strictement nécessaire.

## Accessibility & Inclusion

Les parcours ciblent WCAG AA, l’usage clavier complet, des labels et annonces
lecteur d’écran explicites, des contrastes suffisants, un responsive mobile sans
perte fonctionnelle et une réduction des animations selon la préférence système.
