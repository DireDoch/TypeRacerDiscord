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
//
//  Toutes les requêtes passent par `request()` : préfixe `/.proxy` (CSP Discord) et
//  Bearer token appliqués une seule fois, un nouvel endpoint ne peut pas les oublier.
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

/** Réponse HTTP non-2xx, taguée du status (distingue un 401 d'un 500/502). */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** getAuthToken() a échoué : pas de handshake Discord valide (pas encore un 401 serveur). */
export class IdentityError extends Error {}

/** fetch() a rejeté avant réponse : hors ligne, backend injoignable. */
export class NetworkError extends Error {}

/** true si l'échec vient de l'identité (à reprendre depuis Discord), pas du service. */
export function isIdentityError(e: unknown): boolean {
  return e instanceof IdentityError || (e instanceof HttpError && e.status === 401);
}

/** Message générique pour un échec d'identité, partagé par tous les écrans. */
export const IDENTITY_ERROR_MESSAGE = "Identité Discord perdue — reviens depuis Discord pour te reconnecter.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token: string;
  try {
    token = await getAuthToken();
  } catch (e) {
    throw new IdentityError(e instanceof Error ? e.message : String(e));
  }

  let res: Response;
  try {
    res = await fetch(`${proxyBase()}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new HttpError(res.status, `${init?.method ?? "GET"} ${path} → ${res.status}`);
  return res.json();
}

/** Soumet un Run et renvoie le scoreboard autoritaire + verdict PB (POST /api/runs). */
export function submitRun(req: SubmitRunRequest): Promise<SubmitRunResponse> {
  return request<SubmitRunResponse>("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/** Historique du joueur (GET /api/history), du plus récent au plus ancien. */
export function fetchHistory(mode?: string): Promise<HistoryResponse> {
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return request<HistoryResponse>(`/api/history${qs}`);
}

/** Un Run complet pour le Replay (GET /api/runs/:id). 404 si non rejouable. */
export function fetchRun(runId: string): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(`/api/runs/${encodeURIComponent(runId)}`);
}

/** Weak spots agrégés sur les derniers Runs (GET /api/profile/analysis). */
export function fetchProfileAnalysis(): Promise<AnalysisResponse> {
  return request<AnalysisResponse>("/api/profile/analysis");
}

/** Weak spots d'un Run (GET /api/runs/:id/analysis). */
export function fetchAnalysis(runId: string): Promise<AnalysisResponse> {
  return request<AnalysisResponse>(`/api/runs/${encodeURIComponent(runId)}/analysis`);
}

/** Progression « Apprendre » du joueur (GET /api/learn/progress). */
export function fetchLearnProgress(): Promise<LearnProgress> {
  return request<LearnProgress>("/api/learn/progress");
}

/** Enregistre une progression « Apprendre » (POST — le serveur garde le MAX). */
export function submitLearnProgress(completed: number): Promise<LearnProgress> {
  return request<LearnProgress>("/api/learn/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  });
}

/** Récupère une Quote pour un Run en Mode Quotes (proxy serveur API-Ninjas). */
export function fetchQuote(): Promise<Quote> {
  return request<Quote>("/api/quote");
}
