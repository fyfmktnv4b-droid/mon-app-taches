# Mon App Tâches — Design

Date : 2026-09-04

## Objectif

PWA personnelle de planification matinale : capture rapide de tâches (texte
libre, sans friction), tri via une matrice Eisenhower (deux tags booléens :
urgent, important), mise en avant automatique des tâches urgent+important
("priorités du jour"). Synchronisée entre un Mac et un iPhone via Supabase,
installable en PWA sur les deux, avec rappels par notification push réelle
(fonctionne même app fermée).

Conçue pour un usage personnel, avec la porte ouverte à un partage informel
avec des proches (chacun son compte, ses propres tâches) sans travail
supplémentaire.

## Stack

- **Frontend** : HTML/CSS/JS vanilla, zéro build, zéro dépendance de build.
  Le client Supabase est chargé via CDN (`<script type="module">` depuis
  jsdelivr).
- **Backend** : Supabase (plan gratuit) — Postgres, Auth, Edge Functions,
  `pg_cron` + `pg_net`.
- **Hébergement statique** : GitHub Pages, sur un repo **public** (requis
  pour Pages gratuit sur compte personnel). Le contenu des tâches vit dans
  Supabase, pas dans le repo — un repo public ne fuite aucune donnée
  personnelle.
- **Stockage local** : IndexedDB, utilisé comme cache de lecture rapide et
  comme file d'attente pour les modifications faites hors-ligne. Supabase
  Postgres est la source de vérité.

## Structure de fichiers

```
mon-app-taches/
  index.html
  style.css
  app.js               UI : rendu, événements
  supabaseClient.js     init client Supabase + appels auth
  storage.js            cache IndexedDB + file d'attente hors-ligne
  sync.js               push/pull vers Supabase, résolution de conflits
  push.js               abonnement Web Push côté client
  manifest.json
  service-worker.js     cache-first des assets statiques + écoute des push
  supabase/
    migrations/
      0001_init.sql      schéma, RLS, triggers
    functions/
      send-reminders/
        index.ts         Edge Function déclenchée par pg_cron
```

## Modèle de données

Voir `supabase/migrations/0001_init.sql` pour le schéma complet (tables
`tasks`, `user_settings`, `push_subscriptions`, policies RLS, triggers).

Points de conception :

- **Chaque table a une policy RLS `user_id = auth.uid()`** — l'isolation
  entre utilisateurs est garantie par la base de données, pas par le code
  applicatif. C'est ce qui permet le partage avec des proches sans travail
  supplémentaire : chacun crée son compte, ne voit et ne modifie que ses
  propres lignes.
- **`updated_at` est géré par un trigger Postgres**, jamais par le client —
  nécessaire pour que la résolution de conflits (last-write-wins) soit
  fiable même face à un client buggé ou malhonnête.
- **Un trigger sur `auth.users`** crée automatiquement une ligne
  `user_settings` à l'inscription, pour garantir qu'elle existe toujours
  (notamment le fuseau horaire, nécessaire au calcul des rappels).
- **Tâches non triées** : `urgent`/`important` valent `null` à la création.
  Elles apparaissent dans une zone "à trier" tant qu'elles n'ont pas les
  deux tags.
- **Pas de table d'archive séparée.** L'archivage est une simple règle de
  filtrage à la lecture : la vue active (capture, à trier, priorités,
  matrice) exclut les tâches `done = true` dont `completed_at` est
  antérieur à aujourd'hui. Un écran "Historique" séparé les affiche en
  lecture seule, triées par `completed_at` décroissant. Aucune tâche n'est
  jamais déplacée ou dupliquée — uniquement filtrée selon la requête.
- **Scope volontairement réduit** : pas d'édition de texte en place pour
  une tâche existante (v1). Modifier le texte = supprimer et recréer. Les
  tags urgent/important restent modifiables à tout moment (pas seulement à
  la création).

## Authentification

Email + mot de passe via Supabase Auth. Pas de flow "mot de passe oublié"
construit dans l'app pour l'instant (Supabase propose un reset par email
standard, réutilisable tel quel si besoin plus tard).

## Synchronisation & mode hors-ligne

