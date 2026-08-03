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
const app: HTMLElement = appEl;

fitToViewport(app, root);
void mountIdentityBadge().catch((e) => showError(`Badge d'identité : ${e}`));

let screen: { destroy(): void } | null = null;

/**
 * Bascule d'écran : démonte le précédent, monte le suivant, et remet le défilement en
 * haut. Cette remise à zéro compte depuis #91 : `#app` est devenu le seul conteneur qui
 * défile, et aucune scrollbar n'y est peinte. Sans elle, quitter un écran long (les
 * Paramètres) pour un autre écran long (Apprendre) fait arriver au milieu de la liste,
 * sans le moindre indice qu'il y a du contenu au-dessus.
 */
function swap<T extends { destroy(): void; mount(): unknown }>(make: () => T): void {
  screen?.destroy();
  const next = make();
  screen = next;
  app.scrollTop = 0;
  void next.mount();
}

function showMenu(): void {
  swap(
    () =>
      new Menu(root, {
        solo: showPractice,
        multi: showRace,
        history: showHistory,
        learn: showLearn,
        settings: showSettings,
      }),
  );
}

function showSettings(): void {
  swap(() => new Settings(root, showMenu));
}

function showLearn(): void {
  swap(() => new Learn(root, showMenu));
}

function showHistory(): void {
  swap(() => new History(root, showMenu));
}

function showPractice(): void {
  swap(() => new Practice(root, showMenu));
}

function showRace(intent: RaceIntent = { kind: "channel" }): void {
  swap(() => new Race(root, showMenu, intent));
}

// `?race` = raccourci dev (deux onglets au navigateur) : toujours la Room du salon,
// c'est le seul chemin qui ne demande rien à saisir.
if (new URLSearchParams(location.search).has("race")) {
  showRace();
} else {
  showMenu();
}
