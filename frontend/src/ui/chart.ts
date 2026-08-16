// =============================================================================
//  ui/chart.ts — le graphe seconde par seconde, en SVG maison.
//
//  REFONTE-VISUELLE décision 13 : une polyligne aux couleurs de la palette
//  remplace `chart.js`. Deux conséquences concrètes, pas seulement esthétiques :
//
//  1. Les couleurs cessent d'être des hex recopiés. chart.js peint sur un canvas
//     et ne lit pas les variables CSS ; un SVG porte des classes, et `style.css`
//     leur donne `var(--main)` / `var(--error)`. La palette redevient une seule
//     source (décision 4).
//  2. Les fautes quittent leur axe Y de droite. Elles se posent SUR la courbe wpm,
//     à la seconde où elles sont arrivées — c'est là qu'on les lit, et le second
//     axe disparaît avec son échelle à part.
//
//  Le survol (#177) devient un trait et un texte, au lieu d'un plugin canvas.
// =============================================================================

import type { PerSecondPoint } from "../core/types";

/** Marges du tracé : la gauche porte les valeurs de l'axe Y, le bas les secondes. */
const PAD = { l: 38, r: 12, t: 14, b: 24 };

export interface ChartGeometry {
  /** x de chaque point, dans l'ordre de `perSecond` — sert au survol comme au tracé. */
  xs: number[];
  /** Polyligne wpm, et la même refermée sur la ligne de base pour l'aire corail. */
  wpmPath: string;
  areaPath: string;
  rawPath: string;
  /** Une par seconde AVEC au moins une faute, posée sur la courbe wpm. */
  dots: { x: number; y: number }[];
  /** Graduations de l'axe Y : 0, la moitié, le plafond. */
  ticks: { value: number; y: number }[];
  /** Graduations de l'axe X : le départ, le milieu, la durée exacte. */
  xTicks: { label: string; x: number }[];
  /** Bornes du tracé, pour la grille et le trait de survol. */
  left: number;
  right: number;
  top: number;
  baseline: number;
}

/** Plafond de l'axe Y : le multiple de 10 juste au-dessus du maximum lu, jamais moins de 10. */
export function niceMax(max: number): number {
  return Math.max(10, Math.ceil(max / 10) * 10);
}

/**
 * Toute la géométrie du graphe, en pixels, sans toucher au DOM — c'est la partie
 * qui se teste. Le rendu n'est plus qu'une mise en balises de ce qu'elle renvoie.
 */
export function chartGeometry(points: PerSecondPoint[], w: number, h: number): ChartGeometry {
  const plotW = Math.max(1, w - PAD.l - PAD.r);
  const plotH = Math.max(1, h - PAD.t - PAD.b);
  const baseline = PAD.t + plotH;
  const t0 = points[0]?.t ?? 0;
  // `|| 1` : un Run d'une seule seconde n'a pas d'étendue — tout se pose à gauche
  // plutôt que de diviser par zéro.
  const span = (points[points.length - 1]?.t ?? t0) - t0 || 1;
  const yMax = niceMax(Math.max(...points.map((p) => Math.max(p.wpm, p.raw)), 0));

  const xs = points.map((p) => PAD.l + ((p.t - t0) / span) * plotW);
  const yOf = (v: number) => baseline - (Math.min(v, yMax) / yMax) * plotH;

  const line = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");

  const wpmPath = line(points.map((p) => p.wpm));

  return {
    xs,
    wpmPath,
    // L'aire retombe sur la ligne de base aux deux bouts : le remplissage épouse la
    // courbe sans jamais déborder sous l'axe.
    areaPath: points.length < 2 ? "" : `${wpmPath} L${xs[xs.length - 1].toFixed(1)},${baseline} L${xs[0].toFixed(1)},${baseline} Z`,
    rawPath: line(points.map((p) => p.raw)),
    dots: points
      .map((p, i) => ({ x: xs[i], y: yOf(p.wpm), errors: p.errors }))
      .filter((d) => d.errors > 0)
      .map(({ x, y }) => ({ x, y })),
    ticks: [0, yMax / 2, yMax].map((value) => ({ value, y: yOf(value) })),
    xTicks: [0, 0.5, 1].map((f) => {
      const t = t0 + f * span;
      return { label: `${Math.round(t)} s`, x: PAD.l + f * plotW };
    }),
    left: PAD.l,
    right: PAD.l + plotW,
    top: PAD.t,
    baseline,
  };
}

/** Le texte du survol : la seconde lue, puis ses trois valeurs. Aussi la valeur par
 *  défaut, sur le dernier point — un graphe au repos dit déjà quelque chose. */
