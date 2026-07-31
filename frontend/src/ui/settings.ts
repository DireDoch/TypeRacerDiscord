// =============================================================================
//  ui/settings.ts — écran « Paramètres » (issue #60, PRD #59).
//
//  Le socle des Preferences : une ligne = un libellé, son explication DESSOUS, et
//  son contrôle aligné à droite (disposition Monkeytype). L'explication vit sous
//  le nom et pas dans une info-bulle : le joueur doit savoir ce qu'il change
//  avant de cliquer, pas après avoir survolé.
//
//  Les sections se DÉCLARENT (`sections()`), elles ne se codent pas une par une :
//  les issues #65-#70 ajoutent leurs lignes à cette liste, et le rendu suit.
//
//  Cet écran remplace l'ancienne vue Options du Menu, dont il reprend les liens
//  légaux en pied de page (il n'y avait rien d'autre dedans).
// =============================================================================

import {
  FONT_KEYS,
  FONT_STACKS,
  QUICK_RESTART_KEYS,
  QUICK_RESTART_LABELS,
  STOP_ON_ERROR_LABELS,
  STOP_ON_ERROR_VALUES,
  TIME_WARNING_LABELS,
  TIME_WARNING_VALUES,
  loadPreferences,
  setPreference,
  type Preferences,
} from "../core/preferences";

const REPO = "https://github.com/DireDoch/TypeRacerDiscord";

// ----------------------------------------------------------------------------
//  Modèle de ligne
// ----------------------------------------------------------------------------

/** Choix unique parmi quelques valeurs. `font` fait rendre l'option DANS la
 *  police qu'elle sélectionne — l'aperçu est le contrôle lui-même. */
export interface Segmented {
  kind: "segmented";
  value: string;
  options: { value: string; label: string; font?: string }[];
}

/** Curseur numérique continu (issue #66) — volume seul en a besoin pour l'instant. */
export interface Slider {
  kind: "slider";
  value: number;
  min: number;
  max: number;
  step: number;
}

/** Interrupteur binaire (issue #66). */
export interface Toggle {
  kind: "toggle";
  value: boolean;
}

export type Control = Segmented | Slider | Toggle;

export interface SettingRow {
  key: string;
  label: string;
  description: string;
  control: Control;
}

export interface SettingSection {
  title: string;
  rows: SettingRow[];
}

export function sections(prefs: Preferences): SettingSection[] {
  return [
    {
      title: "Apparence",
      rows: [
        {
          key: "fontFamily",
          label: "Police de frappe",
          description:
            "La police du texte à taper, des compteurs et des chiffres. Chaque choix s'affiche dans sa propre police.",
          control: {
            kind: "segmented",
            value: prefs.fontFamily,
            options: FONT_KEYS.map((key) => ({
              value: key,
              label: FONT_STACKS[key].label,
              font: FONT_STACKS[key].stack,
            })),
          },
        },
      ],
    },
    {
      title: "Solo",
      rows: [
        {
          key: "quickRestartKey",
          label: "Redémarrage rapide",
          description:
            "Redémarre Practice depuis n'importe quel écran, sans passer par un bouton. Choisir Tab lui retire sa navigation standard entre les contrôles — Échap et Entrée la laissent intacte.",
          control: {
            kind: "segmented",
            value: prefs.quickRestartKey,
            options: QUICK_RESTART_KEYS.map((key) => ({ value: key, label: QUICK_RESTART_LABELS[key] })),
          },
        },
        {
          key: "stopOnError",
          label: "Stop en cas d'erreur",
          description:
            "Lettre bloque toute frappe fausse avant qu'elle n'apparaisse. Mot laisse taper librement mais bloque l'espace tant que le mot courant n'est pas exact.",
          control: {
            kind: "segmented",
            value: prefs.stopOnError,
            options: STOP_ON_ERROR_VALUES.map((key) => ({ value: key, label: STOP_ON_ERROR_LABELS[key] })),
          },
        },
      ],
    },
    {
      title: "Son",
      rows: [
        {
          key: "soundVolume",
          label: "Volume",
          description: "Volume de tous les effets sonores du jeu.",
          control: { kind: "slider", value: prefs.soundVolume, min: 0, max: 1, step: 0.05 },
        },
        {
          key: "soundOnError",
          label: "Son sur erreur",
          description: "Joue un bref son sur une frappe incorrecte ou un espace prématuré.",
          control: { kind: "toggle", value: prefs.soundOnError },
        },
        {
          key: "timeWarning",
          label: "Avertissement de fin",
          description: "Joue un bref son quand un test chronométré (Time) approche de sa fin.",
          control: {
            kind: "segmented",
            value: prefs.timeWarning,
            options: TIME_WARNING_VALUES.map((key) => ({ value: key, label: TIME_WARNING_LABELS[key] })),
          },
        },
      ],
    },
  ];
}