- Chaque modification faite hors-ligne est mise en file d'attente dans
  IndexedDB avec un horodatage local.
- Au retour du réseau (ou quand l'app regagne le focus), `sync.js` rejoue
  la file vers Supabase.
- **Résolution de conflits : last-write-wins**, basé sur `updated_at`
  (géré serveur, cf. trigger ci-dessus). Si la même tâche a été modifiée
  sur les deux appareils pendant une période hors-ligne, la modification
  la plus récente l'emporte silencieusement. Pas d'UI de fusion — non
  justifiée pour un usage à 1-2 appareils par la même personne.
- **Pas de synchronisation temps réel** (pas de WebSocket Supabase
  Realtime). L'app resynchronise à l'ouverture et au regain de focus.
  Suffisant vu l'usage ("je lance l'app chaque matin") ; évite de gérer
  une connexion persistante.
- **Échec réseau lors d'une écriture** (même si l'app se croit en ligne) :
  traité comme une écriture hors-ligne, retry automatique au prochain
  sync. Pas de perte de données, pas de message d'erreur bloquant.
- **Session expirée** : redirection vers l'écran de connexion ; la file
  d'attente locale reste intacte et se synchronise après reconnexion.

## Notifications push (réelles, app fermée incluse)

### Pourquoi de la vraie Web Push et pas juste `setTimeout`

Un rappel programmé côté client (`setTimeout`) ne se déclenche que si
l'app tourne au premier plan — en particulier sur iOS, où Safari suspend
agressivement le JS en arrière-plan. La vraie Web Push est déclenchée côté
serveur et livrée par les services de push d'Apple/Google indépendamment
de l'état de l'app.

### Mise en place

1. **Clés VAPID**, générées une fois en local :
   ```bash
   npx web-push generate-vapid-keys
   ```
   - Clé publique → codée en dur dans `push.js` (client), utilisée pour
     `PushManager.subscribe()`.
   - Clé privée (+ clé publique) → jamais exposées au client, stockées
     comme secrets de l'Edge Function :
     ```bash
     supabase secrets set VAPID_PRIVATE_KEY=... VAPID_PUBLIC_KEY=...
     ```
2. **Abonnement côté client** : sur clic du bouton "Autoriser les
   notifications" (écran Réglages), `push.js` demande la permission,
   s'abonne via `PushManager.subscribe()`, et enregistre l'abonnement
   (endpoint, clés) dans `push_subscriptions`.
3. **`service-worker.js`** écoute l'événement `push` et affiche la
   notification via `self.registration.showNotification()`.
4. **Déclenchement côté serveur** : `pg_cron` appelle l'Edge Function
   `send-reminders` toutes les minutes via `pg_net` :
   ```sql
   select cron.schedule(
     'send-reminders-every-minute',
     '* * * * *',
     $$
     select net.http_post(
       url := 'https://<project-ref>.functions.supabase.co/send-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <anon-key>', 'Content-Type', 'application/json')
     );
     $$
   );
   ```
5. **L'Edge Function** (`supabase/functions/send-reminders/index.ts`) :
   - Récupère les réglages des utilisateurs avec `notifications_enabled =
     true` (une requête), et les tâches non terminées avec un
     `reminder_time` défini (une deuxième requête) — **deux requêtes à
     plat, pas d'embedding PostgREST** entre `tasks` et `user_settings`
     (aucune clé étrangère directe entre les deux, seulement une
     référence commune vers `auth.users` ; l'embedding imbriqué
     échouerait). La correspondance `user_id → timezone` se fait via une
     `Map` en mémoire.
   - `isDueNow(target, timezone, now, windowMinutes = 5)` : compare
     l'heure cible à l'heure actuelle dans le fuseau de l'utilisateur,
     avec une tolérance de 5 minutes après l'heure cible (jamais avant) —
     absorbe un tick de cron manqué sans déclenchement anticipé.
   - **Rappel matinal** (récurrent chaque jour) : protégé contre les
     doublons par `last_morning_reminder_sent_date` (n'envoie qu'une fois
     par jour civil, même si plusieurs ticks de cron tombent dans la
     fenêtre de tolérance).
   - **Rappel par tâche** (ponctuel) : après envoi, `reminder_time` est
     remis à `null` — empêche naturellement les doublons et la
     récurrence (si un rappel quotidien est voulu, l'utilisateur le
     redéfinit).
   - Envoie via `npm:web-push` (import Deno). Un abonnement qui répond
     410/404 (expiré, app désinstallée) est supprimé de
     `push_subscriptions`.

