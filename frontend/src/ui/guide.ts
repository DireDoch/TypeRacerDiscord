// =============================================================================
//  ui/guide.ts — le Guide (UI : « Comment jouer »), issue #173.
//
//  Le Guide explique l'APPLICATION : à quoi sert chaque entrée du menu, où lancer
//  une Run, où vivent les réglages. Il n'enseigne jamais la frappe — c'est le rôle
//  d'une Lesson (écran « Apprendre », ADR 0006), et le glossaire tient les deux
//  concepts séparés exprès.
//
//  Ce n'est pas un écran : pas de `destroy()`, pas de passage par `swap()`. C'est un
//  calque posé sur <body> au-dessus de ce qui est déjà là, précisément pour que le
//  joueur voie le Menu derrière pendant qu'on le lui décrit.
// =============================================================================

import { escapeText } from "./typing-zone";

/**
 * Sa propre clé de stockage, hors du `SPEC` de `core/preferences.ts` — décision de la
 * session de grilling, actée au glossaire : « a Preference is always *chosen* by the
 * Player ; state the app merely *records* lives in its own storage key ». Un drapeau
 * « a déjà vu le Guide » n'est pas un réglage, personne ne le règle.
 */
const SEEN_KEY = "typeracer:guide-seen";

/** Un accès au stockage ne doit jamais empêcher le jeu de démarrer (mode privé,
 *  stockage plein, iframe restreinte) : dans le doute, on considère le Guide non vu. */
export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Stockage refusé : le Guide se rouvrira au prochain lancement. Sans gravité —
    // il est de toute façon fermable, et joignable depuis le menu.
  }
}

/**
 * Les entrées du Guide sont EXACTEMENT celles du menu, dans le même ordre et sous les
 * mêmes libellés. C'est ce qui en fait un plan et non une brochure : le joueur lit une
 * ligne, lève les yeux, et retrouve le mot sur un bouton.
 *
 * Pas de numérotation : ces entrées ne forment pas une séquence — on ne « fait » pas
 * Solo puis Multijoueur puis Apprendre. Les numéroter laisserait croire à un ordre qui
 * n'existe pas.
 */
const ENTRIES: ReadonlyArray<{ label: string; body: string }> = [
  {
    label: "Solo",
    body: "Tape le texte affiché, c'est tout. La barre du haut choisit le mode (temps, mots, citations…), sa durée et les options de texte. Le chrono part à ta première frappe : rien ne t'attend, rien ne te presse.",
  },
  {
    label: "Multijoueur",
    body: "« Jouer avec ce salon » ouvre une course dans ton salon vocal. « Créer une partie » te donne un code de cinq caractères : qui le saisit te rejoint, même depuis un autre serveur Discord.",
  },
  {
    label: "Apprendre",
    body: "Cent leçons de dactylographie, débloquées une à une. C'est la précision qui ouvre la suivante — jamais la vitesse.",
  },
  {
    label: "Historique",
    body: "Toutes tes courses passées, et l'onglet « mes faiblesses », qui repère les touches et les enchaînements qui te ralentissent vraiment.",
  },
  {
    label: "Paramètres",
    body: "Police, couleurs, sons, confort de frappe. Ces réglages restent sur cet appareil et ne changent jamais un score.",
  },
];

/** Rendu pur, testable sans DOM — même patron que `wordsHtml` et `rowHtml`. */
export function guideHtml(): string {
  const items = ENTRIES.map(
    (e) => `<div class="guide-entry">
      <dt>${escapeText(e.label)}</dt>
      <dd>${escapeText(e.body)}</dd>
    </div>`,
  ).join("");
  return `<div class="guide-panel" role="dialog" aria-modal="true" aria-labelledby="guideTitle">
    <h2 id="guideTitle">Comment jouer</h2>
    <dl class="guide-entries">${items}</dl>
    <p class="guide-foot">Ce guide reste disponible dans le menu, sous « Comment jouer ».</p>
    <button type="button" id="guideContinue" class="primary">Continuer</button>
  </div>`;
}

/**
 * Ouvre le Guide. Renvoie une fonction de fermeture — l'appelant n'a rien d'autre à
 * retenir.
 *
 * Le drapeau « vu » est écrit à la FERMETURE, jamais à l'ouverture : un joueur qui
 * ferme Discord pendant qu'il lit n'aurait sinon jamais revu le Guide.
 */
export function openGuide(): () => void {
  const layer = document.createElement("div");
  layer.className = "guide-layer";
  layer.innerHTML = guideHtml();
  document.body.appendChild(layer);

  const close = (): void => {
    markGuideSeen();
    document.removeEventListener("keydown", onKey);
    layer.remove();
  };
  // Échap ferme : un calque qui se ferme au clavier est un minimum, pas une finition.
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);

  const btn = layer.querySelector<HTMLButtonElement>("#guideContinue");
  btn?.addEventListener("click", close);
  // Le focus part sur « Continuer » : la sortie est atteignable à la touche suivante,
  // sans avoir à traverser le texte à la tabulation.
  btn?.focus();
  return close;
}
