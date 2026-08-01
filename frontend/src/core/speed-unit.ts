// =============================================================================
//  core/speed-unit.ts — conversion de vitesse (issue #69).
//
//  Le WPM reste l'unité de calcul partout (Scoreboard, live-stats, PB) : ce module ne
//  fait que CONVERTIR la valeur affichée, jamais recalculer quoi que ce soit — changer
//  d'unité ne touche ni un score ni un PB (même principe qu'une Preference : ADR/glossaire).
// =============================================================================

export type SpeedUnit = "wpm" | "cpm" | "wps" | "cps" | "wph";
export const SPEED_UNITS: SpeedUnit[] = ["wpm", "cpm", "wps", "cps", "wph"];

export const SPEED_UNIT_LABELS: Record<SpeedUnit, string> = {
  wpm: "wpm",
  cpm: "cpm",
  wps: "wps",
  cps: "cps",
  wph: "wph",
};

/** Formules fournies par l'issue #69 : CPM = WPM×5, WPS = WPM/60, CPS = CPM/60, WPH = WPM×60. */
export function convertSpeed(wpm: number, unit: SpeedUnit): number {
  switch (unit) {
    case "wpm":
      return wpm;
    case "cpm":
      return wpm * 5;
    case "wps":
      return wpm / 60;
    case "cps":
      return (wpm * 5) / 60;
    case "wph":
      return wpm * 60;
  }
}

/** Arrondi d'affichage : wps/cps restent petits (quelques unités), 1 décimale utile ;
 *  wpm/cpm/wph sont déjà des grands nombres, l'entier suffit (même convention que le
 *  Scoreboard, qui arrondit déjà le WPM lui-même). */
export function roundSpeed(wpm: number, unit: SpeedUnit): number {
  const v = convertSpeed(wpm, unit);
  return unit === "wps" || unit === "cps" ? Math.round(v * 10) / 10 : Math.round(v);
}

/** `roundSpeed` + unité accolée — pour un affichage en un seul span. */
export function formatSpeed(wpm: number, unit: SpeedUnit): string {
  return `${roundSpeed(wpm, unit)} ${SPEED_UNIT_LABELS[unit]}`;
}

/** Explication + formule de chaque unité, pour l'info-bulle de Settings (issue #69). */
export const SPEED_UNIT_EXPLANATIONS: Record<SpeedUnit, string> = {
  wpm: "Mots par minute — l'unité par défaut, un « mot » vaut 5 caractères.",
  cpm: "Caractères par minute — CPM = WPM × 5.",
  wps: "Mots par seconde — WPS = WPM ÷ 60.",
  cps: "Caractères par seconde — CPS = CPM ÷ 60.",
  wph: "Mots par heure — WPH = WPM × 60.",
};
