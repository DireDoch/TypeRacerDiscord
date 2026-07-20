// =============================================================================
//  ui/history.ts — écran Historique : liste des Runs passés du Player.
//
//  Branché sur GET /api/history (backend autoritaire). Filtre par Mode via la
//  barre de boutons (le filtre re-fetch côté serveur : ?mode=). Navigation par
//  boutons avec destroy() — même contrat d'écran que Practice/Race (l'URL de
//  l'iframe Discord est figée).
// =============================================================================

import type { HistoryEntry, Mode, RunConfig } from "../core/types";
import { fetchHistory } from "../api";

const FILTERS: Mode[] = ["time", "words", "quotes", "zen"];

/** Libellé compact du Mode d'un Run : « time 30s », « time ∞ », « words 25 », « quotes »… */
export function modeLabel(config: RunConfig): string {
  if (config.mode === "time") return config.modeValue === 0 ? "time ∞" : `time ${config.modeValue}s`;
  if (config.mode === "words") return `words ${config.modeValue}`;
  return config.mode;
}

export class History {
  private filter: Mode | null = null;
  /** Jeton anti-course : un fetch obsolète (filtre rechangé, écran quitté) s'auto-annule. */
  private seq = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly onExit: () => void,
  ) {}

  mount(): void {
    void this.load();
  }

  /** Invalide tout fetch en vol (pas d'écouteur global ni de rAF à défaire). */
  destroy(): void {
    this.seq++;
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.render(`<div class="loading">Chargement de l'historique…</div>`);
    try {
      const res = await fetchHistory(this.filter ?? undefined);
      if (seq !== this.seq) return;
      this.render(
        res.entries.length > 0
          ? tableHtml(res.entries)
          : `<div class="loading">Aucun Run${this.filter ? ` en Mode ${this.filter}` : ""} — joue une course !</div>`,
      );
    } catch {
      if (seq !== this.seq) return;
      this.render(`<div class="loading">Impossible de charger l'historique.</div>`);
    }
  }

  private render(body: string): void {
    const filterBtn = (m: Mode) =>
      `<button data-filter="${m}" class="${this.filter === m ? "on" : ""}">${m}</button>`;
    this.root.innerHTML = `
      <section class="history">
        <div class="config">
          <div class="group">
            <button data-filter="" class="${this.filter === null ? "on" : ""}">tous</button>
            ${FILTERS.map(filterBtn).join("")}
          </div>
          <div class="group"><button data-nav="menu">← menu</button></div>
        </div>
        ${body}
      </section>
    `;
    this.root.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = (b.dataset.filter || null) as Mode | null;
        void this.load();
      }),
    );
    this.root.querySelector<HTMLButtonElement>("[data-nav]")!.addEventListener("click", this.onExit);
  }
}

function tableHtml(entries: HistoryEntry[]): string {
  const rows = entries
    .map(
      (e) => `
        <tr>
          <td>${new Date(e.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td>
          <td>${e.kind === "race" ? "race" : "practice"}</td>
          <td>${modeLabel(e.config)}</td>
          <td class="num">${e.wpm}</td>
          <td class="num">${e.accuracy}%</td>
          <td class="num">${(e.durationMs / 1000).toFixed(1)}s</td>
        </tr>`,
    )
    .join("");
  return `
    <table class="history-table">
      <thead>
        <tr><th>date</th><th>type</th><th>mode</th><th class="num">wpm</th><th class="num">acc</th><th class="num">durée</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
