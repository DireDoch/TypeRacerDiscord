// =============================================================================
//  core/fps.ts — limite d'images/s de l'animation (issue #70).
//
//  Ne remplace PAS requestAnimationFrame (toujours au rythme natif de l'écran) :
//  throttle seulement le TRAVAIL de rendu déclenché à chaque frame. La logique de
//  jeu (retop du texte, avertissement de fin) reste à sa cadence normale — seule
//  l'animation visuelle (le compteur qui bouge) peut être plafonnée.
// =============================================================================

/** 0 (ou toute valeur ≤ 0) = natif, jamais throttlé. */
export function shouldRenderFrame(lastFrameMs: number, nowMs: number, fpsLimit: number): boolean {
  if (fpsLimit <= 0) return true;
  return nowMs - lastFrameMs >= 1000 / fpsLimit;
}
