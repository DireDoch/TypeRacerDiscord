// =============================================================================
//  ui/menu.ts — menu principal (hub de navigation) + vue Options.
//
//  Écran d'arrivée : Solo (Practice), Multijoueur (Race), Paramètres, Quitter.
//  « Quitter » ferme l'Activity via le SDK (visible uniquement dans Discord).
//  Les réglages de partie (mode, durée, ponctuation…) restent dans l'écran Solo ;
//  les Preferences ont leur propre écran (ui/settings.ts), qui a remplacé la vue
//  Options — elle ne portait que les liens légaux, partis avec elle.
//
//  La vue Multijoueur porte les trois portes d'entrée d'une Room (ADR 0008) — c'est
//  aussi elle qui porte le champ du Code de partie, pas l'écran de Race : un code
//  refusé y ramène le joueur là où il peut le corriger.
// =============================================================================

import { closeActivity, isInsideDiscord } from "../discord";
import { normalizeCode, CODE_LEN } from "../core/net";
import type { RaceIntent } from "./race";

export class Menu {
  private view: "home" | "multi" = "home";

  constructor(
    private readonly root: HTMLElement,
    private readonly nav: {
      solo(): void;
      multi(intent: RaceIntent): void;
      history(): void;
      learn(): void;
      settings(): void;
    },
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
        ${this.viewHtml()}
      </section>
    `;
    this.wire();
  }

  private viewHtml(): string {
    switch (this.view) {
      case "home":
        return this.homeHtml();
      case "multi":
        return this.multiHtml();
    }
  }

  private homeHtml(): string {
    const quit = isInsideDiscord()
      ? `<button data-menu="quit">Quitter</button>`
      : "";
    return `
      <button data-menu="solo">Solo</button>
      <button data-menu="multi">Multijoueur</button>
      <button data-menu="learn">Apprendre</button>
      <button data-menu="history">Historique</button>
      <button data-menu="settings">Paramètres</button>
      ${quit}
    `;
  }

  private multiHtml(): string {
    return `
      <button data-menu="multi-channel">Jouer avec ce salon</button>
      <button data-menu="multi-create">Créer une partie</button>
      <div class="group">
        <input id="raceCode" type="text" inputmode="latin" autocomplete="off"
               maxlength="${CODE_LEN}" placeholder="Code de partie" aria-label="Code de partie" />
        <button data-menu="multi-join" disabled>Rejoindre</button>
      </div>
      <button data-menu="back">← Retour</button>
    `;
  }

  private wire(): void {
    const on = (name: string, fn: () => void) =>
      this.root
        .querySelector<HTMLButtonElement>(`[data-menu="${name}"]`)
        ?.addEventListener("click", fn);
    on("solo", () => this.nav.solo());
    on("history", () => this.nav.history());
    on("learn", () => this.nav.learn());
    on("multi", () => {
      this.view = "multi";
      this.render();
    });
    on("multi-channel", () => this.nav.multi({ kind: "channel" }));
    on("multi-create", () => this.nav.multi({ kind: "create" }));
    on("settings", () => this.nav.settings());
    on("back", () => {
      this.view = "home";
      this.render();
    });
    on("quit", () => closeActivity());
    this.wireCodeInput();
  }

  /** Le champ n'accepte que des codes possibles, et « Rejoindre » n'existe qu'à CODE_LEN. */
  private wireCodeInput(): void {
    const input = this.root.querySelector<HTMLInputElement>("#raceCode");
    const join = this.root.querySelector<HTMLButtonElement>(`[data-menu="multi-join"]`);
    if (!input || !join) return;
    const sync = (): void => {
      input.value = normalizeCode(input.value);
      join.disabled = input.value.length !== CODE_LEN;
    };
    input.addEventListener("input", sync);
    join.addEventListener("click", () => {
      if (input.value.length === CODE_LEN) this.nav.multi({ kind: "code", code: input.value });
    });
  }
}
