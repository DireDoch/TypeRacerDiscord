// =============================================================================
//  stats/scoreboard.ts — calcul du Scoreboard (RÉFÉRENCE de l'algorithme).
//
//  Rejoue le keystroke log avec le modèle de curseur LIBRE (pile) et produit le
//  Scoreboard complet. C'est la version TS de référence ; `backend/src/domain/
//  {replay,stats}.rs` doit la reproduire bit pour bit (les chiffres autoritaires).
//
//  Règles figées (grilling) :
//   - t=0 = fin du décompte ; durée selon le Mode.
//   - WPM = chars corrects à l'ÉTAT FINAL ÷ 5 ÷ min (espaces séparateurs inclus).
//   - Raw = tous chars imprimables tapés (gross, espaces inclus) ÷ 5 ÷ min.
//   - ACC = frappes correctes ÷ total frappes (caractères + espaces ; Backspace neutre ;
//           Extra = incorrect).
//   - Breakdown : Correct/Incorrect PAR FRAPPE ; Extra/Missed à l'ÉTAT FINAL
//     (Missed = chars sautés par un espace anticipé).
//   - Série/seconde : WPM/Raw cumulatifs ; Errors locales ; Burst = WPM du mot le
//     plus rapide complété dans la seconde (chrono dès la 1re frappe du mot), report sinon.
// =============================================================================

import type {
  CharacterBreakdown,
  Keystroke,
  Mode,
  PerSecondPoint,
  Scoreboard,
} from "../types";

export interface ScoreInput {
  mode: Mode;
  modeValue: number;
  targetText: string; // "" pour Zen
  keystrokes: Keystroke[];
  endedAtMs: number;
}

interface Snapshot {
  t: number;
  correctChars: number; // chars corrects (état courant) pour WPM cumulatif
  rawChars: number; // chars imprimables cumulés pour Raw cumulatif
}

interface Completion {
  t: number; // instant de complétion du mot
  wordWpm: number; // WPM du mot (déjà calculé)
}

const maxBuffer = (target: string): number => target.length + Math.max(4, target.length);

const wordCorrect = (typed: string, target: string): number => {
  let n = 0;
  const lim = Math.min(typed.length, target.length);
  for (let i = 0; i < lim; i++) if (typed[i] === target[i]) n++;
  return n;
};

export function computeScoreboard(input: ScoreInput): Scoreboard {
  const durationMs = resolveDuration(input);
  const pbEligible = input.mode !== "zen" && !(input.mode === "time" && input.modeValue === 0);

  const result =
    input.mode === "zen"
      ? replayZen(input.keystrokes)
      : replayTarget(input.targetText, input.keystrokes);

  const minutes = durationMs / 60000 || Infinity; // évite /0 ; un Run de 0 ms ⇒ 0 WPM
  const wpm = round1(result.correctChars / 5 / minutes);
  const raw = round1(result.rawChars / 5 / minutes);
  const totalKeys = result.breakdown.correct + result.breakdown.incorrect;
  const accuracy = totalKeys === 0 ? 100 : round1((result.breakdown.correct / totalKeys) * 100);

  const perSecond = buildPerSecond(result.snapshots, result.errorEvents, result.completions, durationMs);

  return {
    wpm,
    raw,
    accuracy,
    characters: result.breakdown,
    durationMs,
    perSecond,
    pbEligible,
  };
}

function resolveDuration(input: ScoreInput): number {
  if (input.mode === "time" && input.modeValue > 0) return input.modeValue * 1000;
  return input.endedAtMs; // words/quotes (complétion), zen & time infini (Shift+Enter)
}

// ----------------------------------------------------------------------------
//  Replay — modes avec texte cible (time / words / quotes)
// ----------------------------------------------------------------------------

interface ReplayResult {
  correctChars: number;
  rawChars: number;
  breakdown: CharacterBreakdown;
  snapshots: Snapshot[];
  errorEvents: number[]; // instants des frappes incorrectes
  completions: Completion[];
}

