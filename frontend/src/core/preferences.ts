// =============================================================================
//  core/preferences.ts — les Preferences du Player (glossaire CONTEXT.md).
//
//  Une Preference appartient à l'APPAREIL : elle ne quitte jamais la machine,
//  n'entre jamais dans le Config bucket et ne change jamais un score. D'où
//  localStorage et RIEN d'autre — aucune table, aucun endpoint (PRD #59).
//
//  Le stockage est une frontière de confiance comme une autre : l'utilisateur
//  peut l'éditer à la main, une version antérieure a pu y écrire autre chose, et
//  l'import JSON (#70) y déversera un jour un fichier venu d'ailleurs. Toute
//  valeur inconnue ou hors domaine retombe donc sur le défaut, clé par clé —
//  jamais de rejet global qui ferait perdre les autres réglages au passage.
//
//  Pas de cache module : `loadPreferences()` relit le stockage à chaque appel.
//  C'est un JSON.parse par rendu d'écran, soit rien du tout, et ça évite un état
//  global à invalider (et à réinitialiser entre deux tests).
// =============================================================================

import { SPEED_UNITS, type SpeedUnit } from "./speed-unit";
export type { SpeedUnit };

/** Polices proposées à la frappe. Aucune n'exige de fichier supplémentaire :
 *  JetBrains Mono et Inter sont déjà auto-hébergées (la CSP des Activities
 *  interdit Google Fonts), les deux autres sont des piles système. Guillemets
 *  SIMPLES : ces piles partent aussi dans un attribut `style="…"` en HTML. */
export const FONT_STACKS = {
  jetbrains: { label: "JetBrains Mono", stack: `'JetBrains Mono', ui-monospace, monospace` },
  system: { label: "Système", stack: `ui-monospace, Consolas, monospace` },
  courier: { label: "Courier", stack: `'Courier New', Courier, monospace` },
  inter: { label: "Inter", stack: `'Inter', 'Segoe UI', system-ui, sans-serif` },
} as const;

export type FontFamily = keyof typeof FONT_STACKS;

export const FONT_KEYS = Object.keys(FONT_STACKS) as FontFamily[];

/** Redémarrage rapide (issue #65) : la touche qui redémarre depuis n'importe quel état
 *  de Practice. "off" laisse Tab au comportement standard (navigation) — un bouton
 *  cliquable (résultats) reste toujours disponible. */
export type QuickRestartKey = "off" | "tab" | "esc" | "enter";
export const QUICK_RESTART_KEYS: QuickRestartKey[] = ["off", "tab", "esc", "enter"];
export const QUICK_RESTART_LABELS: Record<QuickRestartKey, string> = {
  off: "Désactivé",
  tab: "Tab",
  esc: "Échap",
  enter: "Entrée",
};
/** `KeyboardEvent.key` DOM associée à chaque valeur, `null` = aucun raccourci câblé. */
export const QUICK_RESTART_DOM_KEY: Record<QuickRestartKey, string | null> = {
  off: null,
  tab: "Tab",
  esc: "Escape",
  enter: "Enter",
};

/** Stop on error (issue #65) : granularité du blocage en Practice — jamais en Race
 *  (Solo only). "letter" bloque toute frappe fausse ; "word" bloque l'espace tant que
 *  le mot courant n'est pas exact. */
export type StopOnError = "off" | "letter" | "word";
export const STOP_ON_ERROR_VALUES: StopOnError[] = ["off", "letter", "word"];
export const STOP_ON_ERROR_LABELS: Record<StopOnError, string> = {
  off: "Désactivé",
  letter: "Lettre",
  word: "Mot",
};

/** Avertissement sonore avant la fin d'un test chronométré (issue #66) — Time
 *  uniquement, `off` par défaut (aucun bruit non demandé). */
export type TimeWarning = "off" | "1s" | "3s" | "5s" | "10s";
export const TIME_WARNING_VALUES: TimeWarning[] = ["off", "1s", "3s", "5s", "10s"];
export const TIME_WARNING_LABELS: Record<TimeWarning, string> = {
  off: "Désactivé",
  "1s": "1 s",
  "3s": "3 s",
  "5s": "5 s",
  "10s": "10 s",
};
/** Secondes restantes déclenchant l'avertissement, `null` si désactivé. */
export const TIME_WARNING_SECONDS: Record<TimeWarning, number | null> = {
  off: null,
  "1s": 1,
  "3s": 3,
  "5s": 5,
  "10s": 10,
};

/** Style d'un indicateur live (issue #67) — "text" (défaut, valeur numérique visible)
 *  ou "off" (masqué). Pas de variante visuelle inventée sans maquette : ces deux-là
 *  couvrent le seul besoin réel, afficher ou pas. */
export type LiveStatStyle = "text" | "off";
export const LIVE_STAT_STYLES: LiveStatStyle[] = ["text", "off"];
export const LIVE_STAT_STYLE_LABELS: Record<LiveStatStyle, string> = { text: "Texte", off: "Masqué" };

/** Opacité du texte timer/live-stats (issue #67), en fraction directe (pas d'index). */
export type TimerOpacity = 0.25 | 0.5 | 0.75 | 1;
export const TIMER_OPACITIES: TimerOpacity[] = [0.25, 0.5, 0.75, 1];

/**
 * Highlight mode (issue #68) : ce qui est mis en avant AU-DELÀ du mot courant dans la
 * zone de frappe. "off"/"letter" ne mettent rien en avant en plus de la lettre sous le
 * curseur (déjà portée par le curseur bloc) — le texte à venir reste uniformément net,
 * comportement d'origine. "word"/"next-*-words" éclaircissent une fenêtre de N mots
 * après le courant et assombrissent tout le reste pour la faire ressortir.
 */