### Limite connue

iOS exige que l'app soit installée via "Sur l'écran d'accueil" pour que
Web Push fonctionne (pas de push pour un onglet Safari classique,
iOS 16.4+ requis). Web Push ne peut pas réveiller un iPhone/Mac
complètement éteint — seulement un appareil éveillé, app installée ou non.

## Maintien en activité du projet Supabase (plan gratuit)

Un projet Supabase gratuit est mis en pause après ~7 jours sans requête
API réelle touchant le projet (navigation dashboard exclue). `pg_cron` ne
peut pas être son propre garde-fou : si le projet est mis en pause,
Postgres (et donc `pg_cron`) s'arrête aussi.

**Solution** : un ping quotidien externe via **cron-job.org** (gratuit,
indépendant de l'activité du repo) vers un endpoint léger de l'API REST
Supabase. *(Alternative écartée : GitHub Actions programmé — un tel
workflow est automatiquement désactivé après 60 jours sans activité sur
le repo, ce qui aurait cassé le garde-fou silencieusement pour une app
perso peu modifiée après sa mise en place.)*

Filet de sécurité supplémentaire : Supabase envoie un email
d'avertissement avant la mise en pause effective.

## PWA & installation

- `manifest.json` : nom, icônes (192/512), `display: standalone`,
  couleurs de thème.
- `service-worker.js` : stratégie **cache-first** sur tous les assets
  statiques (HTML/CSS/JS/manifest/icônes), précachés à l'installation —
  autonomie hors-ligne complète après le premier chargement.
- **Mac** : ouvrir l'URL GitHub Pages, installer (icône Dock).
- **iPhone** : ouvrir la même URL dans Safari, "Partager" → "Sur l'écran
  d'accueil".
- Les deux appareils sont des clients indépendants de la même URL
  publique + du même backend Supabase — aucun des deux ne dépend de
  l'autre pour fonctionner.
- **Mises à jour** : push d'un commit → redéploiement GitHub Pages → le
  service worker détecte la nouvelle version et la recache au prochain
  chargement (cycle de mise à jour standard des service workers).
- Le serveur local (`python3 -m http.server`) ne sert plus qu'au
  développement avant de pousser sur GitHub Pages — plus nécessaire au
  quotidien.

## Interface

- **Écran principal** : capture (zone multi-lignes, une tâche par ligne)
  → "À trier" (tâches sans tags, boutons urgent ?/important ?) →
  "Priorités du jour" (quadrant urgent+important, mis en avant
  visuellement — affiché tel quel, sans troncature ni complément
  forcé à 3) → matrice complète des 4 quadrants.
- **Réglages** : heure du rappel matinal, bouton d'activation des
  notifications (déclenche `PushManager.subscribe()`), heure de rappel
  par tâche (depuis la carte de la tâche), bouton **"Exporter mes tâches
  (JSON)"** (filet de sécurité — sérialise le cache local en `.json`
  téléchargeable, aucune logique serveur), déconnexion.
- **Connexion/Inscription** : email + mot de passe.
- **Historique** : tâches terminées avant aujourd'hui, lecture seule.

## Tests

- Tests unitaires pour les fonctions pures : tri par quadrant,
  `isDueNow`, résolution de conflits last-write-wins.
- Reste vérifié manuellement en conditions réelles (Mac + iPhone, coupure
  réseau volontaire pour valider la file d'attente hors-ligne) — suffisant
  pour une app personnelle, pas de suite end-to-end.

## Hors scope (v1)

- Édition de texte en place d'une tâche existante.
- Fusion de conflits assistée par UI.
- Réveil programmé de la machine (`pmset repeat wake`) — steps
  documentés si besoin futur, non implémenté.
- Gestion formelle multi-utilisateur (export/suppression de compte en
  libre-service) au-delà de l'isolation RLS de base.
