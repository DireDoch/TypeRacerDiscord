// =============================================================================
//  ui/weak-spots.ts — rendu partagé d'une AnalysisResponse (Weak spots).
//
//  Sorti de results.ts (issue #21) : results.ts importe chart.js (graphe par
//  seconde) et history.ts n'en a pas besoin pour son profil « Mes faiblesses »
//  — le laisser dans results.ts aurait chargé chart.js rien qu'en ouvrant
//  l'Historique, exactement le genre de couplage transitif que #21 corrige.
// =============================================================================

import type { AnalysisResponse, WeakSpot } from "../core/types";
import { escapeText } from "./typing-zone";

/** Rendu partagé (Résultats et profil « Mes faiblesses ») d'une AnalysisResponse. */
export function analysisHtml(a: AnalysisResponse, scope: string): string {
  if (a.weakSpots.length === 0) {
    return `<p class="hint">Aucun Weak spot significatif ${scope} — rien ne sort de ta moyenne (ou pas assez d'occurrences pour trancher).</p>`;
  }
  const items = a.weakSpots
    .slice(0, 10)
    .map((w) => `<li>${weakSpotHtml(w)}</li>`)
    .join("");
  return `
    <p class="hint">Tes points faibles ${scope} (vs ta moyenne : ${a.globalMeanDelayMs} ms/frappe, ${(a.globalErrorRate * 100).toFixed(1)} % d'erreurs) :</p>
    <ul class="weak-spots">${items}</ul>
  `;
}

function weakSpotHtml(w: WeakSpot): string {
  const tags = [
    w.slow ? `lent · ${w.meanDelayMs} ms` : "",
    w.faulty ? `${(w.errorRate * 100).toFixed(0)} % d'erreurs` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const kind = w.kind === "trigram" ? "triplet" : w.kind === "bigram" ? "paire" : "touche";
  return `<span class="chars">${escapeText(w.chars)}</span> <span class="detail">${kind} · ${w.occurrences}× · ${tags}</span>`;
}
