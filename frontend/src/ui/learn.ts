// =============================================================================
//  ui/learn.ts — écran « Apprendre » : liste des leçons + exercice (issue #4).
//
//  Une Lesson n'est PAS un Run : pas de décompte, pas de POST /api/runs, ni PB
//  ni historique. Le chrono démarre à la 1re frappe (seule l'accuracy compte —
//  la vitesse n'est jamais exigée). L'accuracy est calculée localement par la
//  RÉFÉRENCE de l'algo (core/stats/scoreboard.ts) sur le log de l'exercice.
//  La progression vient de GET /api/learn/progress et est poussée au POST à
//  chaque leçon réussie (le serveur garde le MAX).
// =============================================================================

import type { Keystroke, KeystrokeLog } from "../core/types";
import { LESSONS, generateLessonExercise, requiredAccuracy } from "../core/learn";
import { Rng, randomSeed } from "../core/text-gen/rng";
import { FreeInput } from "../core/input/free-input";
import type { InputController } from "../core/input/controller";
import { computeScoreboard } from "../core/stats/scoreboard";
import { fetchLearnProgress, submitLearnProgress } from "../api";
import { wordsHtml, placeCaret } from "./typing-zone";

// ----------------------------------------------------------------------------
//  Visuel doigts/clavier — statique, réservé aux toutes premières Lessons
//  (ADR 0006 : onboarding, pas un clavier live). SVG inline (thème via les
//  variables CSS existantes, style.css) plutôt qu'un asset externe.
// ----------------------------------------------------------------------------

const HOME_ROW_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"];
/** Touches repères : bosse physique sous le doigt (F et J), sans lever les yeux. */
const BUMP_KEYS = new Set(["f", "j"]);

/** Rangée de base, F/J marqués d'une bosse — la référence tactile du cursus. */
function homeRowFjDiagram(): string {
  const keyW = 52;
  const gap = 8;
  const keyH = 52;
  const top = 20;
  const step = keyW + gap;
  const totalW = HOME_ROW_KEYS.length * step - gap;
  const keys = HOME_ROW_KEYS.map((k, i) => {
    const x = i * step;
    const bump = BUMP_KEYS.has(k)
      ? `<circle cx="${x + keyW / 2}" cy="${top + keyH - 10}" r="3" fill="var(--main)" />`
      : "";
    return `
      <rect x="${x}" y="${top}" width="${keyW}" height="${keyH}" rx="8" fill="var(--panel)" stroke="var(--sub)" />
      <text x="${x + keyW / 2}" y="${top + keyH / 2 + 7}" text-anchor="middle" fill="var(--text)"
            font-family="var(--font-mono)" font-size="20">${k.toUpperCase()}</text>
      ${bump}`;
  }).join("");
  return `
    <svg viewBox="0 0 ${totalW} ${top + keyH + 30}" role="img" class="hand-diagram"
         aria-label="Rangée de base du clavier ; les touches F et J portent une bosse repère">
      ${keys}
      <text x="${2 * step}" y="${top + keyH + 22}" text-anchor="middle" fill="var(--sub)"
            font-family="var(--font-ui)" font-size="13">main gauche</text>
      <text x="${totalW - 2 * step}" y="${top + keyH + 22}" text-anchor="middle" fill="var(--sub)"
            font-family="var(--font-ui)" font-size="13">main droite</text>
    </svg>`;
}

const DIAGRAMS: Record<string, () => string> = {
  "home-row-fj": homeRowFjDiagram,
};

