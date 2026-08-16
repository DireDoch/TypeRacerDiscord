// =============================================================================
//  ui/info-bubble.ts — l'icône « i » et sa bulle d'explication.
//
//  Née dans le lobby (#95) pour les Réglages de salon, extraite ici quand la barre
//  de config solo en a eu besoin à son tour (#180). Elle vit dans son propre module
//  plutôt que d'être exportée par `race.ts` : importer l'écran de Race depuis
//  Practice pour trois lignes de HTML aurait couplé les deux écrans pour rien.
//
//  Un <button>, jamais un <span> : c'est ce qui rend la bulle atteignable au TAP
//  (le focus l'ouvre) et au clavier. Le survol la donne à la souris, le focus au
//  doigt — deux pseudo-classes dans `style.css`, aucun écouteur, aucun JS.
// =============================================================================

import { escapeText } from "./typing-zone";

/**
 * `label` nomme ce qui est expliqué (il ne s'affiche pas — il part dans l'`aria-label`,
 * seul texte qu'un lecteur d'écran entend avant d'ouvrir la bulle), `tip` est
 * l'explication elle-même. Pure.
 */
export function infoHtml(label: string, tip: string): string {
  return `<button type="button" class="info" aria-label="Explication : ${escapeText(label)}">i<span
    class="tip" role="tooltip">${escapeText(tip)}</span></button>`;
}
