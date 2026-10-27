# vendor/

Fichiers tiers, vendorisés tels quels. **Ne pas éditer, ni linter, ni reformater.**

## Pourquoi

`supabaseClient.js` importait `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`.
Le service worker ne met en cache que les GET de même origine (volontairement : les
appels d'API Supabase ne doivent jamais être mis en cache). Un import cross-origin ne
pouvait donc jamais être caché, et un démarrage hors-ligne à froid échouait sur cet
import — page blanche.

## Contenu

Le bundle `+esm` de jsDelivr n'est qu'un shim : il ré-importe 5 sous-paquets depuis des
chemins CDN absolus (`/npm/...`). Copier ce seul fichier ne suffit donc pas. Le graphe
complet est mirroré ici à plat, avec les spécifieurs réécrits en chemins relatifs locaux :

| Fichier | Source |
| --- | --- |
| `supabase-js.esm.js` | `@supabase/supabase-js@2.115.0` (point d'entrée) |
| `supabase-auth-js-2.115.0.js` | `@supabase/auth-js@2.115.0` |
| `supabase-functions-js-2.115.0.js` | `@supabase/functions-js@2.115.0` |
| `supabase-postgrest-js-2.115.0.js` | `@supabase/postgrest-js@2.115.0` |
| `supabase-realtime-js-2.115.0.js` | `@supabase/realtime-js@2.115.0` |
| `supabase-storage-js-2.115.0.js` | `@supabase/storage-js@2.115.0` |
| `supabase-phoenix-0.4.5.js` | `@supabase/phoenix@0.4.5` |
| `iceberg-js-0.8.1.js` | `iceberg-js@0.8.1` |
| `tslib-2.8.1.js` | `tslib@2.8.1` |

Seule modification apportée au code téléchargé : chaque `"/npm/<spec>/+esm"` est remplacé
par le `"./<fichier>.js"` local correspondant.

## Mise à jour

1. Re-télécharger `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm` et, en
   suivant récursivement les références `"/npm/.../+esm"`, chaque dépendance.
2. Réécrire ces références en chemins relatifs locaux (même convention de nommage).
3. Mettre à jour la liste `ASSETS` de `service-worker.js` — **tous** les fichiers doivent
   y figurer, un manquant casse la chaîne d'imports au démarrage hors-ligne.
4. Incrémenter `CACHE_VERSION` dans `service-worker.js`.
5. Refaire les scénarios hors-ligne (section suivante) : le mode hors-ligne dépend de
   comportements internes de cette version précise.

## Comportements dont dépend le mode hors-ligne (vérifiés sur 2.115.0)

Mesurés le 2026-10-27 avec un faux réseau (aucune requête réelle). Si une mise à jour
change l'un d'eux, `authLogic.js`, `splashLogic.js`, `supabaseClient.js` et l'écran de
chargement peuvent se tromper de décision.

- **Jeton expiré + réseau absent** : au démarrage, le SDK tente de renouveler le jeton et
  réessaie avec une attente qui double (200 ms … 12,8 s) tant que le total reste sous
  30 s. `INITIAL_SESSION` n'arrive qu'après **~25 s**, **sans session**, mais la session
  reste enregistrée (localStorage `sb-<projet>-auth-token`). D'où le délai de 5 s de
  l'écran de chargement et le mode hors-ligne provisoire.
- **Panne ou refus** : une coupure réseau, une réponse 5xx (500–530) ou une réponse
  illisible (portail wifi) donnent `AuthRetryableFetchError` (status 0 ou 5xx) : session
  gardée. Une réponse 4xx (ex. 400 `refresh_token_not_found`) donne `AuthApiError` : le SDK
  efface la session et envoie `SIGNED_OUT` **avant** `INITIAL_SESSION` (vide).
- **`isAuthRetryableFetchError`** est exporté par `supabase-auth-js-2.115.0.js` (pas par
  `supabase-js.esm.js`) ; `supabaseClient.js` l'importe directement.
- **Délai de refroidissement de 60 s** : après un échec, le SDK renvoie le même échec
  pendant 60 s sans réessayer (`lastRefreshFailure`). `getSession()` juste après un
  `INITIAL_SESSION` vide répond donc tout de suite. Au retour du réseau, la reprise
  (`TOKEN_REFRESHED`, minuteur interne de 30 s) peut prendre jusqu'à ~90 s.
- **`signOut()` échoue** (sans rien effacer) quand le renouvellement échoue ; avec un
  jeton encore valide mais sans réseau, il efface la session locale et envoie `SIGNED_OUT`.
- **Verrou interne** : une requête de renouvellement bloquée (wifi sans internet) retient
  le verrou du SDK ; tout appel `getSession()` attend derrière. L'app ne l'attend jamais
  pour décider d'un écran (délais de 3 s et 5 s).

À chaque mise à jour : relancer la sonde des scénarios (jeton expiré + réseau coupé,
refus 400, 503, requête bloquée, retour du réseau) et vérifier chacun de ces points.
