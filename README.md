# Mon App Tâches

PWA de planification matinale : capture rapide de tâches, tri via une matrice urgent/important (Eisenhower), priorités du jour (urgent + important) mises en évidence sans troncature. Synchronisée entre appareils via Supabase (email/mot de passe), avec export JSON local en filet de sécurité.

## État actuel (Plans 1 et 2 sur 3)

Implémenté : authentification, CRUD des tâches, tri Eisenhower avec tests unitaires, écran principal (capture, à trier, priorités, matrice, historique en lecture seule), export JSON, cache hors-ligne (IndexedDB + file de mutations rejouée au retour du réseau) et installation PWA (manifest, icônes, service worker).

À venir : rappels par notification push, écran Réglages, keep-alive (Plan 3). Voir `docs/superpowers/specs/2026-09-04-mon-app-taches-design.md` pour la conception complète, et `docs/superpowers/plans/` pour le détail de chaque plan.

## Déploiement

⚠️ Après tout changement d'un fichier listé dans `ASSETS` de `service-worker.js`, incrémenter `CACHE_VERSION` (ex : `v1` → `v2`) avant de pousser — sinon les navigateurs continueront de servir l'ancienne version en cache indéfiniment.

Le SDK Supabase est vendorisé dans `vendor/` (même origine) : un import CDN cross-origin ne peut pas être mis en cache par le service worker, ce qui casserait le démarrage hors-ligne. Voir `vendor/README.md` pour la régénération.