export class Learn {
  private view: "list" | "lesson" = "list";
  /** Nombre de leçons complétées : la leçon d'index N est débloquée si N <= completed. */
  private completed = 0;
  private lessonIndex = 0;
  private targetWords: string[] = [];
  private controller: InputController = new FreeInput([]);
  private log: KeystrokeLog = [];
  /** performance.now() à la 1re frappe de l'exercice (null avant). */
  private startedAt: number | null = null;
  private result: { accuracy: number; passed: boolean } | null = null;
  /** Jeton anti-course : un fetch obsolète (écran quitté) s'auto-annule. */
  private seq = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly onExit: () => void,
  ) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  mount(): void {
    void this.load();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    this.seq++;
  }

  /** Recharge la progression à l'ouverture (persistée par Player côté serveur). */
  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.root.innerHTML = `<section class="learn"><div class="loading">Chargement de ta progression…</div></section>`;
    try {
      const p = await fetchLearnProgress();
      if (seq !== this.seq) return;
      this.completed = p.completed;
    } catch {
      if (seq !== this.seq) return;
      // Hors ligne / erreur : on démarre au début, la réussite re-poussera le MAX.
      this.completed = 0;
    }
    this.view = "list";
    this.render();
  }

  // --- Exercice ---------------------------------------------------------------

  private openLesson(i: number): void {
    if (i > this.completed || i >= LESSONS.length) return; // verrouillée
    this.lessonIndex = i;
    this.startExercise();
  }

  private startExercise(): void {
    const lesson = LESSONS[this.lessonIndex];
    this.targetWords = generateLessonExercise(lesson, new Rng(randomSeed()));
    this.controller = new FreeInput(this.targetWords);
    this.log = [];
    this.startedAt = null;
    this.result = null;
    this.view = "lesson";
    this.render();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.view !== "lesson") return;
    if (e.key === "Tab") {
      e.preventDefault();
      this.startExercise(); // recommence (nouvel exercice, mêmes touches)
      return;
    }
    if (this.result) return; // écran de verdict : navigation par boutons
    if (e.key === "Backspace" || e.key === " " || e.key.length === 1) {
      e.preventDefault();
      if (this.startedAt === null) this.startedAt = performance.now();
      const t = performance.now() - this.startedAt;
      const k: Keystroke | null = this.controller.handleKey(e.key, e.ctrlKey, t);
      if (k) this.log.push(k);
      if (this.controller.isComplete()) {
        this.finishExercise();
        return;
      }
      this.renderWords();
    }
  }

  private finishExercise(): void {
    // Réutilise la référence locale de l'algo : seule l'accuracy (par frappe) gate.
    const sb = computeScoreboard({
      mode: "words",
      modeValue: this.targetWords.length,
      targetText: this.targetWords.join(" "),
      keystrokes: this.log,
    });
    const passed = sb.accuracy >= requiredAccuracy(this.lessonIndex);
    this.result = { accuracy: sb.accuracy, passed };
    if (passed && this.lessonIndex + 1 > this.completed) {
      this.completed = this.lessonIndex + 1;
      // Poussée en arrière-plan ; en cas d'échec réseau, la progression locale
      // tient jusqu'à la prochaine réussite (le serveur garde le MAX).
      void submitLearnProgress(this.completed).catch(() => {});
    }
    this.render();
  }

  // --- Rendu ------------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = `
      <section class="learn">
        ${this.view === "list" ? this.listHtml() : this.lessonHtml()}
      </section>
    `;
    this.wire();
    // L'exercice s'ouvre curseur posé sur le 1er caractère, sans frappe préalable :
    // le bloc doit être placé dès ce rendu (sinon ce caractère est invisible).
    const wordsEl = this.root.querySelector<HTMLElement>("#words");
    if (wordsEl) placeCaret(wordsEl);
  }

  private listHtml(): string {
    const items = LESSONS.map((l, i) => {
      const state = i < this.completed ? "complétée ✓" : i === this.completed ? "disponible" : "verrouillée 🔒";
      const disabled = i > this.completed ? "disabled" : "";
      return `
        <button data-lesson="${i}" ${disabled} class="lesson-item">
          <span>${i + 1}. ${l.title}</span>
          <span class="hint">${state} · accuracy ≥ ${requiredAccuracy(i)}%</span>
        </button>`;
    }).join("");
    return `
      <h2>Apprendre</h2>
      <p class="hint">Le cursus de dactylographie, leçon par leçon. Réussis l'exercice pour débloquer la suivante.</p>
      <div class="lesson-list">${items}</div>
      <button data-nav="menu">← menu</button>
    `;
  }

  private lessonHtml(): string {
    const lesson = LESSONS[this.lessonIndex];
    const content = lesson.content.map((p) => `<p class="hint">${p}</p>`).join("");
    const diagram = lesson.diagram ? (DIAGRAMS[lesson.diagram]?.() ?? "") : "";
    return `
      <h2>${this.lessonIndex + 1}. ${lesson.title}</h2>
      ${diagram}
      ${content}
      <p class="hint">Exercice — ${lesson.words ? "mots complets" : `touches : <strong>${lesson.keys.join(" ")}</strong>`} · accuracy requise : ≥ ${requiredAccuracy(this.lessonIndex)}% · la vitesse ne compte pas.</p>
      <div class="words-wrap">
        <div class="words" id="words">${this.result ? "" : this.wordsAreaHtml()}</div>
        <div class="caret-block"></div>
      </div>
      ${this.result ? this.resultHtml() : `<p class="hint">Tape pour commencer · Tab pour un autre exercice</p>`}
      <button data-nav="list">← leçons</button>
    `;
  }

  private resultHtml(): string {
    const r = this.result!;
    const required = requiredAccuracy(this.lessonIndex);
    if (!r.passed) {
      return `<p><strong>${r.accuracy}%</strong> d'accuracy — il faut ≥ ${required}%. Vas-y plus lentement, la précision d'abord. <button data-retry>Réessayer</button></p>`;
    }
    const next = this.lessonIndex + 1 < LESSONS.length ? `<button data-next>Leçon suivante →</button>` : "";
    return `<p><strong>${r.accuracy}%</strong> d'accuracy — leçon complétée ! 🎉 ${next}</p>`;
  }

  private wordsAreaHtml(): string {
    // Le curseur reste visible dès l'idle (avant la 1re frappe) : ça invite à démarrer.
    return wordsHtml(this.targetWords, this.controller.view(), true);
  }

  private renderWords(): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (!el) return;
    el.innerHTML = this.wordsAreaHtml();
    placeCaret(el);
  }

  private wire(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-lesson]").forEach((b) =>
      b.addEventListener("click", () => this.openLesson(Number(b.dataset.lesson))),
    );
    this.root.querySelector<HTMLButtonElement>("[data-retry]")?.addEventListener("click", () => this.startExercise());
    this.root.querySelector<HTMLButtonElement>("[data-next]")?.addEventListener("click", () => {
      this.openLesson(this.lessonIndex + 1);
    });
    this.root.querySelector<HTMLButtonElement>("[data-nav]")?.addEventListener("click", () => {
      if (this.view === "lesson") {
        this.view = "list";
        this.render();
      } else {
        this.onExit();
      }
    });
  }
}
