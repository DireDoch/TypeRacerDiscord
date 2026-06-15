// =============================================================================
//  ui/practice.ts — écran de Practice (saisie libre, solo, MVP).
//
//  Machine d'état : idle → countdown(3s) → running → finished.
//  Câble le core/ pur : generateText (texte seedé), RunClock (t=0 monotone),
//  FreeInput (curseur libre, log brut). À la fin : api.submitRun → résultats.
//
//  t=0 = fin du décompte (PAS la 1re frappe). Le temps de réaction est compté, comme
//  figé dans CONTEXT.md. Seul countdown→running appelle clock.start().
// =============================================================================

import type { RunConfig, RunPhase, KeystrokeLog, Keystroke } from "../core/types";
import { RunClock } from "../core/clock";
import { FreeInput } from "../core/input/free-input";
import type { InputController } from "../core/input/controller";
import { generateText, initialWordCount } from "../core/text-gen";
import { liveWpm } from "../live-stats";
import { submitRun, fetchQuote } from "../api";
import { renderResults } from "./results";

const TIME_VALUES = [15, 30, 60, 120];
const WORD_VALUES = [10, 25, 50];

export class Practice {
  private config: RunConfig = {
    mode: "time",
    modeValue: 30,
    language: "english",
    punctuation: false,
    numbers: false,
  };

  private phase: RunPhase = "idle";
  private seed = 0;
  private targetWords: string[] = [];
  private controller: InputController = new FreeInput([]);
  private clock = new RunClock();
  private log: KeystrokeLog = [];
  private rafId = 0;

  // Mode Quotes : la Quote vient de GET /api/quote (pas de génération seedée).
  private quoteId?: string;
  private quoteAuthor?: string;
  private quoteWikipediaUrl?: string;
  private loadingQuote = false;
  private quoteError = false;
  /** Jeton anti-course : un reset() asynchrone obsolète (mode rechangé) s'auto-annule. */
  private resetSeq = 0;

  constructor(private readonly root: HTMLElement) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  mount(): void {
    void this.reset();
  }

  // --- Cycle de vie d'un Run --------------------------------------------------

  private async reset(): Promise<void> {
    const seq = ++this.resetSeq;
    cancelAnimationFrame(this.rafId);
    this.phase = "idle";
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.clock.reset();
    this.log = [];
    this.quoteId = undefined;
    this.quoteAuthor = undefined;
    this.quoteWikipediaUrl = undefined;
    this.quoteError = false;

    if (this.config.mode === "quotes") {
      // La Quote est récupérée côté serveur (proxy API-Ninjas) — pas de génération locale.
      this.targetWords = [];
      this.controller = new FreeInput([]);
      this.loadingQuote = true;
      this.render();
      try {
        const quote = await fetchQuote();
        if (seq !== this.resetSeq) return; // un reset() plus récent a pris la main.
        this.quoteId = quote.id;
        this.quoteAuthor = quote.author;
        this.quoteWikipediaUrl = quote.wikipediaUrl;
        this.targetWords = quote.text.split(" ").filter((w) => w.length > 0);
      } catch {
        if (seq !== this.resetSeq) return;
        this.loadingQuote = false;
        this.quoteError = true;
        this.render();
        return;
      }
      this.loadingQuote = false;
    } else {
      this.targetWords =
        this.config.mode === "time" || this.config.mode === "words"
          ? generateText(this.config, initialWordCount(this.config), this.seed)
          : [];
    }

    this.controller = new FreeInput(this.targetWords);
    this.render();
  }

  private startCountdown(): void {
    if (this.phase !== "idle") return;
    // Rien à taper encore : Quote en cours de chargement, en erreur, ou Mode sans texte.
    if (this.loadingQuote || this.targetWords.length === 0) return;
    this.phase = "countdown";
    let n = 3;
    this.renderCountdown(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        this.beginRun();
        return;
      }
      this.renderCountdown(n);
      window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  }

