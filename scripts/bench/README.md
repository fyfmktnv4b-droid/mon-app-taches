# Banc de test

Fait tourner une **copie** de l'app dans un Chrome sans fenêtre, face à un **faux Supabase** local. Les essais n'utilisent jamais le vrai serveur. Rien à installer : Node et Chrome suffisent (`CHROME_PATH` si Chrome n'est pas à son emplacement habituel).

```
node scripts/bench/bench.js
```

Pour un seul scénario : `BENCH_ONLY=<nom>` (partie du nom de fichier), par exemple `BENCH_ONLY=enUnCoup node scripts/bench/bench.js`.

## Ce que prouve le contrôle d'isolation

À chaque lancement, avant tout scénario (sinon le banc s'arrête) :

1. une requête vers un sous-domaine `*.supabase.co` atterrit chez le faux serveur ;
2. une requête vers une autre adresse externe (une IP et un nom en https) est détournée vers un piège local qui la refuse : rien ne sort de la machine ;
3. aucun service worker n'est actif dans la copie.

L'isolation est celle du navigateur : résolveur (`--host-resolver-rules`), proxy piège (`--proxy-server`) et adresse réécrite dans la copie.

## Le journal : requête de la page ou tentative de Chrome

Tout ce qui sort vers une autre adresse arrive au piège, qui le **refuse toujours** et le journalise. À la fin du run, chaque refus est classé :

- **Page** : le nom d'hôte figure parmi ceux que la page a réellement demandés (relevés par CDP, `Network.requestWillBeSent`). C'est une entrée « ILLICITE » : **le banc échoue**. Seules échappent à ce compte les deux sondes voulues du contrôle d'isolation.
- **Chrome** : le piège a reçu l'hôte sans que la page l'ait demandé (mises à jour, comptes Google, contrôle des mots de passe…). Refusée aussi, elle est comptée et listée à part, sans faire échouer le banc.

Il n'existe **aucune liste d'hôtes autorisés** : le tri ne repose que sur ce que la page a demandé. Toute requête de la page vers un mauvais `Host` chez l'app ou le faux serveur est ILLICITE aussi. Le tri est testé : `journal.test.js` (sans Chrome) et, avec Chrome, le dernier test de `isolation.chrome.test.js`.

## Captures et mesures de mise en page

`scenarios/routineBoutons.js` mesure les boutons « Validé ? » de la routine du matin (alignement, écarts, hauteur tactile) à 320, 375 et 390 px, pour 1 à 4 habitudes (des lignes sont injectées dans la page : les habitudes ne sont pas configurables). Les règles sont dans `routineLayout.js`, testées sans Chrome. L'horloge de la PAGE est reculée jusqu'au jour voulu (mercredi, jeudi, dimanche) : jamais celle de la machine.

Avec `BENCH_CAPTURE_DIR=<dossier>` (et `BENCH_CAPTURE_LABEL=avant` ou `apres`), il écrit aussi des captures PNG et `<label>-mesures.json` dans ce dossier. Les captures sont prises avant les vérifications : une série « avant » est complète même si la mise en page est cassée.

`scenarios/reglagesBilan.js` vérifie l'interrupteur « Bilan du dimanche » (état par défaut, écriture, échec, serveur coupé, zone tactile à 320, 375 et 390 px), l'« Heure du bilan » et l'ouverture du Bilan au toucher d'une notification. Pour l'heure : 20:00 par défaut, un seul bouton « Enregistrer les heures » et une seule écriture, tout ou rien (19:30 et 23:01 refusés sans aucune requête, message sous le champ), bornes 20:00 et 23:00, champ vidé = NULL puis 20:00 affiché, champ grisé et conservé quand la case est décochée, serveur coupé à l'enregistrement (saisie gardée, nouvel essai). Le faux Supabase refuse comme la contrainte de la migration 0007 (400, code 23514). Il retire `PushManager` de la page, car sans service worker `navigator.serviceWorker.ready` ne répond jamais et l'écran Réglages resterait bloqué. Depuis la v43, il vérifie aussi qu'un enregistrement réussi (heures ou case) ne redessine ni ne relit l'écran, que la confirmation (« Ces paramètres sont enregistrés. », « Ce réglage est enregistré. ») s'affiche après une réussite seulement, jamais après un échec ou une heure refusée, et qu'elle disparaît à la modification suivante. Avec `BENCH_CAPTURE_DIR`, il écrit `reglages-<largeur>.png`, `reglages-coupe.png`, `reglages-erreur-<largeur>.png`, `reglages-heure-grisee.png`, `reglages-confirmation-heures-<largeur>.png` et `reglages-confirmation-interrupteur-<largeur>.png`.

`scenarios/fermer.js` vérifie le bouton « Fermer » de chaque écran du menu (Bilan, Historique, Réglages, aussi hors-ligne, Ma routine ouverte depuis le menu) : un seul par écran, plus de lien « ‹ Aujourd'hui », le même bouton partout (bas d'écran, pleine largeur, style crème, au moins 44 px à 320, 375 et 390 px, Ma routine aussi à 320 × 568). « Fermer » mène toujours à « Aujourd'hui » : depuis chaque écran, Réglages ou Historique → menu → Bilan, Bilan ouvert par une notification pendant les Réglages. Ma routine ouverte depuis les Réglages : « Passer pour aujourd'hui » et « Continuer » mènent aussi à « Aujourd'hui ». La routine du démarrage n'a pas de « Fermer ». Avec `BENCH_CAPTURE_DIR`, il écrit `fermer-<écran>-<largeur>.png`.

`scenarios/enUnCoup.js` (v44) vérifie, **image par image**, que chaque écran apparaît en un coup : Aujourd'hui ↔ Historique, Réglages, Bilan et Ma routine (menu, puis « Fermer »), réseau rapide puis lent (`fake.setDelay(1000)` : 1 s par requête). Une boucle `requestAnimationFrame` note ce qui est affiché à chaque image ; `frames.js` (testé sans Chrome par `frames.test.js`) refuse tout ce qui n'est ni l'écran de départ complet, ni l'écran d'arrivée complet, ni l'état « Chargement… » : titre seul, page vide, Aujourd'hui sans sa routine, Bilan avec « Chargement… », et tout saut de page une fois l'écran complet. Réseau lent : « Chargement… » une seule fois, vers 300 ms ; réseau rapide : jamais. Il vérifie aussi que les rendus qui ne changent pas d'écran (« Validé ? », synchronisation, retour au premier plan sur Aujourd'hui et sur le Bilan) n'affichent jamais « Chargement… », et qu'après la déconnexion d'un compte A puis la connexion d'un compte B, aucune tâche de A n'est visible, même un instant (relevé à chaque modification du DOM), ni présente dans la page. Le journal donne le temps de chaque changement d'écran. Avec `BENCH_CAPTURE_DIR`, il écrit `chargement-390.png`, `bilan-complet-390.png` et `aujourdhui-routine-390.png` (390 × 844).

