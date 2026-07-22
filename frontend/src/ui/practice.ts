// =============================================================================
//  ui/practice.ts — écran de Practice (saisie libre, solo, MVP).
//
//  Machine d'état : idle → running → finished.
//  Câble le core/ pur : generateWithRng (texte seedé), RunClock (t=0 monotone),
//  FreeInput (curseur libre, log brut). À la fin : api.submitRun → résultats.
//
//  t=0 = la 1re frappe (PAS de décompte en solo — ADR 0004, CONTEXT.md « Origine du
//  temps »). Le temps de réaction n'est pas mesuré : personne d'autre n'attend.
// =============================================================================

import type { RunConfig, RunPhase, KeystrokeLog, Keystroke } from "../core/types";
import { RunClock } from "../core/clock";
import { FreeInput } from "../core/input/free-input";
import type { InputController } from "../core/input/controller";
import { generateWithRng, initialWordCount } from "../core/text-gen";
import { generateDrillText } from "../core/text-gen/drill";
import { Rng } from "../core/text-gen/rng";
import { liveWpm, liveWpmZen } from "../live-stats";
import { submitRun, fetchQuote, fetchProfileAnalysis, isIdentityError, IDENTITY_ERROR_MESSAGE } from "../api";
import { renderResults } from "./results";
import { runReplay } from "./replay";

/**
 * Libellés français des Modes (le reste de l'app est en français). Source unique :
 * barre de config, filtres et colonne « mode » de l'Historique. Les valeurs
 * `data-mode` restent en anglais — c'est le domaine, pas de l'affichage.
 */
export const MODE_LABELS: Record<RunConfig["mode"], string> = {
  time: "temps",
  words: "mots",
  quotes: "citations",
  zen: "zen",
  drill: "entraînement",
};

// 0 = Time infini (horloge désactivée, mots en flux continu, fin sur Shift+Enter).
const TIME_VALUES = [15, 30, 60, 120, 0];
const WORD_VALUES = [10, 25, 50];

/** Marge de mots gardée en avance du curseur en Time infini (retop du flux). */
const ENDLESS_LOOKAHEAD = 30;
const ENDLESS_BATCH = 40;

/**
 * Valeur par défaut d'un Mode : time → 30 s, words → 25 mots, quotes/zen/drill → 0 (sans objet).
 * Source unique (init du Run + changement de Mode dans la barre de config).
 */
function defaultModeValue(mode: RunConfig["mode"]): number {
  return mode === "time" ? 30 : mode === "words" ? 25 : 0;
}

export class Practice {
  private config: RunConfig = {
    mode: "time",
    modeValue: defaultModeValue("time"),
    language: "english",
    punctuation: false,
    numbers: false,
  };

  private phase: RunPhase = "idle";
  private seed = 0;
  private targetWords: string[] = [];
  /** Rng du Run courant, conservé pour re-générer des lots en Time infini (déterminisme). */
  private rng: Rng | null = null;
  private controller: InputController = new FreeInput([]);
  private clock = new RunClock();
  private log: KeystrokeLog = [];
  private rafId = 0;
  /** Arrêt du Replay en cours (rAF) si on quitte l'écran par reset()/destroy(). */
  private stopReplay: (() => void) | null = null;

  // Mode Quotes : la Quote vient de GET /api/quote (pas de génération seedée).
  private quoteId?: string;
  private quoteAuthor?: string;
  private quoteWikipediaUrl?: string;
  /** Texte en chargement asynchrone (Quote ou profil Drill) / échec du chargement. */
  private loadingText = false;
  private loadError = false;
  /** true si le chargement raté est un problème d'identité (pas un service indisponible). */
  private loadErrorIsIdentity = false;
  /** Drill sans profil : pas assez de données analysées pour cibler des Weak spots. */
  private drillNoProfile = false;
  /** Jeton anti-course : un reset() asynchrone obsolète (mode rechangé) s'auto-annule. */
  private resetSeq = 0;

  /** `onExit` : navigation retour vers le menu (bouton dans la barre de config). */
  constructor(
    private readonly root: HTMLElement,
    private readonly onExit?: () => void,
  ) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  mount(): void {
    void this.reset();
  }

