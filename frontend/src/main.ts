// =============================================================================
//  main.ts — bootstrap de l'app frontend (point d'entrée Vite).
//
//  Écran d'arrivée : Menu (Solo / Multijoueur / Options / Quitter). Navigation par
//  boutons avec démontage propre (dans l'iframe Discord l'URL est figée par le
//  mapping). `?race` reste le raccourci de dev (deux onglets au navigateur).
//  L'identité Discord (Embedded App SDK) est amorcée en amont — le handshake OAuth
//  se fait en arrière-plan ; le token est prêt (mémoïsé) au moment des appels /api.
// =============================================================================

import "./style.css";
import { Menu } from "./ui/menu";
import { Practice } from "./ui/practice";
import { Race } from "./ui/race";
import { getAuthToken } from "./discord";

// --- Bandeau d'erreurs (debug in-iframe) -------------------------------------
// Dans Discord la console est invisible : toute erreur JS ou promesse rejetée
// (fetch bloqué, WS refusé, handshake échoué…) s'affiche dans un bandeau cliquable.
function showError(msg: string): void {
  let el = document.querySelector<HTMLElement>("#errbar");
  if (!el) {
    el = document.createElement("div");
    el.id = "errbar";
    el.title = "clic pour fermer";
    el.addEventListener("click", () => el?.remove());
    document.body.appendChild(el);
  }
  el.textContent = `⚠ ${msg}`;
}
window.addEventListener("error", (e) => showError(e.message));
window.addEventListener("unhandledrejection", (e) => showError(String(e.reason)));

// Amorce le handshake d'identité tôt (non bloquant).
getAuthToken().catch((e) => showError(`Auth Discord échouée : ${e}`));

const rootEl = document.querySelector<HTMLDivElement>("#app");
if (!rootEl) throw new Error("#app introuvable dans index.html");
const root: HTMLElement = rootEl;

let screen: { destroy(): void } | null = null;

function showMenu(): void {
  screen?.destroy();
  const m = new Menu(root, { solo: showPractice, multi: showRace });
  screen = m;
  m.mount();
}

function showPractice(): void {
  screen?.destroy();
  const p = new Practice(root, showMenu);
  screen = p;
  p.mount();
}

function showRace(): void {
  screen?.destroy();
  const r = new Race(root, showMenu);
  screen = r;
  void r.mount();
}

if (new URLSearchParams(location.search).has("race")) {
  showRace();
} else {
  showMenu();
}
