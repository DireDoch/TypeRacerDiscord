// =============================================================================
//  ui/results.ts — écran de résultats : scoreboard autoritaire + graphe par seconde.
//
//  N'affiche QUE le Scoreboard renvoyé par api.submitRun (recompute, pas les Live
//  stats — décision CONTEXT.md). Le graphe re-trace la série `perSecond` telle quelle.
// =============================================================================

import type { AnalysisResponse, SubmitRunResponse } from "../core/types";
import { AUTHORITATIVE_BACKEND, fetchAnalysis, sharedErrorMessage } from "../api";
import { loadPreferences } from "../core/preferences";
import { roundSpeed, SPEED_UNIT_LABELS, type SpeedUnit } from "../core/speed-unit";
import { escapeText } from "./typing-zone";
import { analysisHtml } from "./weak-spots";
import { drawChart } from "./chart";

/** Attribution d'une Quote (Mode Quotes uniquement) affichée sous le scoreboard. */
export interface QuoteAttribution {
  author: string;
  wikipediaUrl: string;
}

export function renderResults(
  root: HTMLElement,
  res: SubmitRunResponse,
  onRestart: () => void,
  quote?: QuoteAttribution,
  onReplay?: () => void,
): void {
  const sb = res.scoreboard;
  const c = sb.characters;
  const unit = loadPreferences().speedUnit; // issue #69 : même unité partout où le WPM s'affiche
  const unitLabel = SPEED_UNIT_LABELS[unit];
  const isPb = res.isPersonalBest && sb.pbEligible;

  const attribution = quote
    ? `<p class="quote-author">— ${escapeText(quote.author)}${
        quote.wikipediaUrl
          ? ` · <a href="${escapeText(quote.wikipediaUrl)}" target="_blank" rel="noopener noreferrer">en savoir plus</a>`
          : ""
      }</p>`
    : "";

  root.innerHTML = `
    <section class="results">
      <div class="headline${isPb ? " is-pb" : ""}">
        ${recordBanner(res, unit)}
        <div class="hero">
          <span class="hero-value">${roundSpeed(sb.wpm, unit)}</span>
          <span class="hero-unit">${unitLabel}</span>
        </div>
        <div class="hero-acc">
          <span class="hero-acc-value">${sb.accuracy} %</span>
          <span class="hero-acc-label">précision</span>
        </div>
      </div>

      ${attribution}

      <div class="chart-wrap" id="resultChart"></div>

      <div class="sub-stats">
        <div><span class="label">raw (${unitLabel})</span><span class="value">${roundSpeed(sb.raw, unit)}</span></div>
        <div><span class="label">durée</span><span class="value">${(sb.durationMs / 1000).toFixed(1)} s</span></div>
        <div><span class="label">caractères</span><span class="value">${c.correct}/${c.incorrect}/${c.extra}/${c.missed}</span></div>
        ${isPb ? "" : `<div><span class="label">record</span><span class="value">${pbLabel(res, unit)}</span></div>`}
      </div>

      ${AUTHORITATIVE_BACKEND ? "" : `<p class="notice">⚠️ Scoreboard recalculé en local (backend autoritaire non branché — pas d'anti-triche ni de PB persistés).</p>`}

      <div class="analysis" id="analysis"></div>

      <div class="results-actions">
        <button id="restart" class="primary">Recommencer</button>
        ${onReplay ? `<button id="replayBtn" class="secondary">Replay</button>` : ""}
        <button id="analyzeBtn" class="secondary">Analyser</button>
      </div>
    </section>
  `;

  drawChart(root.querySelector<HTMLElement>("#resultChart")!, sb.perSecond);
  root.querySelector<HTMLButtonElement>("#restart")!.addEventListener("click", onRestart);
  if (onReplay) root.querySelector<HTMLButtonElement>("#replayBtn")!.addEventListener("click", onReplay);
  root.querySelector<HTMLButtonElement>("#analyzeBtn")!.addEventListener("click", () => {
    void analyze(root, res.runId);
  });
}

/** Charge et affiche les Weak spots du Run dans la zone #analysis. */
async function analyze(root: HTMLElement, runId: string): Promise<void> {
  const el = root.querySelector<HTMLElement>("#analysis");
  if (!el) return;
  el.innerHTML = `<p class="hint">Analyse en cours…</p>`;
  let a: AnalysisResponse;
  try {
    a = await fetchAnalysis(runId);
  } catch (e) {
    el.innerHTML = `<p class="hint">${sharedErrorMessage(e) ?? "Analyse indisponible pour ce Run."}</p>`;
    return;
  }
  if (!root.querySelector("#analysis")) return; // écran quitté pendant le fetch
  el.innerHTML = analysisHtml(a, "sur cette course");
}

/**
 * Le record, quand il n'est PAS tombé : une sous-stat parmi les autres, c'est sa
 * place. Quand il tombe, c'est `recordBanner` qui prend le relais et cette
 * cellule disparaît — le chiffre ne se dit pas deux fois sur le même écran.
 */
function pbLabel(res: SubmitRunResponse, unit: SpeedUnit): string {
  if (!res.scoreboard.pbEligible) return "hors record";
  // `roundSpeed` ici aussi : le record se lisait en wpm brut à côté d'un WPM converti
  // (issue #69 — même unité PARTOUT où une vitesse s'affiche).
  return res.previousPbWpm !== null ? `${roundSpeed(res.previousPbWpm, unit)}` : "—";
}

/**
 * L'arrivée d'un record (#194). Avant, elle tenait dans « ★ nouveau ! » à 1,3 rem,
 * quatrième d'une rangée de quatre stats de même poids : rien ne disait qu'on venait
 * d'accomplir quelque chose. Le bandeau annonce l'événement et nomme le chiffre
 * battu — la seule information que le gros WPM ne porte pas déjà.
 */
function recordBanner(res: SubmitRunResponse, unit: SpeedUnit): string {
  if (!res.isPersonalBest || !res.scoreboard.pbEligible) return "";
  const previous =
    res.previousPbWpm !== null
      ? ` · ancien record ${roundSpeed(res.previousPbWpm, unit)}`
      : " · le premier de cette config";
  return `<p class="pb-flag">★ Nouveau record${previous}</p>`;
}
