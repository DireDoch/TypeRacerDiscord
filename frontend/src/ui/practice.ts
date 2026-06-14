// =============================================================================
//  ui/practice.ts — écran de Practice (saisie libre, solo, MVP).
//
//  Machine d'état : idle → countdown(3s) → running → finished.
//  Câble le core/ pur : generateText (texte seedé), RunClock (t=0 monotone),
//  FreeInput (curseur borné au mot, log brut). À la fin : api.submitRun → résultats.
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
import { submitRun } from "../api";
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

  constructor(private readonly root: HTMLElement) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  mount(): void {
    this.reset();
  }

  // --- Cycle de vie d'un Run --------------------------------------------------

  private reset(): void {
    cancelAnimationFrame(this.rafId);
    this.phase = "idle";
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.targetWords =
      this.config.mode === "time" || this.config.mode === "words"
        ? generateText(this.config, initialWordCount(this.config), this.seed)
        : [];
    this.controller = new FreeInput(this.targetWords);
    this.clock.reset();
    this.log = [];
    this.render();
  }

  private startCountdown(): void {
    if (this.phase !== "idle") return;
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
      keystrokes: this.log,
      endedAtMs,
    });

    renderResults(this.root, res, () => this.reset());
  }

  // --- Clavier ----------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    // Tab = recommencer, depuis n'importe quel état.
    if (e.key === "Tab") {
      e.preventDefault();
      this.reset();
      return;
    }

    if (this.phase === "finished") {
      if (e.key === "Enter") this.reset();
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
        <div class="words" id="words" tabindex="0">${this.wordsHtml()}</div>
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
    }
    return `${progress}<span class="live-wpm">${wpm} wpm</span>`;
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
    if (this.phase === "idle") return "Clique ou tape pour démarrer · Tab pour regénérer";
    if (this.phase === "running") return "Tab pour recommencer";
    return "";
  }

  // --- Barre de configuration -------------------------------------------------

  private configBarHtml(): string {
    const values = this.config.mode === "time" ? TIME_VALUES : WORD_VALUES;
    const valueBtns = values
      .map(
        (v) =>
          `<button data-value="${v}" class="${this.config.modeValue === v ? "on" : ""}">${v}</button>`,
      )
      .join("");
    return `
      <div class="config">
        <div class="group">
          <button data-mode="time" class="${this.config.mode === "time" ? "on" : ""}">time</button>
          <button data-mode="words" class="${this.config.mode === "words" ? "on" : ""}">words</button>
        </div>
        <div class="group">${valueBtns}</div>
        <div class="group">
          <button data-toggle="punctuation" class="${this.config.punctuation ? "on" : ""}">punctuation</button>
          <button data-toggle="numbers" class="${this.config.numbers ? "on" : ""}">numbers</button>
        </div>
      </div>
    `;
  }

  private wireConfigBar(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as RunConfig["mode"];
        this.config.mode = mode;
        this.config.modeValue = mode === "time" ? 30 : 25;
        this.reset();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((b) =>
      b.addEventListener("click", () => {
        this.config.modeValue = Number(b.dataset.value);
        this.reset();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.toggle as "punctuation" | "numbers";
        this.config[key] = !this.config[key];
        this.reset();
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
