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
  HIGHLIGHT_MODES,
  HIGHLIGHT_MODE_LABELS,
  LIVE_STAT_STYLES,
  LIVE_STAT_STYLE_LABELS,
  QUICK_RESTART_KEYS,
  QUICK_RESTART_LABELS,
  STOP_ON_ERROR_LABELS,
  STOP_ON_ERROR_VALUES,
  TIME_WARNING_LABELS,
  TIME_WARNING_VALUES,
  applyPreferences,
  exportPreferences,
  importPreferences,
  loadPreferences,
  resetPreferences,
  savePreferences,
  setPreference,
  type Preferences,
} from "../core/preferences";
import { SPEED_UNITS, SPEED_UNIT_EXPLANATIONS, SPEED_UNIT_LABELS } from "../core/speed-unit";
import { escapeText } from "./typing-zone";

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

/** Nombre entier libre (issue #70) — un plafond FPS personnalisé n'est pas une
 *  poignée de valeurs discrètes comme `Slider`, l'entrée native `number` s'impose. */
export interface NumberInput {
  kind: "number";
  value: number;
  min?: number;
  placeholder?: string;
}

export type Control = Segmented | Slider | Toggle | NumberInput;

export interface SettingRow {
  key: string;
  label: string;
  description: string;
  control: Control;
  /** Info-bulle native (issue #69) — hover sur un (i), pour un détail trop long pour la
   *  description toujours visible (ex. formule de chaque unité de vitesse). */
  tooltip?: string;
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
        {
          key: "liveSpeedStyle",
          label: "Style — vitesse live",
          description: "Affiche ou masque le compteur de vitesse live pendant la frappe.",
          control: {
            kind: "segmented",
            value: prefs.liveSpeedStyle,
            options: LIVE_STAT_STYLES.map((key) => ({ value: key, label: LIVE_STAT_STYLE_LABELS[key] })),
          },
        },
        {
          key: "liveAccuracyStyle",
          label: "Style — précision live",
          description: "Affiche ou masque la précision live pendant la frappe.",
          control: {
            kind: "segmented",
            value: prefs.liveAccuracyStyle,
            options: LIVE_STAT_STYLES.map((key) => ({ value: key, label: LIVE_STAT_STYLE_LABELS[key] })),
          },
        },
        {
          key: "liveBurstStyle",
          label: "Style — burst live",
          description: "Affiche ou masque la vitesse du mot en cours pendant la frappe.",
          control: {
            kind: "segmented",
            value: prefs.liveBurstStyle,
            options: LIVE_STAT_STYLES.map((key) => ({ value: key, label: LIVE_STAT_STYLE_LABELS[key] })),
          },
        },
        {
          key: "timerOpacity",
          label: "Opacité du timer",
          description: "Opacité du texte de progression, vitesse, précision et burst live (25/50/75/100 %).",
          control: { kind: "slider", value: prefs.timerOpacity, min: 0.25, max: 1, step: 0.25 },
        },
        {
          key: "showAllLines",
          label: "Afficher toutes les lignes",
          description:
            "Solo uniquement (words/citations) : montre le texte entier au lieu de la fenêtre de 3 lignes. Peut masquer le timer/les stats live sous un long texte — c'est attendu.",
          control: { kind: "toggle", value: prefs.showAllLines },
        },
        {
          key: "highlightMode",
          label: "Mode de surbrillance",
          description:
            "Ce qui est mis en avant devant le curseur. Lettre/désactivé laissent tout le texte net ; les modes Mot assombrissent tout sauf une fenêtre de mots proches.",
          control: {
            kind: "segmented",
            value: prefs.highlightMode,
            options: HIGHLIGHT_MODES.map((key) => ({ value: key, label: HIGHLIGHT_MODE_LABELS[key] })),
          },
        },
        {
          key: "speedUnit",
          label: "Unité de vitesse",
          description: "L'unité utilisée partout où une vitesse de frappe est affichée.",
          tooltip: SPEED_UNITS.map((u) => `${SPEED_UNIT_LABELS[u]} — ${SPEED_UNIT_EXPLANATIONS[u]}`).join("\n"),
          control: {
            kind: "segmented",
            value: prefs.speedUnit,
            options: SPEED_UNITS.map((key) => ({ value: key, label: SPEED_UNIT_LABELS[key] })),
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
    case "number":
      return `<input type="number" data-setting="${row.key}" min="${control.min ?? 0}" value="${control.value}"
                ${control.placeholder ? `placeholder="${control.placeholder}"` : ""} aria-labelledby="lbl-${row.key}">`;
  }
}

/** `title` natif : hover ET focus clavier donnent la bulle sans une ligne de JS. */
function tooltipHtml(row: SettingRow): string {
  if (!row.tooltip) return "";
  return `<span class="set-info" tabindex="0" title="${escapeText(row.tooltip)}" aria-label="${escapeText(row.tooltip)}">ⓘ</span>`;
}

export function rowHtml(row: SettingRow): string {
  return `
    <div class="set-row">
      <div class="set-text">
        <span class="set-label" id="lbl-${row.key}">${row.label}${tooltipHtml(row)}</span>
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
    const secs = sections(loadPreferences());
    const body = secs.map(sectionHtml).join("");
    this.root.innerHTML = `
      <section class="settings">
        <header class="settings-head">
          <h2>Paramètres</h2>
          <button type="button" class="back-btn" data-act="back">← Retour</button>
        </header>
        ${body}
        ${this.dangerZoneHtml(secs.length)}
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

  /**
   * Zone à risque (issue #70) : à part de `sections()` — ce ne sont pas des
   * Preferences à valeur unique mais des ACTIONS (export/import/reset), avec
   * confirmation native (`confirm()`, pas de composant modal dans ce dépôt à
   * réutiliser — la plateforme le fait déjà). Import et Reset écrasent des
   * réglages existants : confirmation. Export ne fait que lire ; le curseur FPS
   * est une Preference comme une autre (déjà réversible) : ni l'un ni l'autre n'en a besoin.
   */
  private dangerZoneHtml(index: number): string {
    const number = String(index + 1).padStart(2, "0");
    const fps = loadPreferences().fpsLimit;
    return `
      <section class="set-section" style="--i:${index}">
        <h3><span class="set-index">${number}</span>Zone à risque</h3>
        <div class="set-rows">
          <div class="set-row">
            <div class="set-text">
              <span class="set-label" id="lbl-fpsLimit">Plafond d'images/s</span>
              <p class="set-desc">Limite la fréquence de l'animation live (compteurs qui bougent). 0 = natif, illimité.</p>
            </div>
            <div class="set-control">
              <input type="number" data-setting="fpsLimit" min="0" value="${fps}" placeholder="natif" aria-labelledby="lbl-fpsLimit">
            </div>
          </div>
          <div class="set-row">
            <div class="set-text">
              <span class="set-label">Exporter les Preferences</span>
              <p class="set-desc">Télécharge un fichier JSON de tes réglages actuels.</p>
            </div>
            <div class="set-control"><button type="button" data-act="export">Exporter</button></div>
          </div>
          <div class="set-row">
            <div class="set-text">
              <span class="set-label">Importer des Preferences</span>
              <p class="set-desc">Restaure des réglages depuis un fichier JSON exporté — écrase les réglages actuels, après confirmation.</p>
            </div>
            <div class="set-control">
              <button type="button" data-act="import">Importer</button>
              <input type="file" id="importFile" accept="application/json" hidden>
            </div>
          </div>
          <p class="set-desc set-error" id="importError" hidden></p>
          <div class="set-row">
            <div class="set-text">
              <span class="set-label">Réinitialiser les réglages</span>
              <p class="set-desc">Remet tous les réglages ci-dessus à leur défaut, après confirmation. Ne touche à rien d'autre.</p>
            </div>
            <div class="set-control"><button type="button" class="danger" data-act="reset-settings">Réinitialiser</button></div>
          </div>
        </div>
      </section>`;
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

    this.wireDangerZone();
  }

  /** Zone à risque (issue #70) : export/import/reset, à part de la délégation
   *  générique ci-dessus — ce sont des actions, pas des Preferences à valeur unique. */
  private wireDangerZone(): void {
    this.root.querySelector<HTMLButtonElement>('[data-act="export"]')?.addEventListener("click", () => {
      const blob = new Blob([exportPreferences()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "typeracer-preferences.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    const fileInput = this.root.querySelector<HTMLInputElement>("#importFile");
    this.root
      .querySelector<HTMLButtonElement>('[data-act="import"]')
      ?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // permet de réimporter le même fichier deux fois de suite
      if (file) void this.handleImportFile(file);
    });

    this.root.querySelector<HTMLButtonElement>('[data-act="reset-settings"]')?.addEventListener("click", () => {
      if (!confirm("Réinitialiser tous les réglages à leur défaut ?")) return;
      resetPreferences();
      this.render();
    });
  }

  /** Rejeté (JSON cassé, ou pas un objet) → erreur visible, RIEN n'est écrit. Valide →
   *  confirmation avant d'écraser les réglages actuels (issue #70). */
  private async handleImportFile(file: File): Promise<void> {
    const parsed = importPreferences(await file.text());
    if (!parsed) {
      const err = this.root.querySelector<HTMLElement>("#importError");
      if (err) {
        err.textContent = "Fichier invalide — ce n'est pas un JSON de Preferences.";
        err.hidden = false;
      }
      return;
    }
    if (!confirm("Remplacer tes réglages actuels par ceux de ce fichier ?")) return;
    savePreferences(parsed);
    applyPreferences(parsed);
    this.render();
  }
}
