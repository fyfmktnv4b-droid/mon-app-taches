# Mon App Tâches

Une application web, installable sur l'écran d'accueil du téléphone, pour organiser sa journée. On y note ses tâches en quelques secondes, on les range, on reprend celles de la veille. Elle propose aussi une routine du matin, des suivis quotidiens et des rappels par notification. Les données sont synchronisées entre appareils et l'app reste utilisable sans réseau.

## Fonctionnalités

Dans l'ordre où on les rencontre en ouvrant l'app :

- **Écran de chargement** : le logo sur fond vert, le temps de vérifier la connexion (au moins 1 seconde, 5 secondes au plus). L'écran de connexion n'apparaît que s'il faut vraiment se connecter.
- **Connexion** : par e-mail et mot de passe.
- **Accueil** : la date, une citation et une illustration du jour, puis le bouton « Commencer ». Il est grisé pendant le chargement.
- **Routine du matin** : quelques cases à cocher. « Continuer » quand tout est coché, ou « Passer pour aujourd'hui ». Elle n'est proposée que si elle n'est ni faite ni passée.
- **À reprendre aujourd'hui** : les tâches Important ou Autres des jours précédents qui ne sont pas terminées. Pour chacune :
  - **Récupérer** : elle retourne dans sa boîte, sans son ancien rappel ;
  - **Valider** : elle est terminée et comptée pour la veille ;
  - **Abandonner** : elle est supprimée définitivement à la sortie de l'écran.

  Chaque choix peut être annulé tant qu'on reste sur l'écran. « Passer pour l'instant » laisse un bandeau rose sur l'écran principal, qui rouvre l'écran d'un tap. L'écran n'apparaît que s'il y a au moins une tâche à reprendre.
- **Écran principal** :
  - un champ de capture rapide (une tâche par ligne, 1000 caractères au maximum par tâche) ;
  - les boîtes **Important** et **Autres**, et un bandeau **À trier** pour les tâches pas encore rangées ;
  - une case à cocher par tâche, puis « Validé ? » pour la terminer ;
  - la boîte **Terminé** (repliée), avec les tâches terminées aujourd'hui ;
  - une bande de suivis quotidiens.
- **Rappels par notification** :
  - un rappel du matin à heure fixe ;
  - un rappel ponctuel par tâche. Une heure déjà passée est refusée.
- **Historique** : les tâches terminées les jours précédents, en lecture seule.
- **Réglages** : l'heure du rappel du matin, et l'activation des notifications sur l'appareil. Ils demandent le réseau.
- **Sauvegarde** : « Sauvegarder mes tâches » télécharge un fichier JSON (un format texte standard) avec les tâches et la routine.
- **Hors-ligne et synchronisation** : l'app garde une copie locale des données. Une modification faite sans réseau est mise dans une file d'attente, puis envoyée dans l'ordre au retour du réseau. Entre deux appareils, la dernière modification arrivée l'emporte.

## Architecture en bref

