import { describe, it, expect } from "vitest";
import {
  reduce,
  initialRaceState,
  type RaceState,
  type ReduceContext,
} from "./race-state";
import type { PlayerEntry, ServerEvent } from "./net";

const ctx: ReduceContext = { me: "p1", myReps: 0 };

function player(playerId: string, ready = false): PlayerEntry {
  return { playerId, displayName: playerId, avatarHash: null, ready };
}

function roomState(overrides: Partial<Extract<ServerEvent, { type: "RoomState" }>> = {}): ServerEvent {
  return {
    type: "RoomState",
    players: [player("p1"), player("p2")],
    owner: "p1",
    seed: 0,
    targetText: "chat chien",
    code: null,
    textSource: { kind: "quote" },
    maxPlayers: 8,
    countdownS: 7,
    readyCheck: false,
    difficulty: "normal",
    gameMode: "normal",
    lavaIntervalS: 10,
    spamWord: null,
    spamThreshold: 20,
    spamTimeCapS: 30,
    ...overrides,
  };
}

function fold(events: ServerEvent[], context: ReduceContext = ctx, start: RaceState = initialRaceState()): RaceState {
  return events.reduce((s, e) => reduce(s, e, context), start);
}

describe("reduce — RoomState", () => {
  it("connecting → lobby, reprend réglages et texte", () => {
    const s = fold([roomState()]);
    expect(s.phase).toBe("lobby");
    expect(s.players.map((p) => p.playerId)).toEqual(["p1", "p2"]);
    expect(s.targetWords).toEqual(["chat", "chien"]);
  });

  it("pendant countdown/running, ne retronque pas le texte (un rejoignant ne doit pas couper le tapis sous les pieds)", () => {
    const s = fold([
      roomState(),
      { type: "RaceStart", startAtEpochMs: 0 },
      roomState({ targetText: "un mot" }),
    ]);
    expect(s.phase).toBe("countdown");
    expect(s.targetWords).toEqual(["chat", "chien"]);
  });
});

describe("reduce — RoomNotFound / RoomFull", () => {
  it("code inconnu : phase failed avec message", () => {
    const s = fold([{ type: "RoomNotFound" }]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toMatch(/inconnu/);
  });

  it("Room pleine : phase failed avec message", () => {
    const s = fold([{ type: "RoomFull" }]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toMatch(/complète/);
  });
});

describe("reduce — RaceStart", () => {
  it("gèle racers, vide les états et le duel précédent", () => {
    const s = fold([roomState(), { type: "RaceStart", startAtEpochMs: 0 }]);
    expect(s.phase).toBe("countdown");
    expect(s.racers.map((p) => p.playerId)).toEqual(["p1", "p2"]);
    expect(s.states.size).toBe(0);
    expect(s.playOfTheGame).toBeNull();
  });

  it("un second RaceStart pendant le décompte est ignoré", () => {
    const s = fold([
      roomState(),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "PlayerBurned", playerId: "p2", atMs: 500 },
      { type: "RaceStart", startAtEpochMs: 1000 },
    ]);
    // toujours brûlé : un second RaceStart n'a pas rejoué le vidage des états.
    expect(s.states.get("p2")).toEqual({ kind: "burned", atMs: 500 });
  });
});

describe("reduce — PlayerProgress / PlayerBurned", () => {
  it("avance un partant en course, jamais un terminal déjà posé", () => {
    const s = fold([
      roomState(),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "PlayerBurned", playerId: "p2", atMs: 500 },
      { type: "PlayerProgress", playerId: "p2", charsDone: 10, reps: 0 },
    ]);
    expect(s.states.get("p2")).toEqual({ kind: "burned", atMs: 500 });
  });
});

describe("reduce — PlayerFinished", () => {
  it("forfeit : abandoned", () => {
    const s = fold([
      roomState(),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "PlayerFinished", playerId: "p2", wpm: 0, forfeit: true, failedPercent: null },
    ]);
    expect(s.states.get("p2")).toEqual({ kind: "abandoned" });
  });

  it("failedPercent : failed, jamais confondu avec un abandon", () => {
    const s = fold([
      roomState(),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "PlayerFinished", playerId: "p2", wpm: 0, forfeit: false, failedPercent: 42 },
    ]);
    expect(s.states.get("p2")).toEqual({ kind: "failed", percent: 42 });
  });

  it("Spam : un autre partant garde ses reps du dernier Progress connu", () => {
    const s = fold([
      roomState({ gameMode: "spam" }),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "PlayerProgress", playerId: "p2", charsDone: 4, reps: 3 },
      { type: "PlayerFinished", playerId: "p2", wpm: 0, forfeit: false, failedPercent: null },
    ]);
    expect(s.states.get("p2")).toEqual({ kind: "finished", wpm: 0, reps: 3 });
  });

  it("Spam : MES reps se relisent du contexte live, pas d'un Progress réseau (PlayerFinished ne les porte pas)", () => {
    const s = fold(
      [
        roomState({ gameMode: "spam" }),
        { type: "RaceStart", startAtEpochMs: 0 },
        { type: "PlayerFinished", playerId: "p1", wpm: 0, forfeit: false, failedPercent: null },
      ],
      { me: "p1", myReps: 7 },
    );
    expect(s.states.get("p1")).toEqual({ kind: "finished", wpm: 0, reps: 7 });
  });
});

describe("reduce — SpamStop", () => {
  it("marque Devancé tout le monde sous le seuil atteint par quelqu'un", () => {
    const s = fold(
      [
        roomState({ gameMode: "spam", spamThreshold: 5 }),
        { type: "RaceStart", startAtEpochMs: 0 },
        { type: "PlayerProgress", playerId: "p2", charsDone: 20, reps: 5 },
        { type: "SpamStop" },
      ],
      { me: "p1", myReps: 2 },
    );
    expect(s.states.get("p1")).toEqual({ kind: "outpaced", reps: 2 });
    // p2 a atteint le seuil : pas sous la barre, donc pas Devancé — reste "racing"
    // (SpamStop ne le déclare pas vainqueur lui-même, c'est RaceOver qui recompte).
    expect(s.states.get("p2")).toEqual({ kind: "racing", charsDone: 20, reps: 5 });
  });
});

describe("reduce — RaceOver puis RoomState de revanche (issue #132)", () => {
  it("le RoomState de revanche, ordonné APRÈS, n'écrase jamais racedWords", () => {
    const s = fold([
      roomState({ targetText: "chat chien" }),
      { type: "RaceStart", startAtEpochMs: 0 },
      { type: "RaceOver", results: [], playOfTheGame: null },
      roomState({ targetText: "souris renard" }), // revanche : texte suivant
    ]);
    expect(s.racedWords).toEqual(["chat", "chien"]);
    expect(s.targetWords).toEqual(["souris", "renard"]);
    // "over" reste jusqu'au RaceStart de la revanche : le podium EST l'écran de lobby
    // d'après-course (voir le commentaire sur updateActivity dans race.ts).
    expect(s.phase).toBe("over");
  });
});
