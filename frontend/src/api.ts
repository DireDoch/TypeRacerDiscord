// =============================================================================
//  api.ts — frontière HTTP côté client (contrat dans Docs/API.md).
//
//  ÉTAT MVP : le backend Rust n'est pas encore câblé. `submitRun` recompute donc le
//  scoreboard EN LOCAL via computeScoreboard (la référence de l'algorithme), pour que
//  l'écran de résultats fonctionne dès aujourd'hui. Le jour où POST /api/runs existe,
//  on remplace le corps de `submitRun` par le fetch — le reste de l'app ne bouge pas
//  (mêmes types SubmitRunRequest / SubmitRunResponse).
// =============================================================================

import type { SubmitRunRequest, SubmitRunResponse } from "./core/types";
import { computeScoreboard } from "./core/stats/scoreboard";

/** true tant que le backend autoritaire n'est pas branché (affiché dans l'UI). */
export const AUTHORITATIVE_BACKEND = false;

/**
 * Soumet un Run et renvoie le scoreboard autoritaire + verdict PB.
 *
 * MVP : recompute local (anti-triche absent, pas de persistance, PB toujours « inconnu »).
 * TODO Phase backend : remplacer par
 *   const res = await fetch("/api/runs", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
 *     body: JSON.stringify(req),
 *   });
 *   return res.json();
 */
export async function submitRun(req: SubmitRunRequest): Promise<SubmitRunResponse> {
  const scoreboard = computeScoreboard({
    mode: req.config.mode,
    modeValue: req.config.modeValue,
    targetText: req.targetText,
    keystrokes: req.keystrokes,
    endedAtMs: req.endedAtMs,
  });

  return {
    runId: `local_${Date.now()}`,
    scoreboard,
    isPersonalBest: false, // inconnu sans backend (le PB se dérive en base)
    previousPbWpm: null,
  };
}