  /** Démontage propre (navigation Practice ↔ Race) : plus d'écouteur, de rAF,
   *  ni de rendu tardif d'un reset()/fetchQuote encore en vol. */
  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    cancelAnimationFrame(this.rafId);
    this.stopReplay?.();
    this.stopReplay = null;
    this.resetSeq++;
  }

  // --- Cycle de vie d'un Run --------------------------------------------------

  private async reset(): Promise<void> {
    const seq = ++this.resetSeq;
    cancelAnimationFrame(this.rafId);
    this.stopReplay?.();
    this.stopReplay = null;
    this.phase = "idle";
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.clock.reset();
    this.log = [];
    this.rng = null;
    this.quoteId = undefined;
    this.quoteAuthor = undefined;
    this.quoteWikipediaUrl = undefined;
    this.loadError = false;
    this.loadErrorIsIdentity = false;
    this.drillNoProfile = false;

    if (this.config.mode === "quotes") {
      // La Quote est récupérée côté serveur (proxy API-Ninjas) — pas de génération locale.
      this.targetWords = [];
      this.controller = new FreeInput([]);
      this.loadingText = true;
      this.render();
      try {
        const quote = await fetchQuote();
        if (seq !== this.resetSeq) return; // un reset() plus récent a pris la main.
        this.quoteId = quote.id;
        this.quoteAuthor = quote.author;
        this.quoteWikipediaUrl = quote.wikipediaUrl;
        this.targetWords = quote.text.split(" ").filter((w) => w.length > 0);
      } catch (e) {
        if (seq !== this.resetSeq) return;
        this.loadingText = false;
        this.loadError = true;
        this.loadErrorIsIdentity = isIdentityError(e);
        this.render();
        return;
      }
      this.loadingText = false;
    } else if (this.config.mode === "drill") {
      // Drill : texte personnalisé depuis les Weak spots du profil (GET /api/profile/analysis).
      this.targetWords = [];
      this.controller = new FreeInput([]);
      this.loadingText = true;
      this.render();
      try {
        const profile = await fetchProfileAnalysis();
        if (seq !== this.resetSeq) return;
        if (profile.weakSpots.length === 0) {
          // Pas (assez) de données : le Mode l'explique et propose de jouer d'abord.
          this.loadingText = false;
          this.drillNoProfile = true;
          this.render();
          return;
        }
        this.targetWords = generateDrillText(profile.weakSpots, new Rng(this.seed));
      } catch (e) {
        if (seq !== this.resetSeq) return;
        this.loadingText = false;
        this.loadError = true;
        this.loadErrorIsIdentity = isIdentityError(e);
        this.render();
        return;
      }
      this.loadingText = false;
    } else if (this.config.mode === "time" || this.config.mode === "words") {
      // Rng conservé : Time infini re-génère des lots en CONTINUANT la même suite.
      this.rng = new Rng(this.seed);
      this.targetWords = generateWithRng(this.config, initialWordCount(this.config), this.rng);
    } else {
      // Zen : aucun texte cible. Le joueur tape librement, fin sur Shift+Enter.
      this.targetWords = [];
    }

    this.controller = new FreeInput(this.targetWords);
    this.render();
  }

  /** Modes à durée variable, sans fin naturelle : terminés uniquement sur Shift+Enter. */
  private isEndless(): boolean {
    return (
      this.config.mode === "zen" ||
      (this.config.mode === "time" && this.config.modeValue === 0)
    );
  }

  /** Time infini : garde toujours des mots en avance du curseur (flux continu). */
  private retopIfNeeded(): void {
    if (this.config.mode !== "time" || this.config.modeValue !== 0 || !this.rng) return;
    if (this.targetWords.length - this.controller.view().wordIndex > ENDLESS_LOOKAHEAD) return;
    for (const w of generateWithRng(this.config, ENDLESS_BATCH, this.rng)) {
      this.targetWords.push(w); // même tableau que FreeInput.target (référence partagée).
    }
    this.renderWords();
  }

  /** true si une frappe peut démarrer le Run (texte prêt, ou Zen qui n'en a pas besoin). */
  private canStart(): boolean {
    if (this.phase !== "idle" || this.loadingText) return false;
    return this.targetWords.length > 0 || this.config.mode === "zen";
  }

  /** 1re frappe : t=0 ici (pas de décompte en solo — ADR 0004), et elle compte déjà. */
  private beginRun(e: KeyboardEvent): void {
    this.phase = "running";
    this.clock.start(); // t=0
    this.render();
    this.loop();
    this.handleTypingKey(e);
  }

  private handleTypingKey(e: KeyboardEvent): void {
    const k: Keystroke | null = this.controller.handleKey(e.key, e.ctrlKey, this.clock.elapsed());
    if (k) this.log.push(k);
    if (!this.isEndless() && this.controller.isComplete()) {
      void this.finish();
      return;
    }
    this.retopIfNeeded(); // Time infini : réalimente si le curseur approche du bout.
    this.renderWords();
    this.updateLiveBar(this.clock.elapsed());
  }

  /** Boucle d'affichage : compteur live + fin de Run en mode Time. */
  private loop(): void {
    if (this.phase !== "running") return;
    const elapsed = this.clock.elapsed();

    if (this.config.mode === "time" && this.config.modeValue > 0 && elapsed >= this.config.modeValue * 1000) {
      void this.finish();
      return;
    }

    this.retopIfNeeded(); // Time infini : alimente le flux de mots.
    this.updateLiveBar(elapsed);
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  private async finish(): Promise<void> {
    cancelAnimationFrame(this.rafId);
    this.phase = "finished";
    const endedAtMs = this.clock.started ? this.clock.elapsed() : 0;

    let res: Awaited<ReturnType<typeof submitRun>>;
    try {
      res = await submitRun({
        config: this.config,
        seed: this.seed,
        targetText: this.targetWords.join(" "),
        quoteId: this.config.mode === "quotes" ? this.quoteId : undefined,
        keystrokes: this.log,
        endedAtMs,
      });
    } catch (e) {
      // Le log (this.log) n'est pas touché : "réessayer" relance finish() avec les mêmes frappes.
      this.renderSubmitError(isIdentityError(e) ? "auth" : "network");
      return;
    }

    const attribution =
      this.config.mode === "quotes" && this.quoteAuthor
        ? { author: this.quoteAuthor, wikipediaUrl: this.quoteWikipediaUrl ?? "" }
        : undefined;
    // Résultats ↔ Replay : le Replay relit le Run encore en mémoire (aucun réseau)
    // et son bouton « ← résultats » re-rend cet écran-ci.
    const showResults = (): void => {
      this.stopReplay = null;
      renderResults(this.root, res, () => void this.reset(), attribution, () => {
        this.stopReplay = runReplay(this.root, {
          targetWords: this.targetWords,
          log: this.log,
          zen: this.config.mode === "zen",
          onBack: showResults,
        });
      });
    };
    showResults();
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

    const isTypingKey = e.key === "Backspace" || e.key === " " || e.key.length === 1;

    if (this.phase === "idle") {
      // 1re frappe → démarre le Run directement (pas de décompte en solo — ADR 0004).
      if (!this.canStart() || !isTypingKey) return;
      e.preventDefault();
      this.beginRun(e);
      return;
    }

    if (this.phase !== "running") return;

    // Shift+Enter termine Zen / Time infini (pas de fin naturelle).
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      void this.finish();
      return;
    }

    if (isTypingKey) {
      e.preventDefault();
      this.handleTypingKey(e);
    }
  }

  // --- Rendu ------------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = `
      <section class="practice">
        ${this.configBarHtml()}
        <div class="live-bar" id="liveBar">${this.liveBarHtml(0)}</div>
        <div class="words-wrap">
          <div class="words" id="words" tabindex="0">${this.wordsAreaHtml()}</div>
          <div class="caret-block"></div>
        </div>
        <p class="hint">${this.hintText()}</p>
      </section>
    `;
    this.wireConfigBar();
    const wordsEl = this.root.querySelector<HTMLElement>("#words")!;
    // Le clic ne démarre plus rien lui-même (t=0 = 1re frappe, ADR 0004) : il ne fait
    // que donner le focus, la frappe qui suit démarre le Run.
    wordsEl.addEventListener("click", () => wordsEl.focus());
    // Le passage en `running` repasse par render() : sans ceci le bloc resterait
    // caché et le 1er caractère (qui s'inverse sous lui) serait invisible.
    placeCaret(wordsEl);
  }

  private renderWords(): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (!el) return;
    el.innerHTML = this.config.mode === "zen" ? this.zenHtml() : this.wordsHtml();
    this.slideWindow(el);
    placeCaret(el); // après slideWindow : la position du bloc dépend du scrollTop.
  }

  /**
   * Fenêtre glissante de 3 lignes (style Monkeytype) : après chaque rendu, garde la
   * ligne du mot actif au MILIEU. Le conteneur est clippé par le CSS (max-height +
   * overflow hidden) ; on le fait défiler programmatiquement par lignes entières.
   * Marche avec le wrap dynamique et le flux continu du Time infini : on mesure
   * l'offsetTop réel du mot actif après rendu, on ne compte pas les mots par ligne.
   */
  private slideWindow(container: HTMLElement): void {
    const words = container.querySelectorAll<HTMLElement>(".word");
    if (words.length === 0) return;
    // Zen : pas de cible, le mot actif est le dernier tapé.
    const active =
      this.config.mode === "zen"
        ? words[words.length - 1]
        : words[Math.min(this.controller.view().wordIndex, words.length - 1)];
    const lineHeight = parseFloat(getComputedStyle(container).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    container.scrollTop = windowScrollTop(active.offsetTop, lineHeight);
  }

  /** POST /api/runs raté : le Run (this.log) reste en mémoire, "réessayer" relance finish(). */
  private renderSubmitError(kind: "auth" | "network"): void {
    const msg =
      kind === "auth"
        ? "Session Discord expirée — reviens depuis le menu Discord puis réessaie."
        : "Envoi impossible (backend injoignable). Tes frappes sont gardées : réessaie.";
    this.root.innerHTML = `
      <section class="results">
        <p class="hint">${msg}</p>
        <button id="retrySubmit" class="primary">Réessayer</button>
      </section>
    `;
    this.root
      .querySelector<HTMLButtonElement>("#retrySubmit")!
      .addEventListener("click", () => void this.finish());
  }

  private updateLiveBar(elapsed: number): void {
    const el = this.root.querySelector<HTMLElement>("#liveBar");
    if (el) el.innerHTML = this.liveBarHtml(elapsed);
  }

  private liveBarHtml(elapsed: number): string {
    let wpm = 0;
    if (this.phase === "running") {
      wpm =
        this.config.mode === "zen"
          ? liveWpmZen(this.controller.view(), elapsed)
          : liveWpm(this.targetWords, this.controller.view(), elapsed);
    }
    const elapsedS = Math.floor(elapsed / 1000);
    let progress = "";
    if (this.config.mode === "zen" || (this.config.mode === "time" && this.config.modeValue === 0)) {
      // Endless : le chrono MONTE (pas de cible de temps). ∞ rappelle le mode.
      progress = `<span class="timer">${elapsedS}s ∞</span>`;
    } else if (this.config.mode === "time") {
      const remaining = Math.max(0, Math.ceil(this.config.modeValue - elapsed / 1000));
      progress = `<span class="timer">${remaining}s</span>`;
    } else if (this.config.mode === "words") {
      const done = this.controller.view().wordIndex;
      progress = `<span class="timer">${done}/${this.config.modeValue}</span>`;
    } else if (this.config.mode === "quotes" || this.config.mode === "drill") {
      const done = this.controller.view().wordIndex;
      progress = `<span class="timer">${done}/${this.targetWords.length}</span>`;
    }
    return `${progress}<span class="live-wpm">${wpm} wpm</span>`;
  }

  /** Contenu de la zone #words selon l'état (chargement Quote/Drill / erreur / mots). */
  private wordsAreaHtml(): string {
    const drill = this.config.mode === "drill";
    if (this.loadingText)
      return `<div class="loading">${drill ? "Analyse de tes dernières courses…" : "Chargement d'une citation…"}</div>`;
    if (this.drillNoProfile)
      return `<div class="loading">Pas encore assez de données pour cibler tes faiblesses — joue d'abord quelques courses (time, words…), puis reviens ici.</div>`;
    if (this.loadError) {
      const base = this.loadErrorIsIdentity
        ? IDENTITY_ERROR_MESSAGE
        : drill
          ? "Impossible de charger ton profil."
          : "Impossible de charger la citation.";
      return `<div class="loading">${base} Tab pour réessayer.</div>`;
    }
    if (this.config.mode === "zen") return this.zenHtml();
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

  /**
   * Rendu du Mode Zen : aucun texte cible à l'écran, on affiche uniquement ce que le
   * joueur tape (tout est « correct » — miroir de replay_zen). Le curseur suit le buffer.
   */
  private zenHtml(): string {
    if (this.phase === "idle") {
      return `<div class="loading">Zen · tape librement — Shift+Enter pour terminer.</div>`;
    }
    const view = this.controller.view();
    const caret = this.phase === "running" ? `<span class="caret"></span>` : "";
    const words = view.lockedWords
      .map((w) => `<span class="word"><span class="correct">${escapeText(w)}</span></span> `)
      .join("");
    const current = `<span class="word"><span class="correct">${escapeText(view.typed)}</span>${caret}</span>`;
    return words + current;
  }

  private hintText(): string {
    if (this.phase === "idle") {
      if (this.config.mode === "zen") return "Clique ou tape pour démarrer · Shift+Enter pour terminer";
      const regen =
        this.config.mode === "quotes"
          ? "Tab pour une autre citation"
          : this.config.mode === "drill"
            ? "Tab pour un autre texte"
            : "Tab pour regénérer";
      return `Clique ou tape pour démarrer · ${regen}`;
    }
    if (this.phase === "running") {
      return this.isEndless() ? "Shift+Enter pour terminer · Tab pour recommencer" : "Tab pour recommencer";
    }
    return "";
  }

  // --- Barre de configuration -------------------------------------------------

  private configBarHtml(): string {
    // Quotes (texte imposé), Zen (aucun texte) et Drill (texte personnalisé) :
    // ni longueur ni Settings applicables.
    const noText =
      this.config.mode === "quotes" || this.config.mode === "zen" || this.config.mode === "drill";
    const values = this.config.mode === "time" ? TIME_VALUES : WORD_VALUES;
    const valueBtns = values
      .map(
        (v) =>
          `<button data-value="${v}" class="${this.config.modeValue === v ? "on" : ""}">${v === 0 ? "∞" : v}</button>`,
      )
      .join("");
    const valueGroup = noText ? "" : `<div class="group">${valueBtns}</div>`;
    const settingsGroup = noText
      ? ""
      : `<div class="group">
          <button data-toggle="punctuation" class="${this.config.punctuation ? "on" : ""}">ponctuation</button>
          <button data-toggle="numbers" class="${this.config.numbers ? "on" : ""}">chiffres</button>
        </div>`;
    const modeBtn = (m: RunConfig["mode"]) =>
      `<button data-mode="${m}" class="${this.config.mode === m ? "on" : ""}">${MODE_LABELS[m]}</button>`;
    return `
      <div class="config">
        <div class="group">
          ${modeBtn("time")}
          ${modeBtn("words")}
          ${modeBtn("quotes")}
          ${modeBtn("zen")}
          ${modeBtn("drill")}
        </div>
        ${valueGroup}
        ${settingsGroup}
        ${this.onExit ? `<div class="group"><button data-nav="menu">← menu</button></div>` : ""}
      </div>
    `;
  }

  private wireConfigBar(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as RunConfig["mode"];
        this.config.mode = mode;
        this.config.modeValue = defaultModeValue(mode); // quotes/zen/drill : longueur sans objet (0).
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
    this.root
      .querySelector<HTMLButtonElement>("[data-nav]")
      ?.addEventListener("click", () => this.onExit?.());
  }
}

/**
 * Défilement (px) qui garde la ligne du mot actif au MILIEU des 3 lignes visibles :
 * lignes 0 et 1 → pas de défilement ; ligne n ≥ 2 → (n-1) lignes masquées en haut
 * (le curseur ne touche jamais la ligne du bas). Pure — testée dans practice.test.ts.
 * `wordTop` = offsetTop du mot actif (arrondi par le DOM, d'où le Math.round).
 */
export function windowScrollTop(wordTop: number, lineHeight: number): number {
  const line = Math.round(wordTop / lineHeight);
  return Math.max(0, line - 1) * lineHeight;
}

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

function escapeChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  return ch;
}

/** Échappe une chaîne entière (Zen : le texte tapé par le joueur). */
export function escapeText(s: string): string {
  let out = "";
  for (const ch of s) out += escapeChar(ch);
  return out;
}
