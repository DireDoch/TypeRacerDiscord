// =============================================================================
//  main.ts — bootstrap de l'app frontend (point d'entrée Vite).
//
//  MVP : monte l'écran de Practice. L'identité Discord (Embedded App SDK) est amorcée
//  en amont du montage — le handshake OAuth se fait en arrière-plan pendant que le
//  joueur configure/tape ; le token est prêt (mémoïsé) au moment du POST /api/runs.
// =============================================================================

import "./style.css";
import { Practice } from "./ui/practice";
import { Race } from "./ui/race";
import { getAuthToken } from "./discord";

// Amorce le handshake d'identité tôt (non bloquant). En cas d'échec, on log et on
// laisse submitRun ré-essayer/surfacer l'erreur au moment de la soumission.
getAuthToken().catch((e) => console.error("Auth Discord échouée :", e));

const rootEl = document.querySelector<HTMLDivElement>("#app");
if (!rootEl) throw new Error("#app introuvable dans index.html");
const root: HTMLElement = rootEl;

// Navigation Practice ↔ Race : dans l'iframe Discord l'URL est figée par le mapping,
// la bascule se fait donc PAR BOUTONS (race ⚔ / ← practice), avec démontage propre
// de l'écran quitté. `?race` reste le raccourci de dev (deux onglets au navigateur).
let screen: { destroy(): void } | null = null;

function showPractice(): void {
  screen?.destroy();
  const p = new Practice(root, showRace);
  screen = p;
  p.mount();
}

function showRace(): void {
  screen?.destroy();
  const r = new Race(root, showPractice);
  screen = r;
  void r.mount();
}

if (new URLSearchParams(location.search).has("race")) {
  showRace();
} else {
  showPractice();
}
