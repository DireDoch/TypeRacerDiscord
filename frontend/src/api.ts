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

import type {
  AnalysisResponse,
  HistoryResponse,
  LearnProgress,
  Quote,
  RunDetailResponse,
  SubmitRunRequest,
  SubmitRunResponse,
} from "./core/types";
import { getAuthToken, proxyBase } from "./discord";

/** Le scoreboard affiché provient maintenant du backend autoritaire. */
export const AUTHORITATIVE_BACKEND = true;

/** Erreur HTTP taguée du status : distingue un 401 (token expiré) d'une panne réseau. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

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
  if (!res.ok) throw new HttpError(res.status, `POST /api/runs → ${res.status}`);
  return res.json();
}

/** Historique du joueur (GET /api/history), du plus récent au plus ancien. */
export async function fetchHistory(mode?: string): Promise<HistoryResponse> {
  const token = await getAuthToken();
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  const res = await fetch(`${proxyBase()}/api/history${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/history → ${res.status}`);
  return res.json();
}

/** Un Run complet pour le Replay (GET /api/runs/:id). 404 si non rejouable. */
export async function fetchRun(runId: string): Promise<RunDetailResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/runs/${runId} → ${res.status}`);
  return res.json();
}

/** Weak spots agrégés sur les derniers Runs (GET /api/profile/analysis). */
export async function fetchProfileAnalysis(): Promise<AnalysisResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/profile/analysis`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/profile/analysis → ${res.status}`);
  return res.json();
}

/** Weak spots d'un Run (GET /api/runs/:id/analysis). */
export async function fetchAnalysis(runId: string): Promise<AnalysisResponse> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/runs/${encodeURIComponent(runId)}/analysis`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/runs/${runId}/analysis → ${res.status}`);
  return res.json();
}

/** Progression « Apprendre » du joueur (GET /api/learn/progress). */
export async function fetchLearnProgress(): Promise<LearnProgress> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/learn/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /api/learn/progress → ${res.status}`);
  return res.json();
}

/** Enregistre une progression « Apprendre » (POST — le serveur garde le MAX). */
export async function submitLearnProgress(completed: number): Promise<LearnProgress> {
  const token = await getAuthToken();
  const res = await fetch(`${proxyBase()}/api/learn/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ completed }),
  });
  if (!res.ok) throw new Error(`POST /api/learn/progress → ${res.status}`);
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
