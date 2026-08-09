// =============================================================================
//  core/race-state.ts — état de Race piloté par le SERVEUR, et sa transition pure
//  sur ServerEvent (issue #132, ticket #139).
//
//  PAS ENCORE BRANCHÉ sur ui/race.ts (#140) : module isolé, testé seul contre des
//  séquences d'événements. Les types et fonctions pures ci-dessous sont dupliqués
//  de race.ts le temps de la bascule — la duplication se résorbe au ticket suivant,
//  qui supprime les originaux et branche `race.ts` sur ce module.
//
//  Hors périmètre, volontairement (voir la session de grilling sur #132) : RunClock,
//  Countdown, FreeInput, la boucle rAF, et tout ce que déclenche la SAISIE clavier
//  plutôt qu'un ServerEvent — ce sont des effets que la vue possède, pas des
//  transitions d'état. `phase: "running"` en particulier n'est PAS posé ici : c'est
//  le Countdown local qui y bascule à zéro, sans ServerEvent.
// =============================================================================

import type {
  Difficulty,
  GameMode,
  PlayerEntry,
  PlayOfTheGame,
  RaceResult,
  ServerEvent,
  TextSource,
} from "./net";

export type Phase = "connecting" | "lobby" | "countdown" | "running" | "over" | "failed";

/**
 * L'état d'un partant (issue #130) : les quatre terminaux du glossaire (Abandon,
 * Failed, Brûlé, Devancé) plus les deux non-terminaux (en course, arrivé), garanti
 * par le type au lieu d'un ordre de `if` à documenter.
 */
export type RacerState =
  | { kind: "racing"; charsDone: number; reps: number }
  | { kind: "finished"; wpm: number; reps: number }
  | { kind: "abandoned" }
  | { kind: "failed"; percent: number }
  | { kind: "burned"; atMs: number }
  | { kind: "outpaced"; reps: number };

/** Pose `next` SAUF si `cur` est déjà un état terminal (issue #130). */
export function advanceState(cur: RacerState | undefined, next: RacerState): RacerState {
  return cur === undefined || cur.kind === "racing" ? next : cur;
}

/** `reps` d'un état, 0 là où il n'a pas de sens (abandon, échec, brûlé). */
function repsOf(state: RacerState): number {
  return state.kind === "racing" || state.kind === "finished" || state.kind === "outpaced"
    ? state.reps
    : 0;
}

/** Les vivants (ADR 0015) : `racers` doit être la liste FIGÉE au RaceStart. */
export function aliveIds(racers: string[], states: Map<string, RacerState>): string[] {
  return racers.filter((id) => {
    const s = states.get(id);
    return s === undefined || s.kind === "racing";
  });
}

/** Qui est Devancé quand Spam s'arrête (ADR 0016), parmi ceux ENCORE en course. */
export function outpaced(
  racing: { playerId: string; reps: number }[],
  threshold: number,
): { playerId: string; reps: number }[] {
  if (racing.length === 0) return [];
  const reachedThreshold = racing.some((r) => r.reps >= threshold);
  const bar = reachedThreshold ? threshold : Math.max(...racing.map((r) => r.reps));
  return racing.filter((r) => r.reps < bar);
}

export interface RaceState {
  phase: Phase;
  /** Présents AVEC leur Display identity — c'est ce que la piste dessine. */
  players: PlayerEntry[];
  /** Partants figés au RaceStart (miroir du `racers` serveur). */
  racers: PlayerEntry[];
  owner: string;
  /** Code de partie de la Room, `null` pour une Room de salon vocal. */
  code: string | null;
  /** Source EFFECTIVE du texte (ADR 0009) — pas celle demandée : un repli se lit ici. */
  textSource: TextSource;
  maxPlayers: number;
  countdownS: number;
  readyCheck: boolean;
  difficulty: Difficulty;
  gameMode: GameMode;
  lavaIntervalS: number;
  spamWord: string | null;
  spamThreshold: number;
  spamTimeCapS: number;
  /** Message affiché en phase "failed" (code inconnu, Room pleine). */
  failure: string;
  targetText: string;
  targetWords: string[];
  /** Un `RacerState` par joueur (issue #130). */
  states: Map<string, RacerState>;
  /** Résultats complets de la dernière course, DANS L'ORDRE DU CLASSEMENT (ADR 0010). */
  results: RaceResult[];
  /** Le duel le plus serré (ADR 0011), ou `null` s'il n'y en a pas eu. */
  playOfTheGame: PlayOfTheGame | null;
  /**
   * Snapshot des mots de la course JOUÉE, figé à `RaceOver`. Le `RoomState` de
   * revanche (ordonné APRÈS, garanti par le WebSocket) écrase `targetWords` avec le
   * texte suivant ; le Play of the Game rejoue les logs contre CE texte-ci.
   */
  racedWords: string[];
}

export function initialRaceState(): RaceState {
  return {
    phase: "connecting",
    players: [],
    racers: [],
    owner: "",
    code: null,
    textSource: { kind: "quote" },
    maxPlayers: 8,
    countdownS: 7, // RACE_COUNTDOWN_S de race.ts — dupliqué le temps de la bascule (#140)
    readyCheck: false,
    difficulty: "normal",
    gameMode: "normal",
    lavaIntervalS: 10,
    spamWord: null,
    spamThreshold: 20,
    spamTimeCapS: 30,
    failure: "",
    targetText: "",
    targetWords: [],
    states: new Map(),
    results: [],
    playOfTheGame: null,
    racedWords: [],
  };
}

