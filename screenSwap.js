// Changement d'écran « en un coup » : l'écran affiché reste en place pendant
// les lectures du suivant, puis titre et contenu changent dans la même image.
// Si les lectures dépassent LOADING_DELAY_MS, un état « Chargement… » stable
// prend la place (un écran qui ne réagit pas semblerait figé). Le rendu
// lui-même (et ses gardes « l'écran demandé est-il toujours celui-ci ? »)
// reste dans app.js ; ici, seulement le minuteur et ses règles.

export const LOADING_DELAY_MS = 300;
// Envoi de la file avant d'entrer dans l'app : on cesse d'ATTENDRE au bout de
// ce délai, l'envoi continue en arrière-plan (voir settlesWithin).
export const FLUSH_WAIT_MS = 2000;

// Vrai si la promesse s'est terminée (réussie ou non) avant le délai ; sinon
// elle continue en arrière-plan, on cesse simplement de l'attendre. Rien n'est
// annulé ni relancé : c'est au code appelé d'éviter un second envoi en
// parallèle (flushQueue partage l'envoi en cours, voir sync.js).
export function settlesWithin(promise, ms, timers = globalThis) {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise((resolve) => timers.setTimeout(() => resolve(false), ms)),
  ]);
}

// Lance `work` (lectures puis dessin du nouvel écran). Pendant ce temps :
//   - au bout de `delayMs`, si l'écran est toujours demandé (`wanted`),
//     `showLoading()`, une seule fois ; tout de suite si `immediately` (rien
//     d'autre à garder à l'écran) ;
//   - à la fin, si « Chargement… » est encore là alors que l'écran est
//     toujours demandé (lecture en erreur, rien dessiné), `giveUp()` : jamais
//     de « Chargement… » qui reste.
// Un écran plus demandé (on est allé ailleurs) ne touche plus à rien : c'est
// le nouvel écran qui gère l'affichage.
export async function showAfterLoading(work, {
  wanted, showLoading, stillLoading, giveUp, immediately = false, delayMs = LOADING_DELAY_MS, timers = globalThis,
}) {
  let shown = false;
  const show = () => {
    if (shown || !wanted()) return;
    shown = true;
    showLoading();
  };
  const timer = timers.setTimeout(show, delayMs);
  if (immediately) show();
  try {
    return await work();
  } finally {
    timers.clearTimeout(timer);
    if (shown && wanted() && stillLoading()) giveUp();
  }
}
