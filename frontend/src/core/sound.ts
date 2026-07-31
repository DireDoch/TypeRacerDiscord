// =============================================================================
//  core/sound.ts — effets sonores (issue #66).
//
//  Web Audio API plutôt que des fichiers son : deux bips synthétisés (erreur,
//  avertissement) ne justifient ni asset binaire à héberger/licencier, ni
//  changement de build — quelques lignes suffisent.
//
//  Un seul AudioContext, créé au premier son (les navigateurs le suspendent
//  tant qu'aucune interaction utilisateur n'a eu lieu — la 1re frappe en a
//  toujours eu une). Jamais recréé : un `AudioContext` par onglet est la limite
//  à respecter, pas par bip.
// =============================================================================

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null; // jsdom / environnement sans Audio
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Bip pur, enveloppe courte (attaque quasi instantanée, décroissance linéaire) pour
 *  éviter le clic audible d'un son coupé net. `volume` : 0-1 (Preference `soundVolume`). */
function beep(freq: number, durationMs: number, volume: number): void {
  if (volume <= 0) return;
  const c = context();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  const now = c.currentTime;
  const durationS = durationMs / 1000;
  gain.gain.setValueAtTime(volume * 0.3, now); // 0.3 : un bip plein volume reste discret
  gain.gain.linearRampToValueAtTime(0, now + durationS);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + durationS);
}

/** Frappe fausse ou espace prématuré (issue #66). */
export function playErrorSound(volume: number): void {
  beep(220, 80, volume);
}

/** Fin de test chronométré proche (issue #66). */
export function playTimeWarningSound(volume: number): void {
  beep(880, 150, volume);
}