export type HighlightMode = "off" | "letter" | "word" | "next-word" | "next-two-words" | "next-three-words";
export const HIGHLIGHT_MODES: HighlightMode[] = [
  "off",
  "letter",
  "word",
  "next-word",
  "next-two-words",
  "next-three-words",
];
export const HIGHLIGHT_MODE_LABELS: Record<HighlightMode, string> = {
  off: "Désactivé",
  letter: "Lettre",
  word: "Mot",
  "next-word": "Mot suivant",
  "next-two-words": "2 mots suivants",
  "next-three-words": "3 mots suivants",
};

export interface Preferences {
  fontFamily: FontFamily;
  quickRestartKey: QuickRestartKey;
  stopOnError: StopOnError;
  soundVolume: number;
  soundOnError: boolean;
  timeWarning: TimeWarning;
  liveSpeedStyle: LiveStatStyle;
  liveAccuracyStyle: LiveStatStyle;
  liveBurstStyle: LiveStatStyle;
  timerOpacity: TimerOpacity;
  showAllLines: boolean;
  highlightMode: HighlightMode;
  speedUnit: SpeedUnit;
}

/** Défaut + domaine de validité d'une clé. L'issue suivante (#70)
 *  ajoutent leurs clés ICI : c'est le seul endroit à toucher pour qu'une
 *  Preference soit typée, validée, persistée et réinitialisable. */
const SPEC: { [K in keyof Preferences]: { default: Preferences[K]; valid: (v: unknown) => boolean } } = {
  fontFamily: {
    default: "jetbrains",
    valid: (v) => typeof v === "string" && v in FONT_STACKS,
  },
  quickRestartKey: {
    default: "off",
    valid: (v) => typeof v === "string" && (QUICK_RESTART_KEYS as string[]).includes(v),
  },
  stopOnError: {
    default: "off",
    valid: (v) => typeof v === "string" && (STOP_ON_ERROR_VALUES as string[]).includes(v),
  },
  soundVolume: {
    default: 0.5,
    valid: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
  },
  soundOnError: {
    default: false,
    valid: (v) => typeof v === "boolean",
  },
  timeWarning: {
    default: "off",
    valid: (v) => typeof v === "string" && (TIME_WARNING_VALUES as string[]).includes(v),
  },
  liveSpeedStyle: {
    default: "text",
    valid: (v) => typeof v === "string" && (LIVE_STAT_STYLES as string[]).includes(v),
  },
  liveAccuracyStyle: {
    default: "text",
    valid: (v) => typeof v === "string" && (LIVE_STAT_STYLES as string[]).includes(v),
  },
  liveBurstStyle: {
    default: "text",
    valid: (v) => typeof v === "string" && (LIVE_STAT_STYLES as string[]).includes(v),
  },
  timerOpacity: {
    default: 1,
    valid: (v) => typeof v === "number" && (TIMER_OPACITIES as number[]).includes(v),
  },
  showAllLines: {
    default: false,
    valid: (v) => typeof v === "boolean",
  },
  highlightMode: {
    default: "letter",
    valid: (v) => typeof v === "string" && (HIGHLIGHT_MODES as string[]).includes(v),
  },
  speedUnit: {
    default: "wpm",
    valid: (v) => typeof v === "string" && (SPEED_UNITS as string[]).includes(v),
  },
};

const KEYS = Object.keys(SPEC) as (keyof Preferences)[];

const STORAGE_KEY = "typeracer:preferences";

/** Écriture d'une clé sans perdre le lien clé↔type (l'indexation générique le
 *  perdrait, et un cast par `Record<string, unknown>` le masquerait). */
function assign<K extends keyof Preferences>(
  target: Partial<Preferences>,
  key: K,
  value: Preferences[K],
): void {
  target[key] = value;
}

export function defaultPreferences(): Preferences {
  const out: Partial<Preferences> = {};
  for (const key of KEYS) assign(out, key, SPEC[key].default);
  return out as Preferences;
}

/** Reconstruit des Preferences complètes depuis n'importe quoi. Clé absente ou
 *  hors domaine → son défaut ; les clés valides autour sont conservées. */
export function parsePreferences(raw: unknown): Preferences {
  const out = defaultPreferences();
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const value = src[key];
    if (value !== undefined && SPEC[key].valid(value)) {
      assign(out, key, value as Preferences[typeof key]);
    }
  }
  return out;
}

/** Stockage indisponible (iframe cloisonnée, mode privé) : on tourne sur les
 *  défauts plutôt que de casser l'écran. */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parsePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultPreferences();
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Rien à faire : la Preference reste appliquée pour la session en cours.
  }
}

/** Écrit une clé si sa valeur est dans le domaine, puis applique. Renvoie les
 *  Preferences résultantes (inchangées si la valeur était refusée). */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): Preferences {
  const current = loadPreferences();
  if (!SPEC[key].valid(value)) return current;
  const next = { ...current, [key]: value };
  savePreferences(next);
  applyPreferences(next);
  return next;
}

export function resetPreferences(): Preferences {
  const next = defaultPreferences();
  savePreferences(next);
  applyPreferences(next);
  return next;
}

/** Projette les Preferences sur le document. `--font-mono` porte la police de
 *  frappe ET les chiffres (compteurs, chrono, tableaux) — c'est la même variable
 *  depuis toujours, une seule police à choisir plutôt que deux. */
export function applyPreferences(prefs: Preferences = loadPreferences()): void {
  document.documentElement.style.setProperty("--font-mono", FONT_STACKS[prefs.fontFamily].stack);
}
