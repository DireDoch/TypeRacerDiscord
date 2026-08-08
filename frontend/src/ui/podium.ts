// =============================================================================
//  ui/podium.ts — podium de fin de Race (ADR 0010).
//
//  Le glossaire définit le Gap (« the headline of the finish — the number that gets
//  said out loud ») depuis le début et RIEN ne l'implémentait : l'écran de Race
//  n'affichait que du WPM. C'est ici que le Gap existe enfin, en gros, WPM et accuracy
//  en dessous.
//
//  Tout vient de `RaceOver` : l'ordre du tableau EST le classement, et la série par
//  seconde de chacun est déjà là — cliquer un joueur déplie son graphe SANS aucune
//  requête. On ne passe pas par `GET /api/runs/:id`, délibérément scopé au demandeur
//  (le serveur ne peut pas vérifier après coup « tu étais partant », la composition
//  d'une course meurt avec sa Room).
// =============================================================================

import type { PlayerEntry, RaceResult } from "../core/net";
import { avatarUrl } from "../discord";
import { drawChart } from "./results";
import { escapeText } from "./typing-zone";

/** Places dessinées sur des marches ; au-delà, la liste latérale. */
const PODIUM_PLACES = 3;
const MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Abandon OU Échec Master (ADR 0013) : ni l'un ni l'autre n'a de durée à classer. */
function isTail(r: RaceResult): boolean {
  return r.forfeit || r.failedPercent !== null;
}

/**
 * Écart avec le vainqueur, en secondes. Le vainqueur affiche 0.
 *
 * Un abandon (ou un Échec) n'a pas de durée (`durationMs` vaut 0, aucun recompute n'est
 * fait sur son log) : il n'a donc pas de Gap du tout, d'où `null` plutôt qu'un écart
 * négatif absurde. Pure — c'est la logique testée de ce fichier.
 */
export function gapSeconds(results: RaceResult[], i: number): number | null {
  const r = results[i];
  const winner = results.find((x) => !isTail(x));
  if (!r || isTail(r) || !winner) return null;
  return (r.durationMs - winner.durationMs) / 1000;
}

/**
 * Floor is lava se reconnaît à ses brûlés (ADR 0015), sans qu'aucun champ de mode n'ait à
 * voyager jusqu'ici : dans ce mode il y a toujours au moins un Brûlé (la course s'arrête
 * quand il ne reste qu'un vivant), et dans une Race normale il n'y en a jamais.
 */
export function isLava(results: RaceResult[]): boolean {
  return results.some((r) => r.burnedAtMs !== null);
}

/**
 * Le chiffre en tête d'affiche de floor is lava : le temps de SURVIE, pas le Gap — qui
 * n'existe pas dans ce mode, personne ne franchissant la ligne (ADR 0015). Même règle
 * qu'ailleurs : la grandeur qui décide du classement est celle qu'on affiche en grand.
 *
 * Le survivant a survécu jusqu'à la dernière élimination — c'est l'instant où il s'est
 * retrouvé seul, donc où la course s'est arrêtée.
 */
export function survivalLabel(results: RaceResult[], i: number): string {
  const r = results[i];
  if (!r) return "abandon";
  if (r.burnedAtMs !== null) return `brûlé à ${Math.round(r.burnedAtMs / 1000)} s`;
  if (r.failedPercent !== null) return "échec";
  if (r.forfeit) return "abandon";
  const last = Math.max(0, ...results.map((x) => x.burnedAtMs ?? 0));
  return `survécu ${Math.round(last / 1000)} s`;
}

/**
 * Spam se reconnaît à ses comptes de répétitions (ADR 0016), sans qu'aucun champ de mode
 * n'ait à voyager jusqu'ici — même astuce que `isLava` : sous ce mode chaque arrivée en
 * porte un, et il n'y en a jamais ailleurs.
 */
export function isSpam(results: RaceResult[]): boolean {
  return results.some((r) => r.reps !== null);
}

/**
 * Le chiffre en tête d'affiche de Spam : le compte BRUT de répétitions correctes, pas le
 * Gap (ADR 0016). Contrairement à floor is lava, aucune conversion n'est nécessaire — la
 * grandeur qui décide du classement est directement affichable.
 *
 * Le vainqueur est le 1er du tableau, l'ordre ÉTANT le classement (ADR 0010) : soit il a
 * atteint le seuil, soit le plafond de temps est tombé et il en avait le plus. Tous les
 * autres sont Devancé — un état terminal qui ne vient ni d'un choix ni d'une faute.
 */
export function repsLabel(results: RaceResult[], i: number): string {
  const r = results[i];
  if (!r) return "abandon";
  if (r.failedPercent !== null) return "échec";
  if (r.forfeit) return "abandon";
  const n = r.reps ?? 0;
  const reps = `${n} répétition${n === 1 ? "" : "s"}`;
  return i === 0 ? `${reps} · vainqueur` : `${reps} · devancé`;
}

