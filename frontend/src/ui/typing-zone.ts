// =============================================================================
//  ui/typing-zone.ts — rendu partagé de la zone de frappe (issue #21).
//
//  Feuille de l'arbre d'imports : ne dépend d'aucun écran (`ui/practice.ts` et
//  consorts), pour que Practice/Race/Apprendre/Replay puissent tous en dépendre
//  sans cycle. UNE boucle de rendu mot-à-mot, UN échappement HTML (sûr en
//  contexte attribut, ex. href), UNE fenêtre glissante — chaque écran garde SA
//  propre notion de « curseur actif » (running / !doneLocal / playing / …),
//  passée en paramètre : la machine d'état reste dans l'écran, seul le rendu
//  mot-à-mot est partagé ici.
// =============================================================================

import type { InputView } from "../core/input/controller";

/** Rend un mot caractère par caractère (correct / incorrect / extra / untyped + curseur). */
export function renderWord(target: string, typed: string, withCaret: boolean): string {
  const spans: string[] = [];
  const len = Math.max(target.length, typed.length);
  for (let i = 0; i < len; i++) {
    // Curseur bloc : le caractère RECOUVERT porte .at-cursor et s'inverse (couleur
    // du fond sur le corail, 7:1) — c'est ce qui le garde lisible sous le bloc.
    const cur = withCaret && i === typed.length ? " at-cursor" : "";
    if (i < typed.length) {
      const cls = i >= target.length ? "extra" : typed[i] === target[i] ? "correct" : "incorrect";
      spans.push(`<span class="${cls}${cur}">${escapeChar(typed[i])}</span>`);
    } else {
      spans.push(`<span class="untyped${cur}">${escapeChar(target[i])}</span>`);
    }
  }
  // Curseur au-delà du dernier caractère : aucun glyphe à recouvrir, on laisse un
  // repère de largeur nulle (le bloc garde sa dernière largeur mesurée).
  if (withCaret && typed.length >= len) spans.push(`<span class="caret"></span>`);
  return `<span class="word">${spans.join("")}</span> `;
}

/**
 * Rendu mot-à-mot standard (Practice/Race/Apprendre/Replay hors Zen) : mots
 * verrouillés, mot courant (curseur si `active`), mots pas encore atteints.
 */
export function wordsHtml(targetWords: string[], view: InputView, active: boolean): string {
  return targetWords
    .map((target, i) => {
      if (i < view.lockedWords.length) return renderWord(target, view.lockedWords[i], false);
      if (i === view.wordIndex) return renderWord(target, view.typed, active);
      return renderWord(target, "", false);
    })
    .join("");
}

/** Rendu Zen (Practice/Replay) : aucun texte cible, uniquement ce qui a été tapé (tout « correct »). */
export function zenHtml(view: InputView, active: boolean): string {
  const caret = active ? `<span class="caret"></span>` : "";
  const words = view.lockedWords
    .map((w) => `<span class="word"><span class="correct">${escapeText(w)}</span></span> `)
    .join("");
  return words + `<span class="word"><span class="correct">${escapeText(view.typed)}</span>${caret}</span>`;
}

function escapeChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  if (ch === '"') return "&quot;"; // sûr en contexte attribut (ex. href d'un lien Wikipedia)
  return ch;
}

/** Échappe une chaîne entière — sûr en contenu ET en contexte attribut. */
export function escapeText(s: string): string {
  let out = "";
  for (const ch of s) out += escapeChar(ch);
  return out;
}

/**
 * Défilement (px) qui garde la ligne du mot actif au MILIEU des 3 lignes visibles
 * (style Monkeytype) : lignes 0 et 1 → pas de défilement ; ligne n ≥ 2 → (n-1)
 * lignes masquées en haut (le curseur ne touche jamais la ligne du bas). Pure —
 * testée dans typing-zone.test.ts. `wordTop` = offsetTop du mot actif (arrondi
 * par le DOM, d'où le Math.round).
 */
export function windowScrollTop(wordTop: number, lineHeight: number): number {
  const line = Math.round(wordTop / lineHeight);
  return Math.max(0, line - 1) * lineHeight;
}

/**
 * Fenêtre glissante de 3 lignes : fait défiler `container` (clippé par le CSS,
 * max-height + overflow hidden) pour garder la ligne du mot `activeWordIndex` au
 * milieu. Utilisée par Practice et Replay ; Race et Apprendre lèvent le clip CSS
 * et n'ont pas besoin de défilement (texte entier visible).
 */
export function slideWindow(container: HTMLElement, activeWordIndex: number): void {
  const words = container.querySelectorAll<HTMLElement>(".word");
  if (words.length === 0) return;
  const active = words[Math.min(activeWordIndex, words.length - 1)];
  const lineHeight = parseFloat(getComputedStyle(container).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
  container.scrollTop = windowScrollTop(active.offsetTop, lineHeight);
}

/**
 * Place le curseur bloc sur le caractère courant de `container` (.words). Le bloc
 * est un élément UNIQUE, frère de .words (les rendus font `innerHTML =`, qui
 * détruirait un enfant et annulerait sa transition) : on ne fait que le déplacer,
 * le glissement est la `transition: transform` du CSS.
 */
export function placeCaret(container: HTMLElement): void {
  const block = container.parentElement?.querySelector<HTMLElement>(".caret-block");
  if (!block) return;
  const anchor = container.querySelector<HTMLElement>(".at-cursor, .caret");
  block.style.opacity = anchor ? "1" : "0";
  if (!anchor) return;
  // ponytail: en fin de mot l'ancre est vide (0×0) → on garde les dernières
  // mesures. La zone de frappe est en mono : tous les glyphes ont la même boîte.
  if (anchor.offsetWidth) block.style.width = `${anchor.offsetWidth}px`;
  // Hauteur/position VERTICALE mesurées sur .word (la ligne), pas sur le glyphe :
  // un span inline nu (l'ancre) ne mesure que sa boîte de contenu, plus courte
  // que la ligne — les descendantes (p y q g j) dépassaient donc du bloc.
  const line = anchor.closest<HTMLElement>(".word") ?? anchor;
  if (line.offsetHeight) block.style.height = `${line.offsetHeight}px`;
  const x = container.offsetLeft + anchor.offsetLeft;
  const y = container.offsetTop + line.offsetTop - container.scrollTop;
  block.style.transform = `translate(${x}px, ${y}px)`;
}
