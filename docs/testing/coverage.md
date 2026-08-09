# Stratégie de test NTAuth

La recette fonctionnelle du projet doit être automatisée au niveau le plus bas capable de prouver le comportement. Les tests utilisent exclusivement `TEST_DATABASE_URL`; ils ne doivent jamais écrire dans la base locale `DATABASE_URL`.

## Couverture automatique

| Parcours                                                     | Niveau principal                                   | État    |
| ------------------------------------------------------------ | -------------------------------------------------- | ------- |
| Connexion par formulaire POST, identifiants absents de l’URL | E2E Chromium + test unitaire du fallback HTML      | Couvert |
| Session, révocation, élévation MFA et rejeu TOTP             | Intégration API/DB                                 | Couvert |
| Création du premier administrateur                           | Intégration DB                                     | Couvert |
| Création d’un service, d’une action et d’une ressource IAM   | E2E Chromium + intégration API/DB                  | Couvert |
| Refus des identifiants hors service et des doublons          | Intégration API/DB                                 | Couvert |
| Activation et désactivation du service ou d’une entrée       | Intégration DB/API                                 | Couvert |
| Création et administration des organisations                 | Intégration API/DB                                 | Couvert |
| Invitations, acceptation et expiration                       | Intégration API/DB                                 | Couvert |
| Cycle de vie utilisateur et révocation des sessions          | Intégration API/DB                                 | Couvert |
| Création, versionnement, rollback et conflit des policies    | Intégration API/DB                                 | Couvert |
| Groupes, membres et attachements de policies                 | Intégration API/DB                                 | Couvert |
| Calcul des permissions effectives et cache Redis             | Intégration API/DB                                 | Couvert |
| Grants de service, suspension et révocation                  | Intégration API/DB                                 | Couvert |
| Clients OAuth publics/confidentiels, redirect URI et PKCE    | Intégration API/DB                                 | Couvert |
| Audit, pagination, export et masquage des secrets            | Intégration API/DB                                 | Couvert |
| Mot de passe oublié, jeton expiré/utilisé et changement      | Intégration API/DB                                 | Couvert |
| En-têtes CSP/CORS et cookies de sécurité                     | Intégration API + tests unitaires de configuration | Couvert |

## Parcours navigateur à étendre

Les tests d’intégration prouvent déjà les règles métier. Les E2E suivants doivent être ajoutés progressivement pour protéger leur assemblage dans l’interface, sans recopier toutes les permutations déjà couvertes côté API :

1. enrôlement MFA complet depuis un compte administrateur sans MFA ;
2. création d’une organisation, invitation puis acceptation dans un second contexte navigateur ;
3. création visuelle d’une policy à partir du catalogue, nouvelle version puis rollback ;
4. création d’un client OAuth public et exécution du parcours Authorization Code avec PKCE ;
5. suspension d’un utilisateur ou d’un grant puis constat du refus dans une seconde session ;
6. recherche et export d’un événement d’audit créé pendant le scénario.

## Recette humaine conservée

Ces vérifications reposent sur un jugement ou une infrastructure réelle et ne doivent pas être simulées comme des tests déterministes :

- cohérence visuelle, lisibilité et absence de collision à 320 px, tablette et bureau ;
- ordre de tabulation, lecteur d’écran et annonce vocale sur les navigateurs réellement supportés ;
- rendu des e-mails chez les fournisseurs cibles et délivrabilité réelle ;
- comportement derrière le proxy TLS, les domaines et le stockage de secrets de production ;
- sauvegarde/restauration chronométrée et exercices de reprise après incident ;
- charge, latence et alertes sur une topologie proche de la production.

## Commandes

```bash
# Toute la validation statique et les tests unitaires/intégration
bun run check

# Parcours navigateur avec API, Nuxt, PostgreSQL et Redis de test
bun run test:e2e
```

Playwright démarre l’API sur le port `3101` et Nuxt sur `3100`. Il initialise uniquement la base définie par `TEST_DATABASE_URL`, crée un administrateur réservé à l’E2E, puis supprime ses données et événements d’audit à la fin de la suite.
