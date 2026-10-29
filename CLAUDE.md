# Règles du dépôt

Ce dépôt est **public** : aucun secret, jamais.

## Méthode
- Plan d'abord : l'afficher et attendre l'accord avant de modifier quoi que ce soit.
- Un commit local par sujet. Aucun push sans accord explicite.
- À la fin du plan, dire si Opus ou Sonnet suffit pour la suite.
- À la fin du travail : afficher `git status`, `git log` et `git diff`, puis arrêter tout serveur local et tout Chrome lancés.

## Versions
- Si un fichier de l'app (ceux de `ASSETS`, dans `service-worker.js`) change : `CACHE_VERSION` (`service-worker.js`) et `APP_VERSION` (`version.js`) montent **ensemble** de 1. `versionSync.test.js` vérifie l'égalité.

## Tests
- Écrire ou adapter les tests, puis lancer `node --test` : tout doit être vert.
- Les essais n'utilisent **jamais** le vrai Supabase : passer par le banc (`scripts/bench/`, voir son README).

## Interface
- Couleurs uniquement via les variables de `:root` ; pas de rouge en dehors des erreurs.
- Zones tactiles d'au moins 44 px.
- Aucun style ni script en ligne : la CSP les bloque.