/** `+1.4 s` ; le vainqueur n'a pas d'écart à afficher, il EST la référence. */
export function gapLabel(results: RaceResult[], i: number): string {
  const r = results[i];
  if (isSpam(results)) return repsLabel(results, i);
  if (isLava(results)) return survivalLabel(results, i);
  if (r?.failedPercent !== null && r?.failedPercent !== undefined) return "échec";
  const g = gapSeconds(results, i);
  if (g === null) return "abandon";
  return g <= 0 ? "vainqueur" : `+${g.toFixed(1)} s`;
}

export interface PodiumOptions {
  results: RaceResult[];
  /** Présents, pour retrouver nom et avatar. Un partant déjà reparti n'y est plus. */
  players: PlayerEntry[];
  me: string;
}

export function podiumHtml(o: PodiumOptions): string {
  const top = o.results.slice(0, PODIUM_PLACES);
  const rest = o.results.slice(PODIUM_PLACES);
  // 2e à gauche, 1er au centre, 3e à droite — l'ordre visuel d'un vrai podium.
  const order = [1, 0, 2].filter((i) => i < top.length);
  const steps = order.map((i) => stepHtml(o, i)).join("");
  const others = rest.map((_, i) => rowHtml(o, i + PODIUM_PLACES)).join("");
  return `<div class="podium">${steps}</div>
    ${others ? `<div class="podium-rest">${others}</div>` : ""}
    <div class="podium-detail" id="podiumDetail"></div>`;
}

function stepHtml(o: PodiumOptions, i: number): string {
  const r = o.results[i];
  return `<button class="podium-step place-${i + 1} ${r.playerId === o.me ? "me" : ""}"
      data-player="${escapeText(r.playerId)}">
    <span class="podium-medal">${MEDALS[i]}</span>
    ${avatarHtml(o, r.playerId)}
    <span class="podium-name">${escapeText(nameOf(o, r.playerId))}</span>
    <span class="podium-gap">${gapLabel(o.results, i)}</span>
    <span class="podium-stats">${statsLabel(r)}</span>
  </button>`;
}

function rowHtml(o: PodiumOptions, i: number): string {
  const r = o.results[i];
  return `<button class="podium-row ${r.playerId === o.me ? "me" : ""}"
      data-player="${escapeText(r.playerId)}">
    <span class="podium-rank">${isTail(r) ? "—" : `${i + 1}.`}</span>
    ${avatarHtml(o, r.playerId)}
    <span class="podium-name">${escapeText(nameOf(o, r.playerId))}</span>
    <span class="podium-gap">${gapLabel(o.results, i)}</span>
    <span class="podium-stats">${statsLabel(r)}</span>
  </button>`;
}

/**
 * Un abandon n'a pas de chiffres : ne pas écrire « 0 wpm », qui se lirait comme un score.
 * Un Échec Master affiche son pourcentage d'avancement (ADR 0013) — jamais un WPM, et
 * jamais utilisé pour classer.
 */
function statsLabel(r: RaceResult): string {
  if (r.failedPercent !== null) return `échec (${r.failedPercent}%)`;
  return r.forfeit ? "" : `${Math.round(r.wpm)} wpm · ${Math.round(r.accuracy)} %`;
}

function nameOf(o: PodiumOptions, playerId: string): string {
  return o.players.find((p) => p.playerId === playerId)?.displayName ?? playerId;
}

function avatarHtml(o: PodiumOptions, playerId: string): string {
  const p = o.players.find((x) => x.playerId === playerId);
  const initial = escapeText([...(p?.displayName ?? playerId)][0]?.toUpperCase() ?? "?");
  const src = escapeText(avatarUrl(playerId, p?.avatarHash ?? null));
  return `<span class="car">${initial}<img src="${src}" alt="" loading="lazy"></span>`;
}

/**
 * Branche le clic : déplier le graphe d'un joueur, re-cliquer le replie. Aucune requête —
 * la série est déjà dans `results`. Un abandon n'a pas de série : on le dit, plutôt que
 * d'afficher un graphe vide.
 */
export function wirePodium(root: HTMLElement, o: PodiumOptions): void {
  const detail = root.querySelector<HTMLElement>("#podiumDetail");
  if (!detail) return;
  let open = "";
  root.querySelectorAll<HTMLButtonElement>("[data-player]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.player ?? "";
      if (open === id) {
        open = "";
        detail.innerHTML = "";
        return;
      }
      open = id;
      const r = o.results.find((x) => x.playerId === id);
      if (!r || r.perSecond.length === 0) {
        const verb = r?.failedPercent !== null && r?.failedPercent !== undefined ? "a échoué" : "a abandonné";
        detail.innerHTML = `<p class="hint">${escapeText(nameOf(o, id))} ${verb} — pas de course à tracer.</p>`;
        return;
      }
      detail.innerHTML = `<p class="hint">${escapeText(nameOf(o, id))}</p>
        <div class="chart-wrap"><canvas id="podiumChart"></canvas></div>`;
      drawChart(detail.querySelector<HTMLCanvasElement>("#podiumChart")!, r.perSecond);
    });
  });
}
