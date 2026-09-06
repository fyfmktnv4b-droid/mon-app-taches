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
