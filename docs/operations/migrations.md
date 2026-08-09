# Migrations de production

## Règles

Chaque évolution suit expand/migrate/contract : ajouter un schéma compatible, déployer le code
capable de lire les deux formes, migrer les données par lots, puis retirer l’ancien schéma dans
une version ultérieure. Une même migration ne mélange pas suppression irréversible et dépendance
immédiate du nouveau code.

Le conteneur `migrate` ouvre une seule connexion PostgreSQL et acquiert
`ntauth_production_migration` avec `pg_try_advisory_lock`. Un second job échoue immédiatement au
lieu d’exécuter une migration concurrente. L’API et le worker ne démarrent qu’après la réussite du
job.

## Revue avant fusion

- Fournir le fichier `.sql` montant et le `.down.sql` correspondant.
- Documenter durée estimée, verrous PostgreSQL, volume de lignes et compatibilité N-1/N.
- Éviter les valeurs par défaut volatiles et les réécritures de table dans la fenêtre de pointe.
- Utiliser `NOT VALID` puis `VALIDATE CONSTRAINT` pour une contrainte coûteuse lorsque possible.
- Définir si une sauvegarde fraîche est obligatoire. Toute suppression ou transformation de
  données l’impose.
- Exécuter montée, descente et remontée sur une restauration staging représentative.

## Exécution

`deploy/scripts/deploy.sh` lance le backup avant le job de migration. Pour une intervention
manuelle, utiliser uniquement l’image au digest prévu :

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm migrate up
```

Conserver heure UTC, digest de l’image, dernière ligne de `drizzle.__drizzle_migrations`, durée et
résultat des checks post-déploiement.

## Retour arrière

Le premier choix est le rollback applicatif vers les anciens digests, car expand/contract garde
le schéma compatible. `migrate down` n’est autorisé que si la fiche de migration confirme qu’aucune
donnée nouvelle ne sera perdue et après sauvegarde vérifiée :

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm migrate down
```

Si le `down` est risqué, arrêter les écritures et restaurer la sauvegarde dans une base isolée.
Valider cette restauration avant de décider d’un basculement. Ne jamais supprimer un volume pour
simuler un rollback.
