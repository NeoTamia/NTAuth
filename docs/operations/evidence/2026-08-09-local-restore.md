# Preuve de restauration locale — 2026-08-09

- Source : volume PostgreSQL local de développement, PostgreSQL `18.4-trixie`.
- Commande de sauvegarde : `deploy/scripts/backup-postgres.sh` avec une clé RSA 2048 éphémère
  dédiée au test.
- Artefact : dump custom GPG de 62 KiB, aucun dump clair écrit sur disque.
- SHA-256 : `b92a7b235162c20ab564e724bdc6e527460bf4f6a2481c259acc433ce138bfb0`.
- Cible isolée : `ntauth_restore_h_20260809` ; la base source `ntauth` n’a pas été modifiée.
- Validation : 28 tables publiques et 19 migrations Drizzle présentes.
- RTO mesuré par le script : 1 seconde.
- Résultat : succès.

Cette preuve valide les scripts et le chemin cryptographique local. Elle ne remplace pas
l’exercice staging sur un volume représentatif, avec transfert hors site et clé opérateur, requis
avant le go-live.