`scenarios/menu.js` (v45) vérifie, image par image, le **menu** : un écran touché depuis le menu (Historique, Réglages, Bilan, Ma routine, et Réglages vers Bilan) apparaît menu compris, en un coup. Le menu reste ouvert jusqu'à ce que l'écran d'arrivée soit prêt, puis menu fermé et écran d'arrivée sont dans la même image ; jamais l'écran de départ sans son menu (`checkMenuTransition` dans `frames.js`, testée sans Chrome). Réseau à 0, 150 et 1000 ms (« Chargement… » vers 300 ms, menu compris). Il vérifie aussi l'entrée de l'écran où l'on est déjà, les gestes ignorés pendant l'attente (voile, bouton du menu, Échap, seconde entrée), ce qui est sous le doigt (le menu ou son voile, pas l'écran de dessous), un autre écran qui prend la place (notification, « Fermer »), la lecture en échec, le hors-ligne et « Sauvegarder mes tâches ». Il ne mesure pas l'état « pressé » (`:hover` / `:active` d'iOS). **Volontairement rouge sur la v44** : il décrit le comportement voulu, avant la correction.

## Ajouter un scénario

Un fichier `scenarios/<nom>.js` qui exporte `name` et `async run({ page, fake, appOrigin, log })`. Il lève une erreur s'il échoue. `page` fournit `goto`, `evaluate`, `waitFor`, `tapSelector`, `swipe`, `typeText`, `setOffline` ; `fake` donne les modes de panne (`setMode("online" | "hang" | "down" | "refuse400")`), un réseau lent (`setDelay(ms)`), la base (`fake.db`) et `seedUser`.

## Tests

- `node --test` lance les tests sans Chrome (verdict, drapeaux, copie, faux serveur).
- Les tests avec Chrome (le contrôle doit échouer sans le mappage `*.supabase.co`, ou avec un service worker) ne tournent que sur demande : `BENCH_CHROME=1 node --test scripts/bench/isolation.chrome.test.js`. Ignorés si Chrome est absent. La sonde 2 n'est testée qu'en logique pure : retirer le piège ferait réellement sortir des requêtes.

## Ce que le banc ne couvre PAS

- **Le service worker et le cache hors-ligne** : absents de la copie. Le démarrage à froid sans réseau et la mise à jour du cache ne sont pas testés ici.
- **Le toucher d'une notification** : le banc dépose lui-même la marque dans la boîte aux lettres et simule le message du service worker. Il vérifie ce que fait l'app, pas le service worker (`serviceWorkerOpen.test.js`, hors navigateur) ni iOS.
- **https** : la copie parle en `http` au faux serveur.
- **Le rendu iPhone** : zones d'écran, rebond, flou, clavier. Chrome émule un écran étroit et des événements tactiles, ce n'est pas Safari.

Un test réussi au banc n'est pas un test iPhone.