export function readoutText(p: PerSecondPoint): string {
  const faults = p.errors === 1 ? "1 faute" : `${p.errors} fautes`;
  return `${p.t.toFixed(p.t % 1 === 0 ? 0 : 1)} s · ${p.wpm} wpm · ${p.raw} raw · ${faults}`;
}

/** Index du point le plus proche d'une abscisse — le survol se cale sur une seconde,
 *  jamais entre deux. */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  }
  return best;
}

/** Un dégradé SVG se référence par id : deux graphes montés en même temps (podium,
 *  puis résultats) ne doivent pas pointer sur le même. */
let gradientSeq = 0;

/**
 * Monte le graphe dans `host` (l'ancien `.chart-wrap`, qui portait un `<canvas>`).
 * Partagé par l'écran de résultats solo et le podium multijoueur (ADR 0010).
 */
export function drawChart(host: HTMLElement, perSecond: PerSecondPoint[]): void {
  const gradientId = `chart-area-${++gradientSeq}`;
  host.classList.add("chart");
  if (perSecond.length === 0) {
    host.innerHTML = `<p class="hint">Pas de série pour ce Run.</p>`;
    return;
  }

  host.innerHTML = `
    <div class="chart-legend">
      <span class="chart-key key-wpm">wpm</span>
      <span class="chart-key key-raw">raw</span>
      <span class="chart-key key-err">fautes</span>
      <output class="chart-readout"></output>
    </div>
    <svg class="chart-svg" tabindex="0" role="img"
      aria-label="Vitesse seconde par seconde. ${readoutText(perSecond[perSecond.length - 1])} en fin de Run."></svg>
  `;
  const svg = host.querySelector<SVGSVGElement>(".chart-svg")!;
  const readout = host.querySelector<HTMLOutputElement>(".chart-readout")!;

  let geom: ChartGeometry | null = null;
  let cursor: number | null = null;

  const paint = () => {
    if (!geom) return;
    const cross =
      cursor === null
        ? ""
        : `<line class="chart-cross" x1="${geom.xs[cursor]}" y1="${geom.top}" x2="${geom.xs[cursor]}" y2="${geom.baseline}" />`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop class="chart-area-top" offset="0" />
          <stop class="chart-area-bottom" offset="1" />
        </linearGradient>
      </defs>
      ${geom.ticks
        .map(
          (t) => `<line class="chart-grid" x1="${geom!.left}" y1="${t.y}" x2="${geom!.right}" y2="${t.y}" />
                  <text class="chart-tick" x="${geom!.left - 6}" y="${t.y + 4}" text-anchor="end">${Math.round(t.value)}</text>`,
        )
        .join("")}
      <path class="chart-area" fill="url(#${gradientId})" d="${geom.areaPath}" />
      <path class="chart-raw" d="${geom.rawPath}" />
      <path class="chart-wpm" d="${geom.wpmPath}" />
      ${geom.dots.map((d) => `<circle class="chart-dot" cx="${d.x}" cy="${d.y}" r="3.5" />`).join("")}
      ${cross}
      ${geom.xTicks
        .map(
          (t, i) =>
            `<text class="chart-tick" x="${t.x}" y="${geom!.baseline + 18}" text-anchor="${i === 0 ? "start" : i === 1 ? "middle" : "end"}">${t.label}</text>`,
        )
        .join("")}
    `;
    readout.textContent = readoutText(perSecond[cursor ?? perSecond.length - 1]);
  };

  const moveTo = (i: number) => {
    cursor = Math.max(0, Math.min(perSecond.length - 1, i));
    paint();
  };

  svg.addEventListener("pointermove", (e) => {
    if (!geom) return;
    moveTo(nearestIndex(geom.xs, e.offsetX));
  });
  svg.addEventListener("pointerleave", () => {
    cursor = null;
    paint();
  });
  // Lire une seconde précise au clavier : le survol seul laissait la série
  // inaccessible sans souris.
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    moveTo((cursor ?? perSecond.length - 1) + (e.key === "ArrowRight" ? 1 : -1));
  });

  // Le graphe se redessine à sa taille réelle plutôt que de s'étirer : un cercle de
  // faute reste un cercle, et le texte des graduations garde sa taille.
  const ro = new ResizeObserver(([entry]) => {
    if (!svg.isConnected) return ro.disconnect(); // écran quitté : rien à observer.
    const { width, height } = entry.contentRect;
    if (width < 1 || height < 1) return;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    geom = chartGeometry(perSecond, width, height);
    if (cursor !== null) cursor = Math.min(cursor, perSecond.length - 1);
    paint();
  });
  ro.observe(svg);
}
