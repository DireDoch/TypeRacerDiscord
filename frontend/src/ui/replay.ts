// =============================================================================
//  ui/replay.ts — Replay : relecture d'un Run depuis son Keystroke log (CONTEXT.md).
//
//  Lecture simple (décision de grilling) : du début à la fin, à vitesse réelle,
//  sans pause ni navigation. On re-nourrit un FreeInput NEUF avec les frappes du
//  log à leurs timestamps d'origine ; le rendu réutilise renderWord/windowScrollTop
//  de Practice — le Replay est donc visuellement identique à la saisie live,
//  erreurs et corrections incluses. Aucun appel réseau : tout vient du log.
// =============================================================================

import type { KeystrokeLog } from "../core/types";
import { FreeInput } from "../core/input/free-input";
import type { InputController, InputView } from "../core/input/controller";
import { renderWord, windowScrollTop, escapeText, placeCaret } from "./practice";

export interface ReplayOptions {
  /** Mots cibles du Run (l'array complet au moment du finish — Time infini inclus). */
  targetWords: string[];
  log: KeystrokeLog;
  /** Zen : pas de texte cible, on affiche ce qui a été tapé (tout « correct »). */
  zen: boolean;
  /** Retour à l'écran de résultats. */
  onBack: () => void;
}

/**
 * Rejoue dans `controller` les événements de `log` dus à l'instant `elapsed`
 * (ms depuis le début de la lecture), à partir de l'index `from`.
 * Renvoie l'index du premier événement encore à venir. Pure vis-à-vis de
 * l'horloge — c'est la logique testée de ce fichier.
 */
export function feedUntil(
  controller: InputController,
  log: KeystrokeLog,
  from: number,
  elapsed: number,
): number {
  let i = from;
  while (i < log.length && log[i].t <= elapsed) {
    const k = log[i];
    controller.handleKey(k.ctrl ? "Backspace" : k.k, k.ctrl === "backspace-word", k.t);
    i++;
  }
  return i;
}

/**
 * Monte l'écran de Replay dans `root` et démarre la lecture.
 * Renvoie une fonction d'arrêt (à appeler si on quitte l'écran par ailleurs :
 * reset()/destroy() de Practice) — sinon le rAF continuerait d'écrire dans un
 * DOM recyclé.
 */
export function runReplay(root: HTMLElement, opts: ReplayOptions): () => void {
  const duration = opts.log.length > 0 ? opts.log[opts.log.length - 1].t : 0;
  let controller: InputController = new FreeInput(opts.zen ? [] : opts.targetWords);
  let next = 0;
  let rafId = 0;
  let startedAt = 0;
  let stopped = false;

  root.innerHTML = `
    <section class="practice replay">
      <div class="config">
        <div class="group"><button id="replayBack">← résultats</button></div>
        <div class="group"><button id="replayAgain">revoir</button></div>
      </div>
      <div class="live-bar" id="replayBar"></div>
      <div class="words-wrap">
        <div class="words" id="replayWords"></div>
        <div class="caret-block"></div>
      </div>
      <p class="hint" id="replayHint"></p>
    </section>
  `;
  const wordsEl = root.querySelector<HTMLElement>("#replayWords")!;
  const barEl = root.querySelector<HTMLElement>("#replayBar")!;
  const hintEl = root.querySelector<HTMLElement>("#replayHint")!;

  const stop = (): void => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
  root.querySelector("#replayBack")!.addEventListener("click", () => {
    stop();
    opts.onBack();
  });
  root.querySelector("#replayAgain")!.addEventListener("click", () => start());

  function renderWords(playing: boolean): void {
    const view = controller.view();
    wordsEl.innerHTML = opts.zen ? zenHtml(view, playing) : wordsHtml(opts.targetWords, view, playing);
    // Même fenêtre glissante de 3 lignes que la saisie live (mot actif au milieu).
    const words = wordsEl.querySelectorAll<HTMLElement>(".word");
    const lineHeight = parseFloat(getComputedStyle(wordsEl).lineHeight);
    if (words.length > 0 && Number.isFinite(lineHeight) && lineHeight > 0) {
      const idx = opts.zen ? words.length - 1 : Math.min(view.wordIndex, words.length - 1);
      wordsEl.scrollTop = windowScrollTop(words[idx].offsetTop, lineHeight);
    }
    placeCaret(wordsEl); // après le défilement : la position dépend du scrollTop.
  }

  function loop(): void {
    if (stopped) return;
    const elapsed = performance.now() - startedAt;
    const before = next;
    next = feedUntil(controller, opts.log, next, elapsed);
    if (next !== before) renderWords(true);
    barEl.innerHTML = `<span class="timer">${(Math.min(elapsed, duration) / 1000).toFixed(1)}s</span>`;
    if (next >= opts.log.length) {
      renderWords(false);
      hintEl.textContent = "Replay terminé · revoir, ou retour aux résultats";
      return;
    }
    rafId = requestAnimationFrame(() => loop());
  }

  function start(): void {
    cancelAnimationFrame(rafId);
    controller = new FreeInput(opts.zen ? [] : opts.targetWords);
    next = 0;
    startedAt = performance.now();
    hintEl.textContent = "Replay · vitesse réelle";
    renderWords(true);
    rafId = requestAnimationFrame(() => loop());
  }

  start();
  return stop;
}

/** Même rendu mot-à-mot que Practice.wordsHtml (correct/incorrect/extra + caret). */
function wordsHtml(targetWords: string[], view: InputView, playing: boolean): string {
  return targetWords
    .map((target, i) => {
      if (i < view.lockedWords.length) return renderWord(target, view.lockedWords[i], false);
      if (i === view.wordIndex) return renderWord(target, view.typed, playing);
      return renderWord(target, "", false);
    })
    .join("");
}

/** Miroir du rendu Zen de Practice : uniquement le texte tapé, tout « correct ». */
function zenHtml(view: InputView, playing: boolean): string {
  const caret = playing ? `<span class="caret"></span>` : "";
  const words = view.lockedWords
    .map((w) => `<span class="word"><span class="correct">${escapeText(w)}</span></span> `)
    .join("");
  return words + `<span class="word"><span class="correct">${escapeText(view.typed)}</span>${caret}</span>`;
}