function replayTarget(targetText: string, keys: Keystroke[]): ReplayResult {
  const target = targetText.length ? targetText.split(" ") : [];
  // Curseur libre : `locked` est une PILE des mots verrouillés (le backspace peut en
  // rouvrir le sommet). `wordIndex` = locked.length. Mêmes règles que FreeInput.
  const locked: string[] = [];
  let typed = "";
  let wordStartT: number | null = null; // 1re frappe du mot courant (chrono Burst)

  let frozenCorrect = 0; // chars corrects des mots verrouillés (+ espaces séparateurs) — réversible
  let rawChars = 0;
  let correctKeys = 0;
  let incorrectKeys = 0;

  const snapshots: Snapshot[] = [];
  const errorEvents: number[] = [];
  const completions: Completion[] = [];

  const snap = (t: number) =>
    snapshots.push({ t, correctChars: frozenCorrect + wordCorrect(typed, target[locked.length] ?? ""), rawChars });

  const completeWord = (t: number, len: number) => {
    if (wordStartT !== null && t > wordStartT) {
      completions.push({ t, wordWpm: round1(len / 5 / ((t - wordStartT) / 60000)) });
    }
  };

  for (const k of keys) {
    const tgt = target[locked.length] ?? "";

    if (k.ctrl === "backspace-word") {
      if (typed.length > 0) {
        typed = "";
      } else if (locked.length > 0) {
        // Supprime le mot précédent entier : on retire sa contribution figée.
        const w = locked.pop()!;
        frozenCorrect -= wordCorrect(w, target[locked.length] ?? "") + 1;
        typed = "";
      }
      wordStartT = null;
      snap(k.t);
      continue;
    }
    if (k.ctrl === "backspace") {
      if (typed.length > 0) {
        typed = typed.slice(0, -1);
        if (typed.length === 0) wordStartT = null;
      } else if (locked.length > 0) {
        // Rouvre le mot précédent : on annule sa contribution figée et il redevient le buffer.
        const w = locked.pop()!;
        frozenCorrect -= wordCorrect(w, target[locked.length] ?? "") + 1;
        typed = w;
        wordStartT = null;
      }
      snap(k.t);
      continue;
    }
    if (k.k === " ") {
      if (typed.length === 0) {
        snap(k.t); // espace en tête (ne devrait pas être loggé) : ignoré
        continue;
      }
      // Verrouille le mot courant.
      frozenCorrect += wordCorrect(typed, tgt) + 1; // +1 = l'espace séparateur (correct)
      correctKeys++; // l'espace compte comme frappe correcte
      rawChars++;
      completeWord(k.t, tgt.length);
      locked.push(typed);
      typed = "";
      wordStartT = null;
      snap(k.t);
      continue;
    }
    if (k.k.length === 1) {
      if (wordStartT === null) wordStartT = k.t; // 1re frappe du mot
      const pos = typed.length;
      const correct = pos < tgt.length && k.k === tgt[pos];
      if (correct) correctKeys++;
      else {
        incorrectKeys++;
        errorEvents.push(k.t);
      }
      rawChars++;
      if (typed.length < maxBuffer(tgt)) typed += k.k; // plafond d'Extra
      snap(k.t);
    }
  }

  // État final : Extra/Missed recalculés sur TOUS les mots atteints (verrouillés + courant).
  // Un mot rouvert puis corrigé voit donc son décompte mis à jour (curseur libre).
  let extra = 0;
  let missed = 0;
  for (let i = 0; i < locked.length; i++) {
    const t = target[i] ?? "";
    extra += Math.max(0, locked[i].length - t.length);
    missed += Math.max(0, t.length - locked[i].length);
  }
  // Mot final (non verrouillé) : exactitude figée à l'état final (Missed non compté, comme avant).
  const lastTgt = target[locked.length] ?? "";
  const finalWordCorrect = wordCorrect(typed, lastTgt);
  const correctChars = frozenCorrect + finalWordCorrect;
  extra += Math.max(0, typed.length - lastTgt.length);
  // Complétion du dernier mot (words/quotes terminé sans espace final).
  if (typed.length >= lastTgt.length && lastTgt.length > 0) {
    completeWord(lastKeyT(keys), lastTgt.length);
  }

  return {
    correctChars,
    rawChars,
    breakdown: { correct: correctKeys, incorrect: incorrectKeys, extra, missed },
    snapshots,
    errorEvents,
    completions,
  };
}