// ----------------------------------------------------------------------------
//  Rendu (pur — testé comme wordsHtml, sans DOM)
// ----------------------------------------------------------------------------

/** Boutons-bascule plutôt que `role="radio"` : `aria-pressed` se lit correctement
 *  sans navigation aux flèches ni tabindex tournant à maintenir. */
function segmentedHtml(row: SettingRow, control: Segmented): string {
  const buttons = control.options
    .map(
      (option) => `
        <button type="button" data-setting="${row.key}" data-value="${option.value}"
                aria-pressed="${option.value === control.value}"
                ${option.font ? `style="font-family:${option.font}"` : ""}>${option.label}</button>`,
    )
    .join("");
  return `<div class="seg" role="group" aria-labelledby="lbl-${row.key}">${buttons}</div>`;
}

function controlHtml(row: SettingRow): string {
  const control = row.control;
  switch (control.kind) {
    case "segmented":
      return segmentedHtml(row, control);
    case "slider":
      return `<input type="range" data-setting="${row.key}" min="${control.min}" max="${control.max}"
                step="${control.step}" value="${control.value}" aria-labelledby="lbl-${row.key}">`;
    case "toggle":
      return `<input type="checkbox" data-setting="${row.key}" ${control.value ? "checked" : ""}
                aria-labelledby="lbl-${row.key}">`;
  }
}

export function rowHtml(row: SettingRow): string {
  return `
    <div class="set-row">
      <div class="set-text">
        <span class="set-label" id="lbl-${row.key}">${row.label}</span>
        <p class="set-desc">${row.description}</p>
      </div>
      <div class="set-control">${controlHtml(row)}</div>
    </div>`;
}

/** `--i` porte le rang de la section : c'est lui qui décale sa révélation. */
export function sectionHtml(section: SettingSection, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  return `
    <section class="set-section" style="--i:${index}">
      <h3><span class="set-index">${number}</span>${section.title}</h3>
      <div class="set-rows">${section.rows.map(rowHtml).join("")}</div>
    </section>`;
}

// ----------------------------------------------------------------------------
//  Écran
// ----------------------------------------------------------------------------

export class Settings {
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.onBack();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly onBack: () => void,
  ) {}

  mount(): void {
    this.render();
    window.addEventListener("keydown", this.onKey);
  }

  /** Écouteur clavier global : sans ce retrait il survivrait à l'écran. */
  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
  }

  private render(): void {
    const body = sections(loadPreferences()).map(sectionHtml).join("");
    this.root.innerHTML = `
      <section class="settings">
        <header class="settings-head">
          <h2>Paramètres</h2>
          <button type="button" class="ghost" data-act="back">← Retour</button>
        </header>
        ${body}
        <footer class="settings-foot">
          <p class="hint">Ces réglages appartiennent à cet appareil : ils ne quittent jamais votre machine.</p>
          <p class="hint">
            <a href="${REPO}/blob/main/TERMS.md" target="_blank" rel="noreferrer">Conditions d'utilisation</a>
            ·
            <a href="${REPO}/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Confidentialité</a>
          </p>
        </footer>
      </section>`;
    this.wire();
  }

  private wire(): void {
    this.root
      .querySelector<HTMLButtonElement>('[data-act="back"]')
      ?.addEventListener("click", () => this.onBack());

    // Délégation : les lignes sont regénérées à chaque changement, un écouteur
    // par bouton serait à recâbler à chaque rendu. Boutons segmentés : `data-value`
    // porte déjà la valeur cliquée.
    this.root.querySelector<HTMLElement>(".settings")?.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-setting]");
      const key = target?.dataset.setting;
      const value = target?.dataset.value;
      if (!key || value === undefined) return;
      setPreference(key as keyof Preferences, value as Preferences[keyof Preferences]);
      this.render();
    });

    // Curseur/interrupteur natifs : `change` (pas `click`), et pas de re-render à
    // chaque cran glissé — seulement au relâchement, sinon le curseur perdrait le
    // focus/le drag en cours de route.
    this.root.querySelector<HTMLElement>(".settings")?.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      const key = target.dataset.setting;
      if (!key) return;
      const value = target.type === "checkbox" ? target.checked : Number(target.value);
      setPreference(key as keyof Preferences, value as Preferences[keyof Preferences]);
      this.render();
    });
  }
}
