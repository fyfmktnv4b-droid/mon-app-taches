---
name: fin-de-chantier
description: Prépare la relecture de fin de chantier (diff, contrôle des données personnelles, auteurs des commits, captures, rapport). Aucune suppression, aucun push.
argument-hint: "[version, ex. v44] [dossier-de-captures]"
disable-model-invocation: true
---

# Fin de chantier : préparer la relecture

Arguments reçus : `$ARGUMENTS`
- 1er argument : la version (ex. `v44`). S'il manque, lis `APP_VERSION` dans `version.js`, annonce la valeur trouvée et demande confirmation avant de continuer.
- 2e argument (optionnel) : le dossier de captures. S'il manque, cherche d'abord un dossier nommé `captures-<version>` dans le dossier de travail de la session (scratchpad), puis dans les dossiers de travail d'anciennes sessions sous `/private/tmp/claude-*/`. Ne demande le chemin que si tu ne le trouves pas.

Règles : aucune suppression, aucun `git push`, aucun `git fetch` (on compare avec le `origin/main` local ; dis dans le rapport qu'il peut avoir un peu de retard). Réponds en français simple. Chaque écriture hors du dépôt demande la confirmation habituelle : ne la contourne pas et n'ajoute aucune règle de permission.

## Étapes

1. **Diff.** Écris le diff entre `origin/main` et `HEAD` dans `~/Desktop/diff-<version>.txt` (commande : `git diff origin/main HEAD > ~/Desktop/diff-<version>.txt`). Si le fichier existe déjà, ne l'écrase pas : demande quoi faire. Affiche son nombre de lignes (`wc -l`).
2. **Contrôle des données personnelles.** Récupère le motif de contrôle dans `CLAUDE.local.md` (fichier personnel, ignoré par git). Ne l'écris jamais dans un fichier du dépôt et ne le recopie pas dans un commit. Applique-le aux seules lignes **ajoutées** du diff (lignes commençant par `+`, hors `+++`), sans tenir compte de la casse. Affiche les lignes trouvées, ou « aucune correspondance ». Si `CLAUDE.local.md` est absent, dis-le et arrête cette étape.
3. **Auteurs.** Affiche l'auteur et l'e-mail de chaque commit du chantier : `git log origin/main..HEAD --format='%h %an <%ae>'`. Ne les copie nulle part.
4. **Captures.** Copie le dossier de captures sur le Bureau sans rien écraser (`cp -Rn`). Annonce d'abord le dossier source trouvé et la destination.
5. **Rapport final**, en français simple : version, nombre de lignes du diff, résultat du contrôle, commits (hash et sujet seulement), emplacement des fichiers sur le Bureau, points à relire, et ce qui n'a pas pu être fait.

À la fin, rappelle les règles de CLAUDE.md : afficher `git status`, `git log` et `git diff`, puis arrêter tout serveur local et tout Chrome lancés.
