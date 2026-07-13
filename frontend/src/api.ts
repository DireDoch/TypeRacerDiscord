// =============================================================================
//  api.ts — frontière HTTP côté client (contrat dans Docs/API.md).
//
//  Le scoreboard est désormais AUTORITAIRE : `submitRun` POST le keystroke log brut
//  à `/api/runs` et le backend Rust recompute (anti-triche + persistance + verdict PB).
//  Le recompute local (`computeScoreboard`) n'est plus appelé ici — il reste la
//  RÉFÉRENCE de l'algo (tests de parité), pas le chemin de production.
//
//  Identité : le Bearer token vient de discord.ts (handshake Embedded App SDK, ou
//  token de dev hors Discord). Jamais de player_id dans le corps.
// =============================================================================

import type { Quote, SubmitRunRequest, SubmitRunResponse } from "./core/types";
import { getAuthToken, proxyBase } from "./discord";

/** Le scoreboard affiché provient maintenant du backend autoritaire. */
export const AUTHORITATIVE_BACKEND = true;

/** Soumet un Run et renvoie le scoreboard autoritaire + verdict PB (POST /api/runs). */
export async function submitRun(req: SubmitRunRequest): Promise<SubmitRunResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`POST /api/runs → ${res.status}`);
  return res.json();
}

/** Récupère une Quote pour un Run en Mode Quotes (proxy serveur API-Ninjas). */
export async function fetchQuote(): Promise<Quote> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/quote`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/quote → ${res.status}`);
  return res.json();
}
