// =============================================================================
//  ui/potg.ts — Play of the Game : le duel le plus serré, au ralenti (ADR 0011).
//
//  Le duel est CHOISI par le serveur (fonction pure Rust `duel`) ; ici on ne fait
//  que le rejouer. On réutilise `feedUntil` (déjà pure, prend l'`elapsed`) et le
//  rendu `wordsHtml` de la zone de frappe — deux `FreeInput`, deux zones empilées,
//  UNE seule horloge partagée : on voit une voiture couper la ligne, puis l'autre.
//  `runReplay` n'est PAS généralisé : il reste le Replay solo simple (un log,
//  vitesse réelle, début à fin) que décrit le glossaire.
// =============================================================================

import type { KeystrokeLog } from "../core/types";
import type { PlayerEntry } from "../core/net";
import { FreeInput } from "../core/input/free-input";
import { avatarUrl } from "../discord";
import { feedUntil } from "./replay";
import { wordsHtml, placeCaret, escapeText } from "./typing-zone";

/** Ralenti : la fenêtre de ~3,5 s réelles occupe ~14 s d'écran. */
const SLOWMO = 0.25;
/** La fenêtre s'ouvre 3 s avant l'arrivée du premier des deux (ADR 0011). */
const LEAD_MS = 3000;

/** L'arrivée d'un joueur = son dernier `t` (on ne finit qu'à texte exact). 0 si log vide. */
function finishOf(log: KeystrokeLog): number {
  return log.length > 0 ? log[log.length - 1].t : 0;
}

/**
 * La fenêtre du duel sur l'horloge COMMUNE aux deux logs (même t=0 = le `RaceStart`
 * partagé) : de 3 s avant la première arrivée jusqu'à la seconde. Bornée à 0 pour un
 * duel joué dans les 3 premières secondes ; `end === start` (les deux logs vides) = rien
 * à animer. Pure — c'est la logique testée de ce fichier.
 */
export function duelWindow(
  logA: KeystrokeLog,
  logB: KeystrokeLog,
): { start: number; end: number } {
  const first = Math.min(finishOf(logA), finishOf(logB));
  const second = Math.max(finishOf(logA), finishOf(logB));
  return { start: Math.max(0, first - LEAD_MS), end: second };
}

export interface PlayOfTheGameOptions {
  /** Mots de la course JOUÉE (snapshot pris avant que la revanche écrase le texte). */
  racedWords: string[];
  logA: KeystrokeLog;
  playerA: PlayerEntry;
  logB: KeystrokeLog;
  playerB: PlayerEntry;
  onBack: () => void;
}

/**
 * Monte l'écran du duel et démarre la lecture ralentie. Renvoie une fonction d'arrêt :
 * l'appeler coupe le rAF (démontage, ou un `RaceStart` reçu pendant l'après-course — la
 * course prime). Sans ça, le rAF continuerait d'écrire dans un DOM recyclé.
 */
export function runPlayOfTheGame(root: HTMLElement, opts: PlayOfTheGameOptions): () => void {
  const win = duelWindow(opts.logA, opts.logB);
  let stopped = false;
  let rafId = 0;
  let startedAt = 0;

  const ctrlA = new FreeInput(opts.racedWords);
  const ctrlB = new FreeInput(opts.racedWords);
  let nextA = 0;
  let nextB = 0;

  root.innerHTML = `
    <section class="race potg">
      <h2 class="potg-title">Play of the Game</h2>
      ${laneHtml(opts.playerA, "A")}
      ${laneHtml(opts.playerB, "B")}
      <button id="potgBack" class="on">← podium</button>
      <p class="hint" id="potgHint">Le duel le plus serré, au ralenti.</p>
    </section>`;

  const wordsA = root.querySelector<HTMLElement>("#potgWordsA")!;
  const wordsB = root.querySelector<HTMLElement>("#potgWordsB")!;
  const hintEl = root.querySelector<HTMLElement>("#potgHint")!;

  const stop = (): void => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
  root.querySelector("#potgBack")!.addEventListener("click", () => {
    stop();
    opts.onBack();
  });

  function renderZones(playing: boolean): void {
    wordsA.innerHTML = wordsHtml(opts.racedWords, ctrlA.view(), playing);
    wordsB.innerHTML = wordsHtml(opts.racedWords, ctrlB.view(), playing);
    placeCaret(wordsA);
    placeCaret(wordsB);
  }

  // Amorçage instantané : on avance les deux voitures jusqu'à l'ouverture de la fenêtre,
  // sans animation (sinon on rejouerait toute la course au ralenti pour rien).
  nextA = feedUntil(ctrlA, opts.logA, 0, win.start);
  nextB = feedUntil(ctrlB, opts.logB, 0, win.start);
  renderZones(true);

  function loop(): void {
    if (stopped) return;
    const logTime = win.start + (performance.now() - startedAt) * SLOWMO;
    nextA = feedUntil(ctrlA, opts.logA, nextA, logTime);
    nextB = feedUntil(ctrlB, opts.logB, nextB, logTime);
    renderZones(true);
    if (logTime >= win.end) {
      renderZones(false);
      hintEl.textContent = "Fin du duel · retour au podium";
      return;
    }
    rafId = requestAnimationFrame(() => loop());
  }

  // Garde : deux logs vides (ou duel dégénéré) → rien à animer, on reste sur l'amorçage.
  if (win.end > win.start) {
    startedAt = performance.now();
    rafId = requestAnimationFrame(() => loop());
  } else {
    renderZones(false);
  }

  return stop;
}

/** Une piste : nom + avatar + zone de frappe (texte entier, pas de fenêtre glissante). */
function laneHtml(p: PlayerEntry, suffix: string): string {
  const initial = escapeText([...p.displayName][0]?.toUpperCase() ?? "?");
  const src = escapeText(avatarUrl(p.playerId, p.avatarHash));
  return `<div class="potg-lane">
    <div class="potg-name"><span class="car">${initial}<img src="${src}" alt="" loading="lazy"></span> ${escapeText(p.displayName)}</div>
    <div class="words-wrap"><div class="words" id="potgWords${suffix}"></div><div class="caret-block"></div></div>
  </div>`;
}