- **PWA** (Progressive Web App : une application web qu'on peut installer sur l'écran d'accueil et ouvrir comme une app).
- **JavaScript sans framework**, en **modules ES** : du code découpé en fichiers par rôle, chargés directement par le navigateur, sans étape de construction.
- **Supabase**, un service en ligne qui fournit :
  - la connexion des utilisateurs ;
  - une base de données Postgres, protégée par **RLS** (Row Level Security : chaque utilisateur ne peut lire et modifier que ses propres lignes) ;
  - une **fonction serveur** lancée automatiquement chaque minute pour envoyer les rappels.
- **GitHub Pages** héberge les fichiers de l'app.
- **Service worker** : un script qui garde une copie des fichiers de l'app dans le téléphone, pour qu'elle s'ouvre même sans réseau.
  - Il ne retélécharge les fichiers que si `CACHE_VERSION` change dans `service-worker.js`.
  - Comme il n'y a pas d'outil de construction pour le faire automatiquement, il faut **incrémenter `CACHE_VERSION` à la main** (v33 → v34…) à chaque modification d'un fichier listé dans `ASSETS`. Sinon les appareils gardent l'ancienne version indéfiniment.
  - Tout nouveau fichier de l'app doit aussi être ajouté à `ASSETS`.
- **SDK Supabase copié dans `vendor/`** : la bibliothèque Supabase est servie depuis le même site que l'app, pour que le service worker puisse la garder en copie. Un démarrage hors-ligne serait sinon impossible. Voir `vendor/README.md`.
- **Base de données** : les migrations (scripts SQL qui modifient la structure de la base) sont dans `supabase/migrations/` et se lancent dans l'ordre de leur numéro. `supabase/rollback/` contient les retours en arrière, `supabase/checks/` des vérifications en lecture seule.

## Lancer et tester en local

Il faut Python 3 (présent sur macOS) et Node.js 18 ou plus récent.

1. Depuis le dossier du projet, lancer un petit serveur web local :
   ```
   python3 -m http.server 8080
   ```
2. Ouvrir `http://localhost:8080/index.html` dans Chrome.
   - Affichage téléphone : outils de développement (Cmd+Option+I), puis Cmd+Shift+M.
   - Pour être sûr de voir la dernière version : onglet **Application**, **Service Workers**, **Unregister**, puis **Storage**, **Clear site data**, et recharger avec Cmd+Shift+R.
3. Arrêter le serveur avec Ctrl+C.

⚠️ L'app locale utilise la **vraie** base Supabase configurée dans `supabaseClient.js` : ce qu'on y fait modifie les vraies données.

### Tests automatiques

```
node --test
```

116 tests, sans dépendance à installer. Ils couvrent la logique pure (sans écran ni réseau) :

- rangement des tâches, boîte Terminé et Historique ;
- dates et heures locales, y compris les changements d'heure ;
- règle des rappels ;
- routine du matin ;
- écran de chargement ;
- écran « À reprendre aujourd'hui » (sélection, actions, annulation, ordre des écritures hors-ligne) ;
- file de synchronisation ;
- export ;
- logique de la fonction de rappels ;
- garde-fous sur `index.html`.

L'interface elle-même n'est pas testée automatiquement : elle se vérifie dans le navigateur et sur téléphone.

## Structure du dépôt

| Fichier ou dossier | Rôle |
|---|---|
| `index.html`, `style.css` | La page unique de l'app et tout son style (couleurs dans les variables `:root`) |
| `app.js` | Les écrans, leur enchaînement au démarrage et les actions |
| `splashLogic.js` | Décision de l'écran de chargement |
| `repriseLogic.js`, `reprise.js`, `repriseScreen.js` | Écran « À reprendre aujourd'hui » : logique, données, affichage |
| `quadrants.js` | Rangement des tâches (Important, Autres, À trier, Terminé, Historique) |
| `localDate.js` | Dates et heures locales de l'appareil |
| `routineLogic.js`, `routines.js`, `routineBlock.js` | Routine du matin et suivis quotidiens |
| `tasks.js`, `settings.js`, `push.js` | Accès aux tâches, aux réglages et aux notifications |
| `sync.js`, `syncLogic.js`, `storage.js` | Hors-ligne : copie locale, file d'attente, synchronisation |
| `supabaseClient.js` | Connexion au projet Supabase |
| `export.js`, `quotes.js`, `dayScenes.js` | Sauvegarde JSON, citations et illustrations de l'accueil |
| `service-worker.js`, `manifest.json` | Fonctionnement hors-ligne, installation et notifications |
| `*.test.js` | Tests automatiques |
| `supabase/` | Migrations SQL, retours en arrière, vérifications et fonction de rappels |
| `vendor/` | Bibliothèque Supabase copiée (ne pas modifier à la main) |
| `fonts/`, `icons/`, `illustrations/` | Police, icônes de l'app et illustrations de l'accueil |
| `scripts/` | Génération des icônes |
| `docs/` | Guide de sécurité. `docs/superpowers/` contient les documents de conception d'origine, qui ne sont plus à jour |

## Sécurité

La mise en service et la maintenance des réglages de sécurité sont décrites dans [`docs/securite-mise-en-service.md`](docs/securite-mise-en-service.md).
