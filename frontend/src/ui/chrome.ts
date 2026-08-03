// =============================================================================
//  ui/chrome.ts — l'habillage qui ne change JAMAIS d'écran.
//
//  Deux choses vivent hors de `#screen` et sont montées une seule fois au boot :
//  la mise à l'échelle plein écran (#91) et le badge d'identité (#92). Les poser
//  ici plutôt que dans chaque écran leur donne gratuitement ce que les issues
//  demandent — « présent en permanence, sans clignotement ni redessin différent
//  d'un écran à l'autre » — puisqu'aucune navigation ne les touche.
// =============================================================================

import { avatarUrl, getIdentity } from "../discord";
import { escapeText } from "./typing-zone";

/**
 * Sous ce facteur, le texte à taper n'est plus lisible : on ne réduit jamais au-delà.
 */
const MIN_SCALE = 0.5;

/**
 * Facteur de mise à l'échelle du contenu. Trois cas, et le troisième est celui qui
 * compte :
 *
 *  - le contenu tient déjà      → 1, on ne touche à rien ;
 *  - il déborde un peu          → juste ce qu'il faut pour le faire tenir ;
 *  - il déborde ÉNORMÉMENT      → 1 quand même.
 *
 * Ce dernier cas est le seul choix défendable pour les écrans qui sont des listes
 * longues par nature (Paramètres, Apprendre) : les réduire au plancher ne les ferait
 * pas tenir pour autant, ils défileraient de toute façon — mais en plus illisibles.
 * Réduire n'a de sens que quand ça atteint le but. Sinon on laisse la taille pleine
 * et c'est le défilement sans barre (voir `#app` dans style.css) qui sert.
 *
 * Fonction pure.
 */
export function fitScale(contentHeight: number, availableHeight: number): number {
  if (contentHeight <= 0) return 1;
  const k = availableHeight / contentHeight;
  if (k >= 1) return 1;
  // 1 % de marge : une fois réduit, le texte se remet en page à la nouvelle taille de
  // police et les arrondis de métrique lui rendent un ou deux pixels — assez pour
  // reperdre l'ajustement. Viser 99 % de la place absorbe ce recalcul d'un coup, là où
  // une deuxième passe de mesure risquerait surtout d'osciller entre deux valeurs.
  const safe = k * 0.99;
  return safe < MIN_SCALE ? 1 : safe;
}

/**
 * Jamais de scrollbar (#91) : `#app` est clippé à la fenêtre, et tout contenu qui
 * déborderait est réduit jusqu'à tenir — un seul mécanisme pour tous les écrans,
 * plutôt qu'une règle de hauteur par écran.
 *
 * `zoom` plutôt que `transform: scale()` : il REFLOWE (le texte se recoupe à la
 * nouvelle largeur, les hauteurs en pourcentage se recalculent) là où `scale`
 * étirerait une image figée de la page, laissant des zones cliquables décalées.
 *
 * ponytail: on remet `zoom: 1` avant chaque mesure — la fonction est donc idempotente
 * et n'a aucun état à conserver. Si un jour la remise à 1 coûte trop cher (relayout
 * forcé à chaque frappe), le remplacement est de mesurer `#screen` à zoom constant et
 * de composer les facteurs, pas d'ajouter un cache.
 */
export function fitToViewport(app: HTMLElement, screen: HTMLElement): void {
  let queued = false;
  // La mesure ET l'application du zoom se font dans un rAF, JAMAIS dans le callback de
  // l'observateur : redimensionner pendant la livraison des notifications déclenche le
  // « ResizeObserver loop completed with undelivered notifications » du navigateur, que
  // le bandeau d'erreurs de main.ts affiche en plein écran (et qui bloque les clics).
  // Depuis un rAF, le changement de taille est simplement la frame suivante.
  const fit = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      app.style.zoom = "1"; // mesurer le contenu à taille pleine, jamais à travers l'échelle précédente
      app.style.zoom = String(fitScale(screen.scrollHeight, app.clientHeight));
    });
  };
  new ResizeObserver(fit).observe(screen); // le contenu a changé de taille
  window.addEventListener("resize", fit); // la fenêtre a changé de taille
  fit();
}

/**
 * Badge « c'est vous » (#92) : avatar + pseudo, monté une seule fois sur `<body>`,
 * donc hors du `zoom` de `#app` et hors de tout re-render d'écran. Il ne remplace pas
 * l'avatar mobile de la piste — ce sont deux éléments sans rapport.
 */
export async function mountIdentityBadge(): Promise<void> {
  const id = await getIdentity();
  const el = document.createElement("div");
  el.className = "id-badge";
  // Même repli que la piste : l'initiale est DERRIÈRE l'image, visible d'elle-même si
  // le CDN ne répond pas. Aucun `onerror`.
  el.innerHTML = `<span class="id-avatar">${escapeText([...id.displayName][0]?.toUpperCase() ?? "?")}<img
      src="${escapeText(avatarUrl(id.playerId, id.avatarHash))}" alt=""></span>
    <span class="id-name">${escapeText(id.displayName)}</span>`;
  document.body.appendChild(el);
}
