# Illustrations de l'écran d'accueil

Déposer ici les 7 PNG (fond transparent, haute résolution) générés pour chaque
jour de la semaine, avec exactement ces noms — ils sont référencés tels quels
par `dayScenes.js` :

- `dimanche.png` — sieste dans un hamac
- `lundi.png` — réveil, assis sur le lit
- `mardi.png` — attablé, en train de boire un café
- `mercredi.png` — au travail sur l'ordinateur
- `jeudi.png` — coupe des légumes sur une planche
- `vendredi.png` — développé couché à la salle de sport
- `samedi.png` — en train de peindre

Tant qu'un fichier est absent, l'écran d'accueil affiche automatiquement une
carte de repli dégradée (aucun changement de code nécessaire).

Une fois les fichiers ajoutés : les lister dans `ASSETS` de
`service-worker.js` et incrémenter `CACHE_VERSION`, sinon ils ne seront pas
disponibles hors-ligne.
