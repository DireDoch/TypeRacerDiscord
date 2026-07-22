// =============================================================================
//  ui/results.ts — écran de résultats : scoreboard autoritaire + graphe par seconde.
//
//  N'affiche QUE le Scoreboard renvoyé par api.submitRun (recompute, pas les Live
//  stats — décision CONTEXT.md). Le graphe re-trace la série `perSecond` telle quelle.
// =============================================================================

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";
import type { AnalysisResponse, PerSecondPoint, SubmitRunResponse } from "../core/types";
import { AUTHORITATIVE_BACKEND, fetchAnalysis, isIdentityError, IDENTITY_ERROR_MESSAGE } from "../api";
import { escapeText } from "./typing-zone";
import { analysisHtml } from "./weak-spots";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
);

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

  const attribution = quote
    ? `<p class="quote-author">— ${escapeText(quote.author)}${
        quote.wikipediaUrl
          ? ` · <a href="${escapeText(quote.wikipediaUrl)}" target="_blank" rel="noopener noreferrer">en savoir plus</a>`
          : ""
      }</p>`
    : "";

  root.innerHTML = `
    <section class="results">
      <div class="headline">
        <div class="big-stat">
          <span class="label">wpm</span>
          <span class="value">${sb.wpm}</span>
        </div>
        <div class="big-stat">
          <span class="label">acc</span>
          <span class="value">${sb.accuracy}%</span>
        </div>
      </div>

      ${attribution}

      <div class="chart-wrap"><canvas id="resultChart"></canvas></div>

      <div class="sub-stats">
        <div><span class="label">raw</span><span class="value">${sb.raw}</span></div>
        <div><span class="label">characters</span><span class="value">${c.correct}/${c.incorrect}/${c.extra}/${c.missed}</span></div>
        <div><span class="label">duration</span><span class="value">${(sb.durationMs / 1000).toFixed(1)}s</span></div>
        <div><span class="label">pb</span><span class="value">${pbLabel(res)}</span></div>
      </div>

      ${AUTHORITATIVE_BACKEND ? "" : `<p class="notice">⚠️ Scoreboard recalculé en local (backend autoritaire non branché — pas d'anti-triche ni de PB persistés).</p>`}

      <div class="analysis" id="analysis"></div>

      <button id="restart" class="primary">Rejouer (Tab / Entrée)</button>
      ${onReplay ? `<button id="replayBtn">Replay</button>` : ""}
      <button id="analyzeBtn">Analyser</button>
    </section>
  `;

  drawChart(root.querySelector<HTMLCanvasElement>("#resultChart")!, sb.perSecond);
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
    el.innerHTML = `<p class="hint">${isIdentityError(e) ? IDENTITY_ERROR_MESSAGE : "Analyse indisponible pour ce Run."}</p>`;
    return;
  }
  if (!root.querySelector("#analysis")) return; // écran quitté pendant le fetch
  el.innerHTML = analysisHtml(a, "sur cette course");
}

function pbLabel(res: SubmitRunResponse): string {
  if (!res.scoreboard.pbEligible) return "non éligible";
  if (res.isPersonalBest) return "★ nouveau !";
  return res.previousPbWpm !== null ? `${res.previousPbWpm}` : "—";
}

/** Exporté pour le podium de Race (ADR 0010) : même graphe, autre source de données. */
export function drawChart(canvas: HTMLCanvasElement, perSecond: PerSecondPoint[]): void {
  const labels = perSecond.map((p) => p.t);
  new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "wpm",
          data: perSecond.map((p) => p.wpm),
          // ponytail: hex en dur — chart.js ne lit pas les variables CSS, et la
          // décision 13 le remplace par un SVG maison à l'étape 5. Palette du :root.
          borderColor: "#ff7a59",
          backgroundColor: "#ff7a59",
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "raw",
          data: perSecond.map((p) => p.raw),
          borderColor: "#6b7689",
          backgroundColor: "#6b7689",
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "errors",
          data: perSecond.map((p) => (p.errors > 0 ? p.errors : null)),
          borderColor: "#ff4d6d",
          backgroundColor: "#ff4d6d",
          showLine: false,
          pointRadius: 4,
          pointStyle: "crossRot",
          yAxisID: "yErr",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { title: { display: true, text: "secondes" }, grid: { color: "#1b2230" } },
        y: { type: "linear", position: "left", beginAtZero: true, grid: { color: "#1b2230" } },
        yErr: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 1 },
        },
      },
      plugins: { legend: { labels: { color: "#e8ecf4" } } },
    },
  });
}
