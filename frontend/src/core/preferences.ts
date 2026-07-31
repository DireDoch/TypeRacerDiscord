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

export interface Preferences {
  fontFamily: FontFamily;
}

/** Défaut + domaine de validité d'une clé. Les issues suivantes (#65-#70)
 *  ajoutent leurs clés ICI : c'est le seul endroit à toucher pour qu'une
 *  Preference soit typée, validée, persistée et réinitialisable. */
const SPEC: { [K in keyof Preferences]: { default: Preferences[K]; valid: (v: unknown) => boolean } } = {
  fontFamily: {
    default: "jetbrains",
    valid: (v) => typeof v === "string" && v in FONT_STACKS,
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
