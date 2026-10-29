# Banc de test

Fait tourner une **copie** de l'app dans un Chrome sans fenêtre, face à un **faux Supabase** local. Les essais n'utilisent jamais le vrai serveur. Rien à installer : Node et Chrome suffisent (`CHROME_PATH` si Chrome n'est pas à son emplacement habituel).

```
node scripts/bench/bench.js
```

## Ce que prouve le contrôle d'isolation

À chaque lancement, avant tout scénario (sinon le banc s'arrête) :

1. une requête vers un sous-domaine `*.supabase.co` atterrit chez le faux serveur ;
2. une requête vers une autre adresse externe (une IP et un nom en https) est détournée vers un piège local qui la refuse : rien ne sort de la machine ;
3. aucun service worker n'est actif dans la copie.

L'isolation est celle du navigateur : résolveur (`--host-resolver-rules`), proxy piège (`--proxy-server`) et adresse réécrite dans la copie. La fin du run compte les entrées « ILLICITES » : requêtes de la page vers une autre adresse (le banc échoue s'il y en a). Les tentatives que Chrome fait de lui-même (mises à jour, comptes Google) sont refusées par le piège et comptées à part.

## Ajouter un scénario

Un fichier `scenarios/<nom>.js` qui exporte `name` et `async run({ page, fake, appOrigin, log })`. Il lève une erreur s'il échoue. `page` fournit `goto`, `evaluate`, `waitFor`, `tapSelector`, `swipe`, `typeText`, `setOffline` ; `fake` donne les modes de panne (`setMode("online" | "hang" | "down" | "refuse400")`), la base (`fake.db`) et `seedUser`.

## Tests

- `node --test` lance les tests sans Chrome (verdict, drapeaux, copie, faux serveur).
- Les tests avec Chrome (le contrôle doit échouer sans le mappage `*.supabase.co`, ou avec un service worker) ne tournent que sur demande : `BENCH_CHROME=1 node --test scripts/bench/isolation.chrome.test.js`. Ignorés si Chrome est absent. La sonde 2 n'est testée qu'en logique pure : retirer le piège ferait réellement sortir des requêtes.

## Ce que le banc ne couvre PAS

- **Le service worker et le cache hors-ligne** : absents de la copie. Le démarrage à froid sans réseau et la mise à jour du cache ne sont pas testés ici.
- **https** : la copie parle en `http` au faux serveur.
- **Le rendu iPhone** : zones d'écran, rebond, flou, clavier. Chrome émule un écran étroit et des événements tactiles, ce n'est pas Safari.

Un test réussi au banc n'est pas un test iPhone.
