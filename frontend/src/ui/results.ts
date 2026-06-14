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
import type { SubmitRunResponse } from "../core/types";
import { AUTHORITATIVE_BACKEND } from "../api";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
);

export function renderResults(
  root: HTMLElement,
  res: SubmitRunResponse,
  onRestart: () => void,
): void {
  const sb = res.scoreboard;
  const c = sb.characters;

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

      <div class="chart-wrap"><canvas id="resultChart"></canvas></div>

      <div class="sub-stats">
        <div><span class="label">raw</span><span class="value">${sb.raw}</span></div>
        <div><span class="label">characters</span><span class="value">${c.correct}/${c.incorrect}/${c.extra}/${c.missed}</span></div>
        <div><span class="label">duration</span><span class="value">${(sb.durationMs / 1000).toFixed(1)}s</span></div>
        <div><span class="label">pb</span><span class="value">${pbLabel(res)}</span></div>
      </div>

      ${AUTHORITATIVE_BACKEND ? "" : `<p class="notice">⚠️ Scoreboard recalculé en local (backend autoritaire non branché — pas d'anti-triche ni de PB persistés).</p>`}

      <button id="restart" class="primary">Rejouer (Tab / Entrée)</button>
    </section>
  `;

  drawChart(root.querySelector<HTMLCanvasElement>("#resultChart")!, sb.perSecond);
  root.querySelector<HTMLButtonElement>("#restart")!.addEventListener("click", onRestart);
}

function pbLabel(res: SubmitRunResponse): string {
  if (!res.scoreboard.pbEligible) return "non éligible";
  if (res.isPersonalBest) return "★ nouveau !";
  return res.previousPbWpm !== null ? `${res.previousPbWpm}` : "—";
}

function drawChart(
  canvas: HTMLCanvasElement,
  perSecond: SubmitRunResponse["scoreboard"]["perSecond"],
): void {
  const labels = perSecond.map((p) => p.t);
  new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "wpm",
          data: perSecond.map((p) => p.wpm),
          borderColor: "#e2b714",
          backgroundColor: "#e2b714",
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "raw",
          data: perSecond.map((p) => p.raw),
          borderColor: "#646669",
          backgroundColor: "#646669",
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "errors",
          data: perSecond.map((p) => (p.errors > 0 ? p.errors : null)),
          borderColor: "#ca4754",
          backgroundColor: "#ca4754",
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
        x: { title: { display: true, text: "seconds" }, grid: { color: "#2c2e31" } },
        y: { type: "linear", position: "left", beginAtZero: true, grid: { color: "#2c2e31" } },
        yErr: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 1 },
        },
      },
      plugins: { legend: { labels: { color: "#d1d0c5" } } },
    },
  });
}
