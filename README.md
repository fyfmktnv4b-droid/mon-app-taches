# Mon App Tâches

PWA de planification matinale : capture rapide de tâches, tri via une matrice urgent/important (Eisenhower), priorités du jour (urgent + important) mises en évidence sans troncature. Synchronisée entre appareils via Supabase (email/mot de passe), avec export JSON local en filet de sécurité.

## État actuel (Plan 1 sur 3)

Implémenté : authentification, CRUD des tâches, tri Eisenhower avec tests unitaires, écran principal (capture, à trier, priorités, matrice, historique en lecture seule), export JSON.

À venir : cache hors-ligne + installation PWA (Plan 2), rappels par notification push (Plan 3). Voir `docs/superpowers/specs/2026-09-04-mon-app-taches-design.md` pour la conception complète, et `docs/superpowers/plans/` pour le détail de chaque plan.
