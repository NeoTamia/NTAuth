# Images OCI et composition de production

## Contrat de livraison

Le workflow `.github/workflows/oci.yaml` construit séparément `api`, `migrate`, `web` et
`worker` depuis le même commit. Chaque candidat est chargé localement et scanné avant sa
publication. Un résultat `HIGH` ou `CRITICAL` corrigible bloque le job. L’image publiée porte
uniquement le tag immuable `sha-<commit>` et reçoit les attestations BuildKit SBOM et provenance
maximale.

Les actions tierces sont figées par SHA complet. Trivy est également figé sur la version
remédiée `v0.36.0`; ne jamais remplacer ce SHA par un tag mobile. Le registre cible est GHCR et
le workflow n’a que `contents:read`, `packages:write` et `id-token:write`.

## Préparer un hôte

1. Installer Docker Engine avec le plugin Compose, puis créer une fois le réseau du reverse
   proxy : `docker network create proxy`.
2. Copier `compose.production.yaml` et `deploy/production.env.example` dans un répertoire détenu
   par l’utilisateur d’exploitation. Renommer l’exemple en `production.env` et le rendre lisible
   uniquement par cet utilisateur.
3. Créer `deploy/secrets` avec le mode `0700`, puis quatre fichiers en mode `0600` :
   `better-auth-secret`, `database-url`, `postgres-password`, `smtp-password` et
   `grafana-admin-password`.
4. Générer `better-auth-secret` avec au moins 32 octets aléatoires. Le mot de passe présent dans
   `database-url` doit être identique à `postgres-password`. Les fichiers ne doivent contenir que
   leur valeur, sans libellé.
5. Connecter le reverse proxy TLS au réseau `proxy`. Router le chemin public de l’API vers
   `api:3001` et le reste vers `web:3000`. PostgreSQL, Redis et le worker ne rejoignent jamais ce
   réseau et ne publient aucun port hôte. Refuser explicitement `/metrics` au public; publier
   Grafana sous une route séparée réservée aux opérateurs.

## Préflight reproductible

Depuis le commit à déployer :

```sh
bun install --frozen-lockfile
bun run check
docker build --target api -t ntauth-api:staging .
docker build --target migrate -t ntauth-migrate:staging .
docker build --target web -t ntauth-web:staging .
docker build --target worker -t ntauth-worker:staging .
docker compose --env-file deploy/production.env -f compose.production.yaml config --quiet
```

Après le workflow OCI, recopier ses quatre digests `sha256:...` dans `production.env`. Vérifier
qu’ils correspondent au commit attendu avec `docker buildx imagetools inspect`, puis tirer les
images avant la fenêtre de changement.

## Démarrage et diagnostic

La migration est un job unique et doit réussir avant l’API et le worker. Démarrer avec :

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml pull
docker compose --env-file deploy/production.env -f compose.production.yaml up -d postgres redis
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm migrate up
docker compose --env-file deploy/production.env -f compose.production.yaml up -d api worker web
docker compose --env-file deploy/production.env -f compose.production.yaml ps
```

Attendre les états `healthy`, puis vérifier `/ready`, la découverte OAuth et un parcours de
connexion staging. En cas d’échec, conserver les digests, l’heure UTC et les logs JSON corrélés.
Ne jamais afficher `docker compose config` sans rediriger sa sortie vers un emplacement protégé.

## Retour arrière

Un rollback applicatif consiste à remettre les quatre anciens digests puis à recréer uniquement
`api`, `worker` et `web`. Ne lancer `migrate down` que si le runbook de la migration concernée le
permet explicitement et après sauvegarde vérifiée. Les migrations expand/contract doivent garder
l’ancienne application compatible pendant toute la fenêtre.

Si la migration échoue, ne démarrer aucune nouvelle application : diagnostiquer le job `migrate`,
restaurer la sauvegarde si la migration a modifié des données de façon non réversible, puis
revenir aux anciens digests. Les volumes PostgreSQL et Redis ne sont jamais supprimés pendant un
rollback applicatif.
