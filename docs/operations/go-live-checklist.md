# Checklist de mise en production NTAuth V1

Cette checklist est la source de décision go/no-go de NTAUTH-114. Une case cochée doit pointer vers
une preuve reproductible. Les cases non cochées nécessitent une action opérateur ou un environnement
externe ; elles interdisent le go-live tant qu'elles restent ouvertes.

## Candidat et qualité — propriétaire NTAuth

- [x] `bun install --frozen-lockfile` est imposé et les dépendances sont en versions exactes.
- [x] `bun run check` couvre format Oxfmt, Oxlint, types, tests et builds.
- [x] Les scénarios OAuth, IAM, audit, outbox et migrations disposent de tests automatisés.
- [ ] Le commit candidat définitif et les résultats GitHub Actions sont joints à NTAUTH-114.
- Preuves : `package.json`, `bun.lock`, `.github/workflows/ci.yaml`, rapports CI du commit candidat.

## Sécurité — propriétaire NTAuth

- [x] Inscription publique et Dynamic Client Registration sont désactivées.
- [x] Cookies, CORS, CSP, proxy de confiance, limites Redis et audit append-only sont testés.
- [x] Logs et métriques appliquent une redaction centralisée des secrets et données sensibles.
- [ ] La revue `docs/security/security-review.md` ne contient plus de finding Critical/Major
      `Planned`, ou chaque risque restant possède une acceptation signée avec échéance.
- [ ] Les canaris de secret sont absents des logs, métriques, exports et couches de l'image
      candidate publiée.
- Preuves : `docs/security/threat-model.md`, sortie de la revue, digest et rapport de scan candidat.

## Images et chaîne de livraison — propriétaire Platform

- [x] Les quatre targets applicatives utilisent Bun `slim`, un utilisateur non-root et une version
      exacte.
- [x] Le workflow construit API, worker, web et migrate, produit SBOM/provenance et bloque sur le
      scan Trivy avant publication.
- [x] Les actions GitHub sont épinglées par SHA complet.
- [ ] Les quatre images du commit candidat sont publiées dans GHCR avec leurs digests immuables.
- [ ] Le Compose de production référence uniquement ces digests et `preflight.sh` réussit sur le
      VPS.
- Preuves : `.github/workflows/oci.yaml`, sortie CI, digests GHCR et sortie du preflight.

## Infrastructure, réseau et TLS — propriétaire Platform

- [x] PostgreSQL, Redis et les services applicatifs ne publient aucun port hôte dans le Compose de
      production.
- [x] Les réseaux `edge` et `data` isolent le proxy des données et le réseau `data` est interne.
- [ ] Les enregistrements DNS de production pointent vers le VPS prévu.
- [ ] Le reverse proxy utilise un certificat valide, TLS moderne et transmet uniquement les
      headers approuvés.
- [ ] Le pare-feu n'expose que SSH administré, HTTP et HTTPS ; Docker n'est pas exposé.
- [ ] Les limites CPU, mémoire et disque sont adaptées à la capacité réelle du VPS.
- Preuves : `compose.production.yaml`, résolution DNS, rapport TLS, règles pare-feu et métriques VPS.

## Secrets et accès — propriétaire Platform

- [x] Le Compose consomme des fichiers Docker secrets et aucun secret de production n'a de valeur
      par défaut.
- [ ] Les secrets PostgreSQL, Redis, Better Auth, SMTP, OAuth et Grafana ont été générés dans le
      gestionnaire approuvé et injectés avec permissions minimales.
- [ ] Les clés de signature OAuth de production ont un identifiant de rotation et une copie de
      récupération protégée.
- [ ] Les accès GitHub, GHCR, VPS, PostgreSQL et Grafana respectent le moindre privilège et MFA.
- [ ] La procédure de rotation de chaque secret a été testée et son propriétaire est identifié.
- Preuves : inventaire sans valeur secrète, ACL, date de rotation et journal du test.

## Données, migrations et sauvegardes — propriétaires NTAuth et Platform

- [x] Les migrations prennent un advisory lock et suivent expand/migrate/contract.
- [x] Le backup chiffre avant écriture, produit checksum et métadonnées.
- [x] Une restauration locale isolée a validé 28 tables et 19 migrations avec un RTO de 1 seconde.
- [ ] Une sauvegarde chiffrée automatique est stockée hors du VPS avec rétention et alerte d'échec.
- [ ] Une restauration depuis ce stockage est réussie en staging et son RPO/RTO est accepté.
- [ ] La migration candidate et le rollback applicatif N-1 sont exercés en staging.
- Preuves : `docs/operations/evidence/2026-08-09-local-restore.md`, sauvegarde staging et rapport de
  restauration.

## Observabilité et incident — propriétaire Platform

- [x] API et worker exposent métriques bornées, logs JSON corrélés et readiness.
- [x] Prometheus charge sa configuration et ses 8 règles ; Alertmanager charge sa configuration.
- [x] Grafana est provisionné avec le dashboard NTAuth sans exposition directe de port.
- [ ] Le receiver Alertmanager réel est configuré et une alerte de bout en bout est acquittée.
- [ ] La rétention métriques/logs, les accès Grafana et la capacité disque sont validés sur le VPS.
- [ ] Les contacts primaire et secondaire d'incident ont accepté l'astreinte et le chemin
      d'escalade.
- Preuves : `docs/operations/observability.md`, capture Grafana, notification de test et registre
  d'astreinte.

## Charge et récupération — propriétaires NTAuth et Platform

- [x] Le harness borné échoue au-delà de 1 % d'erreurs ou d'un p95 de 1 seconde.
- [x] Le tir local de 10 utilisateurs a servi 117 705 requêtes avec 0 erreur et un p95 de 1,98 ms.
- [ ] Les paliers 10/25/50 utilisateurs passent en staging avec ressources et métriques archivées.
- [ ] La concurrence refresh et les pannes Redis, SMTP et PostgreSQL sont exercées en staging.
- [ ] Le retour au digest N-1 est exercé sans suppression de volume ni rollback destructif.
- Preuves : `docs/operations/evidence/2026-08-09-local-load.md` et rapports de drills staging.

## Flux fonctionnels et communication — propriétaires NTAuth et Product

- [ ] Inscription/invitation, vérification email, login, MFA, récupération et logout passent sur le
      domaine de production.
- [ ] Le parcours OAuth NTScout complet passe avec redirect URI, issuer, audience et scopes de
      production.
- [ ] Les modèles d'email, adresse d'expédition, SPF, DKIM et DMARC sont vérifiés.
- [ ] Les mentions de confidentialité, durée de rétention et support sont approuvées.
- [ ] La fenêtre de déploiement, le gel des changements et le message aux parties prenantes sont
      confirmés.
- Preuves : rapport E2E horodaté, headers email, validation Product et message de changement.

## Décision go/no-go — propriétaires NTAuth, Platform et Product

- [ ] Toutes les cases bloquantes précédentes sont cochées avec preuves accessibles.
- [ ] Le responsable NTAuth confirme le candidat et les migrations.
- [ ] Le responsable Platform confirme l'infrastructure, les sauvegardes et le rollback.
- [ ] Le responsable Product confirme les flux et la fenêtre de lancement.
- [ ] La décision, l'heure, les participants, les digests et le point de retour arrière sont
      consignés dans NTAUTH-114.

En cas de no-go, conserver les preuves, assigner chaque écart et choisir une nouvelle fenêtre. Ne
jamais contourner un contrôle en modifiant la checklist après la décision.
