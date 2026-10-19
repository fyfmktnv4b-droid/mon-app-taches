# Mise en service du durcissement sécurité (octobre 2026)

Guide pas à pas, à suivre dans l'ordre. Aucun secret ne doit être écrit dans
ce dépôt (il est public) ni collé dans une conversation : on passe toujours
par le presse-papiers du Mac.

Les valeurs ci-dessous qui apparaissent en clair (adresse du projet, clé
`sb_publishable_…`) sont **publiques** par conception : elles sont déjà dans
`supabaseClient.js`.

---

## Étape 0 — Sauvegarder ses tâches

Dans l'app : menu → **Sauvegarder mes tâches**. Garder le fichier JSON.

---

## Étape 1 — Tester la fonction AVANT (état actuel)

Dans le Terminal :

```
curl -sS -i -X POST https://ifcrmvuvmirkgdhkkgiv.supabase.co/functions/v1/send-reminders
```

```
curl -sS -i -X POST https://ifcrmvuvmirkgdhkkgiv.supabase.co/functions/v1/send-reminders \
  -H "Authorization: Bearer sb_publishable_c5F4xEjo1Gdg2tnTz-EUww_VzYzrLfW"
```

`-i` affiche le code (première ligne, ex. `HTTP/2 401`) et le texte de la
réponse (dernière ligne). Comment lire le texte :

| Texte de la réponse | Qui refuse | Signification |
|---|---|---|
| JSON du type `{"code":401,"message":"Missing authorization header"}` ou `"Invalid JWT"` | la passerelle Supabase | la fonction n'a même pas été lancée |
| `unauthorized` (seul) | l'**ancienne** version de la fonction | le secret est bien configuré |
| `send-reminders : unauthorized (…)` | la **nouvelle** version | protégée |
| `send-reminders : CRON_SECRET manquant…` (code 500) | la nouvelle version | le secret n'existe pas côté serveur : à créer |
| `ok` (code 200) | personne | **la fonction est ouverte** : elle vient de faire un vrai passage d'envoi des rappels dus |

---

## Étape 2 — Migration SQL 0003

1. Supabase → **SQL Editor** → nouvelle requête.
2. Copier la requête de vérification (Terminal, depuis le dossier du projet) :
   ```
   pbcopy < supabase/checks/0003_verify.sql
   ```
   Coller dans l'éditeur, **Run**.
3. Résultat attendu : **No rows returned**. Si des lignes apparaissent, ne pas
   continuer : chaque ligne indique la contrainte et la donnée en cause.
4. Copier la migration, coller dans une nouvelle requête, **Run** :
   ```
   pbcopy < supabase/migrations/0003_data_constraints.sql
   ```
   Elle est tout-ou-rien : en cas d'erreur, rien n'est appliqué.
5. Retour en arrière si besoin (supprime seulement les contraintes, aucune
   donnée) :
   ```
   pbcopy < supabase/rollback/0003_rollback.sql
   ```

---

## Étape 3 — Créer le secret VAPID_SUBJECT

Supabase → **Edge Functions** → **Secrets** (selon la version du tableau de
bord : Project Settings → Edge Functions → Secrets) → **Add new secret** :

- Nom : `VAPID_SUBJECT`
- Valeur : `mailto:` suivi de l'adresse, **collé**, sans espace, sans
  guillemets, sans chevrons. Exemple de forme : `mailto:mon-alias@icloud.com`

À faire **avant** l'étape 4 : sans ce secret, la nouvelle fonction refuse de
s'exécuter (message `VAPID_SUBJECT manquant`) et plus aucun rappel ne part.

---

## Étape 4 — Redéployer la fonction send-reminders

La fonction a été créée à l'origine dans l'**éditeur du tableau de bord**
(deux fichiers collés). On refait pareil : cela garde les réglages actuels de
la fonction (notamment la vérification JWT), contrairement à un déploiement
CLI qui peut les changer.

1. Supabase → **Edge Functions** → `send-reminders` → onglet **Code**.
2. Fichier `reminderLogic.js` **en premier** (la nouvelle `index.ts` en a
   besoin) :
   - Terminal : `pbcopy < supabase/functions/send-reminders/reminderLogic.js`
   - Dans l'éditeur, ouvrir `reminderLogic.js`, tout sélectionner (Cmd+A),
     coller (Cmd+V).
3. Fichier `index.ts` :
   - Terminal : `pbcopy < supabase/functions/send-reminders/index.ts`
   - Ouvrir `index.ts`, Cmd+A, Cmd+V.
4. Vérifier que les deux fichiers sont bien là, avec ces noms exacts, puis
   **Deploy** (ou « Deploy updates »).
5. Ne PAS copier `reminderLogic.test.js`.

Retour à l'ancienne version si quelque chose va mal (même méthode, fichier
par fichier) :

```
git show fdb8984:supabase/functions/send-reminders/reminderLogic.js | pbcopy
git show fdb8984:supabase/functions/send-reminders/index.ts | pbcopy
```

<details>
<summary>Variante : déploiement par la CLI Supabase (facultatif)</summary>

1. Installer : `brew install supabase/tap/supabase`
2. Se connecter (ouvre le navigateur) : `supabase login`
3. Avant de déployer, regarder dans le tableau de bord (fonction
   `send-reminders` → Details) si **Enforce JWT verification** est activé.
