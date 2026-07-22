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

/**
 * Écart avec le vainqueur, en secondes. Le vainqueur affiche 0.
 *
 * Un abandon n'a pas de durée (`durationMs` vaut 0, aucun recompute n'est fait sur son
 * log) : il n'a donc pas de Gap du tout, d'où `null` plutôt qu'un écart négatif absurde.
 * Pure — c'est la logique testée de ce fichier.
 */
export function gapSeconds(results: RaceResult[], i: number): number | null {
  const r = results[i];
  const winner = results.find((x) => !x.forfeit);
  if (!r || r.forfeit || !winner) return null;
  return (r.durationMs - winner.durationMs) / 1000;
}

/** `+1.4 s` ; le vainqueur n'a pas d'écart à afficher, il EST la référence. */
export function gapLabel(results: RaceResult[], i: number): string {
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
    <span class="podium-rank">${r.forfeit ? "—" : `${i + 1}.`}</span>
    ${avatarHtml(o, r.playerId)}
    <span class="podium-name">${escapeText(nameOf(o, r.playerId))}</span>
    <span class="podium-gap">${gapLabel(o.results, i)}</span>
    <span class="podium-stats">${statsLabel(r)}</span>
  </button>`;
}

/** Un abandon n'a pas de chiffres : ne pas écrire « 0 wpm », qui se lirait comme un score. */
function statsLabel(r: RaceResult): string {
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
      if (!r || r.forfeit || r.perSecond.length === 0) {
        detail.innerHTML = `<p class="hint">${escapeText(nameOf(o, id))} a abandonné — pas de course à tracer.</p>`;
        return;
      }
      detail.innerHTML = `<p class="hint">${escapeText(nameOf(o, id))}</p>
        <div class="chart-wrap"><canvas id="podiumChart"></canvas></div>`;
      drawChart(detail.querySelector<HTMLCanvasElement>("#podiumChart")!, r.perSecond);
    });
  });
}