// ----------------------------------------------------------------------------
//  Replay — Zen (pas de texte cible : tout est correct)
// ----------------------------------------------------------------------------

function replayZen(keys: Keystroke[]): ReplayResult {
  let count = 0;
  let wordStartT: number | null = null;
  let wordLen = 0;
  const snapshots: Snapshot[] = [];
  const completions: Completion[] = [];

  for (const k of keys) {
    if (k.ctrl) continue; // Backspace neutre, ignoré (Zen ACC 100 %)
    if (k.k === " ") {
      if (wordStartT !== null && k.t > wordStartT && wordLen > 0) {
        completions.push({ t: k.t, wordWpm: round1(wordLen / 5 / ((k.t - wordStartT) / 60000)) });
      }
      count++; // l'espace compte comme caractère
      snapshots.push({ t: k.t, correctChars: count, rawChars: count });
      wordStartT = null;
      wordLen = 0;
      continue;
    }
    if (k.k.length === 1) {
      if (wordStartT === null) wordStartT = k.t;
      wordLen++;
      count++;
      snapshots.push({ t: k.t, correctChars: count, rawChars: count });
    }
  }

  return {
    correctChars: count,
    rawChars: count,
    breakdown: { correct: count, incorrect: 0, extra: 0, missed: 0 },
    snapshots,
    errorEvents: [],
    completions,
  };
}

// ----------------------------------------------------------------------------
//  Série par seconde
// ----------------------------------------------------------------------------

function buildPerSecond(
  snapshots: Snapshot[],
  errorEvents: number[],
  completions: Completion[],
  durationMs: number,
): PerSecondPoint[] {
  const durationS = durationMs / 1000;
  if (durationS <= 0) return [];

  const marks: number[] = [];
  for (let n = 1; n <= Math.floor(durationS); n++) marks.push(n);
  if (marks.length === 0 || marks[marks.length - 1] !== durationS) marks.push(durationS);

  const points: PerSecondPoint[] = [];
  let snapPtr = 0;
  let cc = 0;
  let rc = 0;
  let prevTms = 0;
  let lastBurst = 0;

  for (const m of marks) {
    const tms = m * 1000;

    // Cumulatif : dernière snapshot avec t <= tms.
    while (snapPtr < snapshots.length && snapshots[snapPtr].t <= tms) {
      cc = snapshots[snapPtr].correctChars;
      rc = snapshots[snapPtr].rawChars;
      snapPtr++;
    }

    const min = m / 60;
    const errors = errorEvents.filter((t) => t > prevTms && t <= tms).length;
    const winCompletions = completions.filter((c) => c.t > prevTms && c.t <= tms);
    const burst = winCompletions.length
      ? Math.max(...winCompletions.map((c) => c.wordWpm))
      : lastBurst;
    lastBurst = burst;

    points.push({
      t: round2(m),
      wpm: round1(cc / 5 / min),
      raw: round1(rc / 5 / min),
      errors,
      burst,
    });
    prevTms = tms;
  }

  return points;
}

// ----------------------------------------------------------------------------
//  Utilitaires
// ----------------------------------------------------------------------------

const lastKeyT = (keys: Keystroke[]): number => (keys.length ? keys[keys.length - 1].t : 0);
const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;