4. Depuis le dossier du projet :
   - si c'est **désactivé** :
     `supabase functions deploy send-reminders --project-ref ifcrmvuvmirkgdhkkgiv --no-verify-jwt`
   - si c'est **activé** : la même commande sans `--no-verify-jwt`.

Se tromper à l'étape 3 peut faire refuser par la passerelle les appels de
pg_cron (la clé `sb_publishable_…` n'est pas un JWT) : les rappels
s'arrêteraient sans message.
</details>

---

## Étape 5 — Tester APRÈS

1. Relancer les deux commandes `curl` de l'étape 1. Attendu : code `401`,
   avec soit le texte `send-reminders : unauthorized (…)`, soit un refus JSON
   de la passerelle.
2. Vérifier que pg_cron passe toujours : dans l'app, mettre un rappel sur une
   tâche à +2 minutes et attendre la notification. Sinon : Supabase → Edge
   Functions → `send-reminders` → **Logs** ; un message `CRON_SECRET manquant`
   ou `VAPID_SUBJECT manquant/invalide` dit quel secret corriger.

---

## Étape 6 — Mise à jour de l'app (après accord pour le push GitHub)

Sur iPhone, dans l'app installée sur l'écran d'accueil (pas seulement Safari) :

- Fermer complètement l'app et la rouvrir, deux fois (nouvelle version v25).
- Toujours connecté ; les tâches s'affichent.
- Ajouter une tâche ; la cocher puis « Validé ? » → elle passe dans
  « Terminé », avec la coche blanche visible dans la case.
- Coller une ligne très longue (plus de 1000 caractères) → message d'erreur,
  le texte reste dans le champ.
- Routine : cocher, valider.
- Mode avion : cocher/valider une tâche, puis réactiver le réseau → la
  modification arrive sur le Mac.
- Rappel à +2 minutes → notification reçue ; la toucher ouvre l'app.
- Police Plus Jakarta Sans normale ; illustration du jour visible ;
  « Sauvegarder mes tâches » fonctionne.

Si un écran casse : on retire la CSP (`git revert` du commit « Add a
Content-Security-Policy », puis CACHE_VERSION +1) ; le service worker se met
à jour indépendamment de la page.

---

## Étape 7 — Remplacer le CRON_SECRET

Pourquoi : l'actuel a été manipulé en clair lors de la mise en place
(notamment dans un historique de conversation local). Il est utilisé à deux
endroits, qu'il faut changer à moins d'une minute d'écart :

- **(a)** le secret `CRON_SECRET` de la fonction (Edge Functions → Secrets) ;
- **(b)** la tâche pg_cron `send-reminders-every-minute`, qui l'envoie dans
  l'en-tête `x-cron-secret` (il y est écrit en clair).

Procédure :

1. Préparer la requête SQL ci-dessous dans le **SQL Editor** (sans la lancer).
   `cron.schedule` avec le même nom **remplace** la tâche existante, il n'en
   crée pas une deuxième.
   ```sql
   select cron.schedule(
     'send-reminders-every-minute',
     '* * * * *',
     $$
     select net.http_post(
       url := 'https://ifcrmvuvmirkgdhkkgiv.functions.supabase.co/send-reminders',
       headers := jsonb_build_object(
         'Authorization', 'Bearer sb_publishable_c5F4xEjo1Gdg2tnTz-EUww_VzYzrLfW',
         'Content-Type', 'application/json',
         'x-cron-secret', '<COLLER ICI>'
       )
     );
     $$
   );
   ```
2. Terminal : générer le nouveau secret directement dans le presse-papiers
   (il ne s'affiche pas) :
   ```
   openssl rand -hex 24 | pbcopy
   ```
3. Edge Functions → Secrets → `CRON_SECRET` → modifier → Cmd+V → enregistrer.
4. Dans la requête SQL, sélectionner `<COLLER ICI>` (sans les apostrophes),
   Cmd+V, **Run**. Ne pas enregistrer cette requête comme favori.
5. Vérifier que la tâche n'existe qu'une fois :
   ```sql
   select jobid, jobname, schedule, active from cron.job;
   ```
6. Tester, le secret étant toujours dans le presse-papiers (attendu : `200`
   et `ok` ; cela lance un vrai passage, sans risque de doublon) :
   ```
   curl -sS -i -X POST https://ifcrmvuvmirkgdhkkgiv.supabase.co/functions/v1/send-reminders \
     -H "Authorization: Bearer sb_publishable_c5F4xEjo1Gdg2tnTz-EUww_VzYzrLfW" \
     -H "x-cron-secret: $(pbpaste)"
   ```
7. Vider le presse-papiers en copiant autre chose.

Une ou deux minutes de rappels « manqués » pendant le changement sont
rattrapées : la fenêtre d'envoi est de 5 minutes.

<details>
<summary>Variante plus propre (facultative) : secret dans le coffre Vault</summary>

Le secret n'est alors plus écrit en clair dans la tâche pg_cron, et les
prochains remplacements ne touchent plus la tâche.

1. Créer le secret dans le coffre (Cmd+V à la place de `<COLLER ICI>`) :
   ```sql
   select vault.create_secret('<COLLER ICI>', 'cron_secret');
   ```
2. Remplacer, dans la requête de l'étape 1 ci-dessus, la ligne
   `'x-cron-secret', '<COLLER ICI>'` par :
   ```sql
   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
   ```
3. Remplacements futurs : modifier le secret de la fonction (Secrets) et le
   coffre :
   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<COLLER ICI>');
   ```
</details>
