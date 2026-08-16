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
  type Plugin,
} from "chart.js";
import type { AnalysisResponse, PerSecondPoint, SubmitRunResponse } from "../core/types";
import { AUTHORITATIVE_BACKEND, fetchAnalysis, sharedErrorMessage } from "../api";
import { loadPreferences } from "../core/preferences";
import { roundSpeed, SPEED_UNIT_LABELS } from "../core/speed-unit";
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
  const unit = loadPreferences().speedUnit; // issue #69 : même unité partout où le WPM s'affiche
  const unitLabel = SPEED_UNIT_LABELS[unit];

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
          <span class="label">${unitLabel}</span>
          <span class="value">${roundSpeed(sb.wpm, unit)}</span>
        </div>
        <div class="big-stat">
          <span class="label">acc</span>
          <span class="value">${sb.accuracy}%</span>
        </div>
      </div>

      ${attribution}

      <div class="chart-wrap"><canvas id="resultChart"></canvas></div>

      <div class="sub-stats">
        <div><span class="label">raw (${unitLabel})</span><span class="value">${roundSpeed(sb.raw, unit)}</span></div>
        <div><span class="label">characters</span><span class="value">${c.correct}/${c.incorrect}/${c.extra}/${c.missed}</span></div>
        <div><span class="label">duration</span><span class="value">${(sb.durationMs / 1000).toFixed(1)}s</span></div>
        <div><span class="label">pb</span><span class="value">${pbLabel(res)}</span></div>
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
    el.innerHTML = `<p class="hint">${sharedErrorMessage(e) ?? "Analyse indisponible pour ce Run."}</p>`;
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

/**
 * Ligne verticale sous le curseur (#177). Lire wpm / raw / errors à un instant donné
 * demandait de viser une courbe au pixel ; la ligne rend explicite la seconde que
 * l'infobulle est en train de décrire.
 *
 * `interaction: { mode: "index", intersect: false }` était déjà posé — il ne manquait
 * que le tracé. Un plugin local de dix lignes, pas une dépendance de plus, et il est
 * passé PAR GRAPHE (`plugins: [crosshair]`) plutôt que par `Chart.register` : rien
 * d'autre dans l'app ne doit hériter d'un dessin sur son canvas.
 *
 * `afterDatasetsDraw` : la ligne se pose sur les courbes, jamais dessous.
 */
const crosshair: Plugin<"line"> = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (active.length === 0) return;
    const { x } = active[0].element;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(232, 236, 244, 0.35)"; // --text à 35 %, comme les hex des courbes
    ctx.stroke();
    ctx.restore();
  },
};

/** Exporté pour le podium de Race (ADR 0010) : même graphe, autre source de données —
 *  donc la ligne de survol arrive gratuitement sur le podium multijoueur aussi. */
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
          // La donnée porte le vrai compte, y compris 0 (#177). Avant, un 0 devenait
          // `null` pour effacer la croix — mais chart.js saute les `null` en mode
          // `index`, donc l'infobulle N'AFFICHAIT PAS la ligne « errors » sur les
          // secondes sans faute, exactement celles où on veut lire « 0 ». C'est
          // `pointRadius` qui cache la croix maintenant : l'affichage change, la
          // donnée reste.
          data: perSecond.map((p) => p.errors),
          borderColor: "#ff4d6d",
          backgroundColor: "#ff4d6d",
          showLine: false,
          pointRadius: (ctx) => ((perSecond[ctx.dataIndex]?.errors ?? 0) > 0 ? 4 : 0),
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
    plugins: [crosshair],
  });
}