  private beginRun(): void {
    this.phase = "running";
    this.clock.start(); // t=0
    this.render();
    this.loop();
  }

  /** Boucle d'affichage : compteur live + fin de Run en mode Time. */
  private loop(): void {
    if (this.phase !== "running") return;
    const elapsed = this.clock.elapsed();

    if (this.config.mode === "time" && this.config.modeValue > 0 && elapsed >= this.config.modeValue * 1000) {
      this.finish();
      return;
    }

    this.updateLiveBar(elapsed);
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  private async finish(): Promise<void> {
    cancelAnimationFrame(this.rafId);
    this.phase = "finished";
    const endedAtMs = this.clock.started ? this.clock.elapsed() : 0;

    const res = await submitRun({
      config: this.config,
      seed: this.seed,
      targetText: this.targetWords.join(" "),
      quoteId: this.config.mode === "quotes" ? this.quoteId : undefined,
      keystrokes: this.log,
      endedAtMs,
    });

    const attribution =
      this.config.mode === "quotes" && this.quoteAuthor
        ? { author: this.quoteAuthor, wikipediaUrl: this.quoteWikipediaUrl ?? "" }
        : undefined;
    renderResults(this.root, res, () => void this.reset(), attribution);
  }

  // --- Clavier ----------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    // Tab = recommencer, depuis n'importe quel état.
    if (e.key === "Tab") {
      e.preventDefault();
      void this.reset();
      return;
    }

    if (this.phase === "finished") {
      if (e.key === "Enter") void this.reset();
      return;
    }

    if (this.phase === "idle") {
      // Première interaction clavier → lance le décompte (sauf modificateurs seuls).
      if (e.key.length === 1 || e.key === "Enter") {
        e.preventDefault();
        this.startCountdown();
      }
      return;
    }

    if (this.phase !== "running") return; // countdown : on ignore les frappes

    // Shift+Enter termine Zen / Time infini (pas de fin naturelle).
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      this.finish();
      return;
    }

    if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
      e.preventDefault();
      const k: Keystroke | null = this.controller.handleKey(e.key, e.ctrlKey, this.clock.elapsed());
      if (k) this.log.push(k);

