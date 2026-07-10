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

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app introuvable dans index.html");

// `?race` monte l'écran multijoueur (salon via `?channel=` en dev, sinon Discord).
if (new URLSearchParams(location.search).has("race")) {
  void new Race(root).mount();
} else {
  new Practice(root).mount();
}
