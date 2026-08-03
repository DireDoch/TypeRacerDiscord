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
import { Race, type RaceIntent } from "./ui/race";
import { History } from "./ui/history";
import { Learn } from "./ui/learn";
import { Settings } from "./ui/settings";
import { applyPreferences } from "./core/preferences";
import { fitToViewport, mountIdentityBadge } from "./ui/chrome";
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

// Preferences appliquées AVANT le premier écran : la police choisie doit être en
// place au premier rendu, pas après un clignotement.
applyPreferences();

// Les écrans se montent dans #screen (hauteur libre) ; #app est le cadre clippé à la
// fenêtre qui le met à l'échelle. Le badge d'identité, lui, est posé sur <body>.
const appEl = document.querySelector<HTMLDivElement>("#app");
const rootEl = document.querySelector<HTMLDivElement>("#screen");
if (!appEl || !rootEl) throw new Error("#app / #screen introuvables dans index.html");
const root: HTMLElement = rootEl;

fitToViewport(appEl, rootEl);
void mountIdentityBadge().catch((e) => showError(`Badge d'identité : ${e}`));

let screen: { destroy(): void } | null = null;

function showMenu(): void {
  screen?.destroy();
  const m = new Menu(root, {
    solo: showPractice,
    multi: showRace,
    history: showHistory,
    learn: showLearn,
    settings: showSettings,
  });
  screen = m;
  m.mount();
}

function showSettings(): void {
  screen?.destroy();
  const s = new Settings(root, showMenu);
  screen = s;
  s.mount();
}

function showLearn(): void {
  screen?.destroy();
  const l = new Learn(root, showMenu);
  screen = l;
  l.mount();
}

function showHistory(): void {
  screen?.destroy();
  const h = new History(root, showMenu);
  screen = h;
  h.mount();
}

function showPractice(): void {
  screen?.destroy();
  const p = new Practice(root, showMenu);
  screen = p;
  p.mount();
}

function showRace(intent: RaceIntent = { kind: "channel" }): void {
  screen?.destroy();
  const r = new Race(root, showMenu, intent);
  screen = r;
  void r.mount();
}

// `?race` = raccourci dev (deux onglets au navigateur) : toujours la Room du salon,
// c'est le seul chemin qui ne demande rien à saisir.
if (new URLSearchParams(location.search).has("race")) {
  showRace();
} else {
  showMenu();
}