      if (this.controller.isComplete()) {
        this.finish();
        return;
      }
      this.renderWords();
      this.updateLiveBar(this.clock.elapsed());
    }
  }

  // --- Rendu ------------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = `
      <section class="practice">
        ${this.configBarHtml()}
        <div class="live-bar" id="liveBar">${this.liveBarHtml(0)}</div>
        <div class="words" id="words" tabindex="0">${this.wordsAreaHtml()}</div>
        <p class="hint">${this.hintText()}</p>
      </section>
    `;
    this.wireConfigBar();
    this.root.querySelector<HTMLElement>("#words")!.addEventListener("click", () => this.startCountdown());
  }

  private renderWords(): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (el) el.innerHTML = this.wordsHtml();
  }

  private renderCountdown(n: number): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (el) el.innerHTML = `<div class="countdown">${n}</div>`;
  }

  private updateLiveBar(elapsed: number): void {
    const el = this.root.querySelector<HTMLElement>("#liveBar");
    if (el) el.innerHTML = this.liveBarHtml(elapsed);
  }

  private liveBarHtml(elapsed: number): string {
    const wpm = this.phase === "running" ? liveWpm(this.targetWords, this.controller.view(), elapsed) : 0;
    let progress = "";
    if (this.config.mode === "time" && this.config.modeValue > 0) {
      const remaining = Math.max(0, Math.ceil(this.config.modeValue - elapsed / 1000));
      progress = `<span class="timer">${remaining}s</span>`;
    } else if (this.config.mode === "words") {
      const done = this.controller.view().wordIndex;
      progress = `<span class="timer">${done}/${this.config.modeValue}</span>`;
    } else if (this.config.mode === "quotes") {
      const done = this.controller.view().wordIndex;
      progress = `<span class="timer">${done}/${this.targetWords.length}</span>`;
    }
    return `${progress}<span class="live-wpm">${wpm} wpm</span>`;
  }

  /** Contenu de la zone #words selon l'état (chargement Quote / erreur / mots). */
  private wordsAreaHtml(): string {
    if (this.loadingQuote) return `<div class="loading">Chargement d'une citation…</div>`;
    if (this.quoteError)
      return `<div class="loading">Impossible de charger la citation. Tab pour réessayer.</div>`;
    return this.wordsHtml();
  }

  private wordsHtml(): string {
    const view = this.controller.view();
    return this.targetWords
      .map((target, i) => {
        if (i < view.lockedWords.length) return renderWord(target, view.lockedWords[i], false);
        if (i === view.wordIndex) return renderWord(target, view.typed, this.phase === "running");
        return renderWord(target, "", false);
      })
      .join("");
  }

  private hintText(): string {
    if (this.phase === "idle") {
      const regen = this.config.mode === "quotes" ? "Tab pour une autre citation" : "Tab pour regénérer";
      return `Clique ou tape pour démarrer · ${regen}`;
    }
    if (this.phase === "running") return "Tab pour recommencer";
    return "";
  }

  // --- Barre de configuration -------------------------------------------------

  private configBarHtml(): string {
    // Quotes : longueur et Settings ne s'appliquent pas (le Player tape la Quote entière).
    const isQuotes = this.config.mode === "quotes";
    const values = this.config.mode === "time" ? TIME_VALUES : WORD_VALUES;
    const valueBtns = values
      .map(
        (v) =>
          `<button data-value="${v}" class="${this.config.modeValue === v ? "on" : ""}">${v}</button>`,
      )
      .join("");
    const valueGroup = isQuotes ? "" : `<div class="group">${valueBtns}</div>`;
    const settingsGroup = isQuotes
      ? ""
      : `<div class="group">
          <button data-toggle="punctuation" class="${this.config.punctuation ? "on" : ""}">punctuation</button>
          <button data-toggle="numbers" class="${this.config.numbers ? "on" : ""}">numbers</button>
        </div>`;
    return `
      <div class="config">
        <div class="group">
          <button data-mode="time" class="${this.config.mode === "time" ? "on" : ""}">time</button>
          <button data-mode="words" class="${this.config.mode === "words" ? "on" : ""}">words</button>
          <button data-mode="quotes" class="${isQuotes ? "on" : ""}">quotes</button>
        </div>
        ${valueGroup}
        ${settingsGroup}
      </div>
    `;
  }

  private wireConfigBar(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as RunConfig["mode"];
        this.config.mode = mode;
        // time : 30 s · words : 25 mots · quotes : longueur dictée par la Quote (0).
        this.config.modeValue = mode === "time" ? 30 : mode === "words" ? 25 : 0;
        void this.reset();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((b) =>
      b.addEventListener("click", () => {
        this.config.modeValue = Number(b.dataset.value);
        void this.reset();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.toggle as "punctuation" | "numbers";
        this.config[key] = !this.config[key];
        void this.reset();
      }),
    );
  }
}

/** Rend un mot caractère par caractère (correct / incorrect / extra / untyped + caret). */
function renderWord(target: string, typed: string, withCaret: boolean): string {
  const spans: string[] = [];
  const len = Math.max(target.length, typed.length);
  for (let i = 0; i < len; i++) {
    const caret = withCaret && i === typed.length ? `<span class="caret"></span>` : "";
    if (i < typed.length) {
      const cls = i >= target.length ? "extra" : typed[i] === target[i] ? "correct" : "incorrect";
      spans.push(`${caret}<span class="${cls}">${escapeChar(typed[i])}</span>`);
    } else {
      spans.push(`${caret}<span class="untyped">${escapeChar(target[i])}</span>`);
    }
  }
  if (withCaret && typed.length >= len) spans.push(`<span class="caret"></span>`);
  return `<span class="word">${spans.join("")}</span> `;
}

function escapeChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  return ch;
}
