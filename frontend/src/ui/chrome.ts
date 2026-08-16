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
import { generateWithRng } from "../core/text-gen";
import { Rng } from "../core/text-gen/rng";

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
  //
  // À être précis : le rAF déplace l'écriture hors de la fenêtre de livraison, il ne
  // prouve pas à lui seul que la boucle se referme. Mesuré (Chrome, fenêtre 1100x620,
  // écran où le fit est actif à 0,65) : 0 écriture de zoom sur 181 frames au repos —
  // le zoom appliqué ne change pas la taille observée de #screen, l'arête de rétroaction
  // ne se referme donc pas. Si ce comportement changeait, le symptôme serait un relayout
  // forcé par frame : c'est ce compteur-là qu'il faudrait reprendre.
  const fit = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      app.style.zoom = "1"; // mesurer le contenu à taille pleine, jamais à travers l'échelle précédente
      const k = fitScale(screen.scrollHeight, app.clientHeight);
      app.style.zoom = String(k);
      // Exposé au CSS pour que le bouton de retour puisse se contre-mettre à l'échelle :
      // il vit DANS ce sous-arbre zoomé alors que le badge d'identité est sur <body>, et
      // les deux ancres du HUD doivent rester de la même taille (voir style.css).
      app.style.setProperty("--fit", String(k));
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
 *
 * Le badge est posé VIDE et TOUT DE SUITE (#181), puis rempli quand le handshake
 * Discord répond. C'est le contraire d'un écran d'attente bloquant : `CONTEXT.md` acte
 * que le handshake est « amorcé tôt, non bloquant », et suspendre le jeu sur un
 * aller-retour réseau qui peut échouer donnerait un écran noir au lieu d'un menu
 * utilisable. Ce qui gênait n'était pas l'attente, c'était le SAUT — le badge
 * apparaissait après le menu et poussait la mise en page. En réservant sa place dès la
 * première frame, plus rien ne bouge : seul le contenu se précise.
 *
 * Cliquer le badge mène à l'Historique (#183), qui porte déjà l'onglet « mes
 * faiblesses ». Il n'existe pas d'écran Profil, et `CONTEXT.md` bannit le terme sur
 * l'entrée **Player** (`_Avoid_: Profile`).
 */
export async function mountIdentityBadge(onOpen?: () => void): Promise<void> {
  const el = document.createElement(onOpen ? "button" : "div");
  el.className = "id-badge";
  // Squelette aux dimensions finales : la pastille et la largeur du nom sont posées
  // avant de savoir QUI on est, donc l'arrivée de l'identité ne décale rien.
  el.innerHTML = `<span class="id-avatar"></span><span class="id-name"></span>`;
  if (onOpen) {
    (el as HTMLButtonElement).type = "button";
    el.setAttribute("aria-label", "Voir mon historique");
    el.addEventListener("click", onOpen);
  }
  document.body.appendChild(el);

  const id = await getIdentity();
  // Même repli que la piste : l'initiale est DERRIÈRE l'image, visible d'elle-même si
  // le CDN ne répond pas. Aucun `onerror`.
  el.innerHTML = `<span class="id-avatar">${escapeText([...id.displayName][0]?.toUpperCase() ?? "?")}<img
      src="${escapeText(avatarUrl(id.playerId, id.avatarHash))}" alt=""></span>
    <span class="id-name">${escapeText(id.displayName)}</span>`;
}

/** Rangées du champ de mots, et mots par rangée avant la couture. */
const WORDFIELD_ROWS = 7;
const WORDFIELD_WORDS = 30;

/**
 * Le champ de mots (#175) — la signature visuelle du Menu.
 *
 * Le fond n'est pas un décor abstrait : c'est une COURSE FANTÔME. Sept rangées de vrais
 * mots de la word-list, tirées par le même générateur seedé que le jeu, chacune traversée
 * par une tête de frappe corail qui avance à sa propre vitesse — la grammaire à deux états
 * de la zone de frappe (tapé / à venir), qui tourne en boucle derrière le menu. Un champ
 * de particules aurait pu aller sur n'importe quel produit ; celui-ci est fait de la
 * matière même du jeu.
 *
 * Trois contraintes ont dicté la forme :
 *
 * 1. **Hors de `#screen`.** `fitToViewport` observe `#screen` et y écrit `zoom` ; le
 *    fichier documente que si l'arête de rétroaction se refermait, le symptôme serait un
 *    relayout forcé PAR FRAME. Le champ vit donc sur `<body>`, en `fixed`, comme le badge.
 * 2. **Zéro JS d'animation.** Pas de canvas, pas de rAF : deux propriétés animées en CSS
 *    (`transform` pour la dérive, `background-position` pour la tête de frappe), toutes
 *    deux composables par le GPU.
 * 3. **Le Menu seulement.** Derrière une zone de frappe, des mots qui bougent seraient du
 *    bruit sur la seule chose que le joueur doit lire. Le CSS le masque partout ailleurs.
 *
 * Seed fixe : le champ est identique à chaque lancement. C'est un décor, il n'a aucune
 * raison de surprendre — et un seed fixe le rend reproductible en capture d'écran.
 */
export function mountWordField(): void {
  const rng = new Rng(0x7ace_b00c);
  const field = document.createElement("div");
  field.className = "wordfield";
  field.setAttribute("aria-hidden", "true"); // décor : jamais annoncé, jamais atteignable
  for (let i = 0; i < WORDFIELD_ROWS; i++) {
    const row = document.createElement("div");
    row.className = "wordfield-row";
    // Le texte est écrit DEUX FOIS : la dérive se fait sur -50 % de la largeur, donc la
    // seconde copie a exactement pris la place de la première quand la boucle reboucle.
    // Sans ça, la rangée laisserait un trou visible à chaque tour.
    const words = generateWithRng({ punctuation: false, numbers: false }, WORDFIELD_WORDS, rng).join(" ");
    row.textContent = `${words} ${words} `;
    // Vitesses volontairement premières entre elles : les rangées ne se resynchronisent
    // jamais, donc l'œil ne trouve pas la boucle. C'est ce qui fait « plusieurs joueurs »
    // plutôt que « une texture qui défile ».
    row.style.setProperty("--wf-drift", `${67 + i * 13}s`);
    row.style.setProperty("--wf-sweep", `${7 + i * 2.3}s`);
    row.style.setProperty("--wf-delay", `${i * -3.7}s`);
    field.appendChild(row);
  }
  document.body.appendChild(field);
}
