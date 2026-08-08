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

```bash
bun run changeset
```

Le fichier généré doit :

- citer les packages réellement affectés ;
- utiliser le bon niveau SemVer ;
- décrire l’impact consommateur ;
- signaler migration et incompatibilité.

## Préparer les versions

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
bun run version-packages
```

`version-packages` met à jour versions, dépendances internes et changelogs. Le résultat est relu et committé avec :

```text
chore(release): version packages
```

## Publication npm

La CI publie avec provenance depuis un tag ou une branche protégée après toutes les validations :

```bash
bun run release
```

Le workflow `.github/workflows/npm-release.yaml` ne publie que depuis un tag `v*`. Son lancement
manuel exécute un dry-run complet sans accès au token npm. Avant publication, `release:verify`
reconstruit chaque package, vérifie ses exports ESM/types, inspecte le contenu du tarball, recherche
du matériel d’authentification et refuse `0.0.0` ou tout protocole `workspace:*` résiduel.

Conditions :

- authentification npm fournie par secret CI ;
- provenance npm signée via OIDC avec la permission minimale `id-token: write` ;
- aucun token dans les logs ;
- version absente du registre avant publication ;
- contenu du tarball inspecté avec `npm pack --dry-run` ;
- tag Git correspondant créé seulement après publication réussie.

## Miroir GitHub Packages

Le miroir ne reconstruit pas le package. La CI conserve le tarball npm produit, calcule son SHA-256, puis publie exactement cet artefact vers GitHub Packages avec la même version.

La release échoue si :

- les deux tarballs diffèrent ;
- une version existe déjà sur un seul registre ;
- la metadata de package contient une URL ou visibilité incorrecte.

## Images OCI

Les applications publient des images GHCR identifiées par :

- le SHA Git complet ;
- un tag de release lorsque pertinent ;
- jamais uniquement `latest` pour un déploiement.

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

Une release nécessite une validation humaine tant que le pipeline complet n’a pas été éprouvé sur une prerelease. L’automatisation ne contourne jamais les protections des registries.
