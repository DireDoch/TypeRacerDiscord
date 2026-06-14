// =============================================================================
//  main.ts — bootstrap de l'app frontend (point d'entrée Vite).
//
//  MVP : monte directement l'écran de Practice. L'intégration Discord Embedded App
//  SDK (handshake OAuth → GET /token) viendra se brancher ici, en amont du montage.
// =============================================================================

import "./style.css";
import { Practice } from "./ui/practice";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app introuvable dans index.html");

new Practice(root).mount();
