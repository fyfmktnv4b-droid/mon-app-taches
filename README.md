# Mon App Tâches

PWA de planification matinale : capture rapide de tâches, tri via une matrice urgent/important (Eisenhower), priorités du jour (urgent + important) mises en évidence sans troncature. Synchronisée entre appareils via Supabase (email/mot de passe), avec export JSON local en filet de sécurité.

## État actuel (Plans 1 à 3 sur 3 — terminés)

Implémenté : authentification, CRUD des tâches, tri Eisenhower avec tests unitaires, écran principal (capture, à trier, priorités, matrice, historique en lecture seule), export JSON, cache hors-ligne (IndexedDB + file de mutations rejouée au retour du réseau), installation PWA (manifest, icônes, service worker), rappels par notification push (Web Push / VAPID, abonnement par appareil) et écran Réglages (heure du rappel matinal, activation des notifications).

Un écran d'accueil (jour, citation connue + verset biblique en écho, scène du lapin du jour) s'affiche à chaque ouverture de l'app, avant la vue des tâches — voir `illustrations/README.md` pour y déposer les PNG définitifs des scènes.

La conception est désormais entièrement implémentée. Voir `docs/superpowers/specs/2026-09-04-mon-app-taches-design.md` pour la conception complète, et `docs/superpowers/plans/` pour le détail de chaque plan.

## Déploiement

⚠️ Après tout changement d'un fichier listé dans `ASSETS` de `service-worker.js`, incrémenter `CACHE_VERSION` (ex : `v1` → `v2`) avant de pousser — sinon les navigateurs continueront de servir l'ancienne version en cache indéfiniment.

Le SDK Supabase est vendorisé dans `vendor/` (même origine) : un import CDN cross-origin ne peut pas être mis en cache par le service worker, ce qui casserait le démarrage hors-ligne. Voir `vendor/README.md` pour la régénération.
