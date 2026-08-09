# Releases NTAuth

## Principes

- les packages publics suivent SemVer ;
- npm public est le registre principal ;
- GitHub Packages reçoit le même tarball et la même version ;
- une version publiée est immuable ;
- les applications restent privées et sont identifiées par le SHA Git et l’image OCI ;
- les dépendances externes restent épinglées exactement dans le dépôt.

## Choix du niveau SemVer

- `patch` : correction compatible ou changement interne visible sans nouvelle capacité ;
- `minor` : nouvelle API compatible ;
- `major` : suppression, renommage ou changement incompatible.

Les versions `0.x` restent traitées strictement : tout changement incompatible incrémente la version mineure et doit porter un `BREAKING CHANGE` explicite.

## Préparer un changement

Chaque changement utilise un Conventional Commit. `fix` produit un patch, `feat` une version
mineure et un pied `BREAKING CHANGE:` signale une incompatibilité. Tant que la version reste en
`0.x`, une incompatibilité incrémente la version mineure.

Release Please analyse les fichiers touchés et ne versionne que les packages publics concernés.
Les trois packages gardent des versions indépendantes. Le plugin `node-workspace` suit les
dépendances locales : si `@neotamia/permissions` change, `@neotamia/elysia-auth` reçoit aussi le
bump patch nécessaire pour publier sa nouvelle référence.

## Préparer les versions

À chaque push sur `dev`, `.github/workflows/release-please.yaml` met à jour un PR de release agrégé.
Ce PR contient uniquement les versions et changelogs des packages à publier. Sa fusion crée un tag
par composant (`permissions-vX.Y.Z`, `elysia-auth-vX.Y.Z` ou `nuxt-auth-vX.Y.Z`) puis le workflow
Gitflow fusionne le même commit dans `main` et resynchronise `dev`.

Le manifest `.release-please-manifest.json` est vide pendant le bootstrap `0.1.0`, puis devient la
source de vérité des dernières versions publiées. Il ne doit pas être modifié manuellement en dehors
d’un bootstrap ou d’une réparation documentée.

## Publication npm

La CI publie avec provenance depuis les tags par composant. Le workflow
`.github/workflows/npm-release.yaml` sélectionne le package correspondant au tag ; un package
inchangé n’est ni reconstruit ni publié. Son lancement manuel exécute un dry-run des trois packages
sans accès au token npm.

Avant publication, `release:verify` reconstruit le package sélectionné, vérifie ses exports
ESM/types, inspecte le contenu déclaré du tarball, recherche du matériel d’authentification et
refuse une version `0.0.0`. Le protocole `workspace:*` reste autorisé dans les sources : `bun pm
pack` le remplace par la version locale exacte. `release:prepare` extrait ensuite le
`package.json` du tarball et refuse toute dépendance non exacte avant publication.

Conditions :

- authentification npm fournie par secret CI ;
- provenance npm signée via OIDC avec la permission minimale `id-token: write` ;
- aucun token dans les logs ;
- version absente du registre avant publication ;
- contenu du tarball inspecté avec `bun pm pack --dry-run` ;
- tag Git correspondant créé par Release Please depuis le commit de release validé.

## Miroir GitHub Packages

Le miroir ne reconstruit pas le package. `release:prepare` produit une fois chaque tarball et écrit
son SHA-256 et sa taille dans `release-artifacts/manifest.json`. `release:publish` vérifie ce
manifeste avant chaque envoi, puis publie exactement le même fichier sur npm public et
`npm.pkg.github.com` avec la même version.

Avant chaque envoi, le publieur consulte les deux registres. Une relance après succès npm et échec
GitHub saute npm et reprend uniquement le miroir. Toute exception recalcule l’état des deux
registres et signale explicitement la publication partielle. Le `GITHUB_TOKEN` du workflow dispose
uniquement de `contents: read` et `packages: write` ; npm utilise son secret séparé et la provenance
OIDC.

La release échoue si :

- les deux tarballs diffèrent ;
- une version existe déjà sur un seul registre ;
- la metadata de package contient une URL ou visibilité incorrecte.

## Images OCI

Les applications publient des images GHCR identifiées par :

- le SHA Git complet ;
- jamais uniquement `latest` pour un déploiement.

Le passage d’une release dans `main` déclenche une construction OCI, mais les images restent
adressées par leur SHA immuable afin de ne pas coupler les versions indépendantes des packages npm
à une version artificielle de toute l’application.

Les migrations sont exécutées par une étape dédiée avant le remplacement des conteneurs applicatifs.

## Rollback

- package : publier une nouvelle version corrective ; ne jamais écraser une version ;
- application : redéployer une image OCI précédente compatible avec le schéma courant ;
- base : utiliser une migration corrective ou la stratégie expand/migrate/contract ;
- secret compromis : révoquer et faire tourner, sans réécrire l’historique Git comme mécanisme principal.

## Échecs partiels

Si npm réussit et GitHub Packages échoue :

1. ne pas republier npm ;
2. conserver le tarball et son checksum ;
3. reprendre uniquement le miroir ;
4. vérifier l’identité binaire des artefacts ;
5. terminer la release avant d’en commencer une autre.

## Responsabilité

Le PR Release Please nécessite une validation humaine tant que le pipeline complet n’a pas été
éprouvé sur une prerelease. L’automatisation ne contourne jamais les protections des registries.
