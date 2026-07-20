// =============================================================================
//  ui/menu.ts — menu principal (hub de navigation) + vue Options.
//
//  Écran d'arrivée : Solo (Practice), Multijoueur (Race), Options, Quitter.
//  « Quitter » ferme l'Activity via le SDK (visible uniquement dans Discord).
//  Les réglages de partie (mode, durée, ponctuation…) restent dans l'écran Solo ;
//  la vue Options n'accueille pour l'instant que les liens légaux et la version.
// =============================================================================

import { closeActivity, isInsideDiscord } from "../discord";

const REPO = "https://github.com/DireDoch/TypeRacerDiscord";

export class Menu {
  private view: "home" | "options" = "home";

  constructor(
    private readonly root: HTMLElement,
    private readonly nav: { solo(): void; multi(): void; history(): void },
  ) {}

  mount(): void {
    this.render();
  }

  /** Rien à démonter (aucun écouteur global) — présent pour l'interface d'écran. */
  destroy(): void {}

  private render(): void {
    this.root.innerHTML = `
      <section class="menu">
        <h1>TypeRacer</h1>
        ${this.view === "home" ? this.homeHtml() : this.optionsHtml()}
      </section>
    `;
    this.wire();
  }

  private homeHtml(): string {
    const quit = isInsideDiscord()
      ? `<button data-menu="quit">Quitter</button>`
      : "";
    return `
      <button data-menu="solo">Solo</button>
      <button data-menu="multi">Multijoueur</button>
      <button data-menu="history">Historique</button>
      <button data-menu="options">Options</button>
      ${quit}
    `;
  }

  private optionsHtml(): string {
    return `
      <p class="hint">Les réglages de partie (mode, durée, ponctuation…) sont dans l'écran Solo.</p>
      <p class="hint">
        <a href="${REPO}/blob/main/TERMS.md" target="_blank" rel="noreferrer">Conditions d'utilisation</a>
        ·
        <a href="${REPO}/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Confidentialité</a>
      </p>
      <button data-menu="back">← Retour</button>
    `;
  }

  private wire(): void {
    const on = (name: string, fn: () => void) =>
      this.root
        .querySelector<HTMLButtonElement>(`[data-menu="${name}"]`)
        ?.addEventListener("click", fn);
    on("solo", () => this.nav.solo());
    on("multi", () => this.nav.multi());
    on("history", () => this.nav.history());
    on("options", () => {
      this.view = "options";
      this.render();
    });
    on("back", () => {
      this.view = "home";
      this.render();
    });
    on("quit", () => closeActivity());
  }
}