/** Lit l'état d'un partant, « en course à zéro » avant son premier signal. */
export function stateOf(state: RaceState, playerId: string): RacerState {
  return state.states.get(playerId) ?? { kind: "racing", charsDone: 0, reps: 0 };
}

/** Les vivants : partants figés au RaceStart, ni brûlés ni déjà sortis. */
export function alive(state: RaceState): PlayerEntry[] {
  const ids = new Set(aliveIds(state.racers.map((p) => p.playerId), state.states));
  return state.racers.filter((p) => ids.has(p.playerId));
}

export function isLastAlive(state: RaceState, me: string): boolean {
  const a = alive(state);
  return a.length === 1 && a[0].playerId === me;
}

/**
 * Ce que le seul `ServerEvent` ne porte pas et que `reduce` a besoin de connaître :
 * mes propres répétitions LIVES sous Spam, relues du buffer de saisie (FreeInput),
 * pas du dernier `Progress` que j'ai diffusé — `Finish`/`SpamStop` ne les portent
 * pas, et l'ancien code local (race.ts:`repsFor`) les relit toujours en local pour
 * MOI plutôt que depuis le dernier état réseau connu. `myReps` vaut 0 hors Spam.
 */
export interface ReduceContext {
  me: string;
  myReps: number;
}

function repsFor(state: RaceState, ctx: ReduceContext, playerId: string): number {
  return playerId === ctx.me ? ctx.myReps : repsOf(stateOf(state, playerId));
}

function advance(state: RaceState, playerId: string, next: RacerState): RaceState {
  const states = new Map(state.states);
  states.set(playerId, advanceState(state.states.get(playerId), next));
  return { ...state, states };
}

function applySpamStop(state: RaceState, ctx: ReduceContext): RaceState {
  const racing: { playerId: string; reps: number }[] = [];
  for (const p of state.racers) {
    const s = stateOf(state, p.playerId);
    if (s.kind !== "racing") continue;
    racing.push({ playerId: p.playerId, reps: repsFor(state, ctx, p.playerId) });
  }
  const states = new Map(state.states);
  for (const r of outpaced(racing, state.spamThreshold)) {
    states.set(r.playerId, { kind: "outpaced", reps: r.reps });
  }
  return { ...state, states };
}

/**
 * La transition d'état de Race, pure. Mêmes cas que l'ancien `switch` de
 * `race.ts:onEvent` (222-317), déplacés sans changement de comportement — voir
 * `race-state.test.ts` pour la séquence qui a motivé #132 (RaceOver → RoomState de
 * revanche sans écraser `racedWords`).
 */
export function reduce(state: RaceState, event: ServerEvent, ctx: ReduceContext): RaceState {
  switch (event.type) {
    case "RoomState": {
      const next: RaceState = {
        ...state,
        players: event.players,
        owner: event.owner,
        code: event.code,
        textSource: event.textSource,
        maxPlayers: event.maxPlayers,
        countdownS: event.countdownS,
        readyCheck: event.readyCheck,
        difficulty: event.difficulty,
        gameMode: event.gameMode,
        lavaIntervalS: event.lavaIntervalS,
        spamWord: event.spamWord,
        spamThreshold: event.spamThreshold,
        spamTimeCapS: event.spamTimeCapS,
      };
      // Le texte n'est PAS repris pendant qu'on court (voir le champ `targetText`).
      if (state.phase !== "countdown" && state.phase !== "running") {
        next.targetText = event.targetText;
        next.targetWords = event.targetText.split(" ").filter((w) => w.length > 0);
      }
      if (state.phase === "connecting") next.phase = "lobby";
      return next;
    }
    case "RoomNotFound":
      return { ...state, phase: "failed", failure: "Code de partie inconnu. Vérifie-le auprès de l'hôte." };
    case "RoomFull":
      return { ...state, phase: "failed", failure: "Cette partie est complète (8 joueurs)." };
    case "RaceStart":
      // Un seul décompte vivant : un second RaceStart pendant le décompte/la course est ignoré.
      if (state.phase === "countdown" || state.phase === "running") return state;
      return {
        ...state,
        phase: "countdown",
        racers: state.players.slice(),
        states: new Map(),
        playOfTheGame: null,
      };
    case "PlayerProgress":
      return advance(state, event.playerId, { kind: "racing", charsDone: event.charsDone, reps: event.reps });
    case "SpamStop":
      return applySpamStop(state, ctx);
    case "PlayerFinished": {
      const reps = repsFor(state, ctx, event.playerId);
      return advance(
        state,
        event.playerId,
        event.forfeit
          ? { kind: "abandoned" }
          : event.failedPercent !== null
            ? { kind: "failed", percent: event.failedPercent }
            : { kind: "finished", wpm: event.wpm, reps },
      );
    }
    case "PlayerBurned":
      return advance(state, event.playerId, { kind: "burned", atMs: event.atMs });
    case "RaceOver":
      return {
        ...state,
        results: event.results,
        playOfTheGame: event.playOfTheGame,
        racedWords: state.targetWords.slice(),
        phase: "over",
      };
  }
}
