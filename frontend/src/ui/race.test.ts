import { describe, it, expect } from "vitest";
import {
  raceComplete,
  sourceLabel,
  currentCount,
  liveWpmOf,
  trackLabel,
  trackPercent,
  lastPlaced,
  nextBurnIn,
  spamReps,
  capRemaining,
  spamRefill,
  lobbyRowHtml,
  textSourceEvent,
  spamWordEvent,
  activityExtra,
  type LobbyRow,
} from "./race";
import { aliveIds, outpaced, advanceState, initialRaceState, type RacerState } from "../core/race-state";
import { FreeInput } from "../core/input/free-input";
import { avatarUrl } from "../discord";
import { WORDS_LENGTHS } from "../core/net";
import type { InputView } from "../core/input/controller";

const view = (lockedWords: string[], typed: string): InputView => ({
  wordIndex: lockedWords.length,
  typed,
  lockedWords,
});

describe("raceComplete — fin de course = texte entièrement exact", () => {
  const target = ["the", "cat", "sat"];

  it("dernier mot en cours et exact + précédents exacts : terminé", () => {
    expect(raceComplete(target, view(["the", "cat"], "sat"))).toBe(true);
  });

  it("tous verrouillés exactement (espace après le dernier) : terminé", () => {
    expect(raceComplete(target, view(["the", "cat", "sat"], ""))).toBe(true);
  });

  it("une faute non corrigée dans un mot précédent : PAS terminé", () => {
    expect(raceComplete(target, view(["teh", "cat"], "sat"))).toBe(false);
  });

  it("dernier mot inexact : PAS terminé", () => {
    expect(raceComplete(target, view(["the", "cat"], "sxt"))).toBe(false);
  });

  it("pas encore au bout : PAS terminé", () => {
    expect(raceComplete(target, view(["the"], "cat"))).toBe(false);
  });
});

describe("Source de texte du lobby (ADR 0009)", () => {
  it("la longueur ne s'affiche que pour Mots — celle d'une Quote lui appartient", () => {
    expect(sourceLabel({ kind: "quote" })).toBe("Citation");
    expect(sourceLabel({ kind: "words", count: 15 })).toBe("Mots (15)");
  });

  it("repasser sur Mots garde la longueur courante", () => {
    expect(currentCount({ kind: "words", count: 50 })).toBe(50);
  });

  it("depuis Quote, Mots retombe sur une longueur que le serveur accepte", () => {
    const n = currentCount({ kind: "quote" });
    expect(WORDS_LENGTHS).toContain(n);
  });
});

describe("WPM live de la piste — dérivé de charsDone, jamais transporté", () => {
  it("150 caractères corrects en 60 s = 30 wpm (un mot = 5 caractères)", () => {
    expect(liveWpmOf(150, 60_000)).toBe(30);
  });

  it("avant le premier tick, pas de division par zéro", () => {
    expect(liveWpmOf(0, 0)).toBe(0);
    expect(liveWpmOf(42, 0)).toBe(0);
  });

  it("n'avoir rien tapé donne 0, pas NaN", () => {
    expect(liveWpmOf(0, 30_000)).toBe(0);
  });
});

describe("trackLabel — un abandon s'affiche « abandon », jamais « 0 wpm »", () => {
  it("abandon : le flag l'emporte, même avec un WPM à 0", () => {
    expect(trackLabel({ kind: "abandoned", charsDone: 0 }, 0)).toBe("abandon");
    expect(trackLabel({ kind: "abandoned", charsDone: 0 }, 0)).not.toContain("wpm");
  });

  it("fini pour de vrai : WPM autoritaire coché", () => {
    expect(trackLabel({ kind: "finished", wpm: 72, reps: 0 }, 40)).toBe("72 wpm ✓");
  });

  it("en train de courir : WPM live dérivé", () => {
    expect(trackLabel({ kind: "racing", charsDone: 0, reps: 0 }, 55)).toBe("55 wpm");
  });
});

describe("trackLabel — un Échec Master (ADR 0013) s'affiche « échec (X%) », distinct de l'abandon", () => {
  it("l'emporte sur tout le reste, même un WPM final présent", () => {
    expect(trackLabel({ kind: "failed", percent: 42, charsDone: 0 }, 40)).toBe("échec (42%)");
  });

  // Le cas « abandon ET échec en même temps » n'existe plus : RacerState ne permet plus
  // de le construire, c'est le type qui l'interdit — plus un ordre de `if` à vérifier.
});

describe("avatarUrl — on reconstruit l'URL, on ne la transporte jamais", () => {
  it("avec un hash : l'avatar du joueur sur le CDN Discord", () => {
    expect(avatarUrl("123456789012345678", "abc123")).toContain(
      "/avatars/123456789012345678/abc123.png",
    );
  });

  it("sans hash : l'avatar Discord par défaut, dérivé du snowflake", () => {
    expect(avatarUrl("123456789012345678", null)).toMatch(/\/embed\/avatars\/[0-5]\.png$/);
  });

  it("en mode dev le playerId n'est pas numérique — pas de BigInt tenté", () => {
    expect(() => avatarUrl("dev-player-1", null)).not.toThrow();
    expect(avatarUrl("dev-player-1", null)).toContain("/embed/avatars/0.png");
  });
});

describe("trackPercent — le remplissage de la piste", () => {
  const running: RacerState = { kind: "racing", charsDone: 0, reps: 0 };

  it("suit la progression tant qu'on court", () => {
    expect(trackPercent(50, 200, running)).toBe(25);
    expect(trackPercent(0, 200, running)).toBe(0);
  });

  it("remplit la piste à l'arrivée, même sans espace après le dernier mot", () => {
    // Depuis #94, Progress ne part qu'au verrouillage d'un mot : `done` est en retard
    // d'un mot quand on finit sans taper d'espace derrière.
    expect(trackPercent(190, 200, { kind: "finished", wpm: 40, reps: 0 })).toBe(100);
  });

  it("laisse un abandon là où il s'est arrêté", () => {
    // RacerState rend « fini ET abandonné » impossible à construire — plus besoin de
    // l'exclure explicitement, la voiture ne peut plus se téléporter sur cette ligne.
    expect(trackPercent(20, 200, { kind: "abandoned", charsDone: 0 })).toBe(10);
  });

  it("laisse un échec Master là où il s'est arrêté", () => {
    expect(trackPercent(6, 200, { kind: "failed", percent: 42, charsDone: 0 })).toBe(3);
  });

  it("ne dépasse jamais 100 % ni ne divise par zéro", () => {
    expect(trackPercent(500, 200, running)).toBe(100);
    expect(trackPercent(0, 0, running)).toBe(0);
  });

  it("sous Spam, un vrai vainqueur ne téléporte pas — le calcul naturel plafonne déjà seul", () => {
    expect(trackPercent(20, 20, { kind: "finished", wpm: 60, reps: 20 }, true)).toBe(100);
    expect(trackPercent(14, 20, { kind: "outpaced", reps: 14, charsDone: 0 }, true)).toBe(70);
  });
});

// --- Floor is lava (ADR 0015) -------------------------------------------------

describe("trackLabel — un Brûlé passe avant tout le reste", () => {
  it("affiche l'instant du décès, pas un WPM", () => {
    expect(trackLabel({ kind: "burned", atMs: 32_000, charsDone: 0 }, 55)).toBe("brûlé à 32 s");
  });

  // « reste brûlé après le PlayerFinished que son log déclenche » n'est plus un cas de
  // trackLabel : `advanceState` garde désormais un état terminal contre tout écrasement
  // à l'écriture — un `PlayerFinished` en vol ne peut plus reconstruire un état « fini »
  // par-dessus un « brûlé » déjà posé, donc trackLabel ne voit jamais les deux à la fois.
  // Voir "advanceState" plus bas pour ce cas précis.

  it("arrondit à la seconde", () => {
    expect(trackLabel({ kind: "burned", atMs: 7_600, charsDone: 0 }, 0)).toBe("brûlé à 8 s");
  });
});

describe("advanceState — un verdict terminal ne se laisse plus écraser (issue #130)", () => {
  it("pose l'état quand rien n'existe encore", () => {
    const finished: RacerState = { kind: "finished", wpm: 40, reps: 0 };
    expect(advanceState(undefined, finished)).toEqual(finished);
  });

  it("un partant « en course » se laisse remplacer, quel que soit le nouvel état", () => {
    const racing: RacerState = { kind: "racing", charsDone: 10, reps: 2 };
    expect(advanceState(racing, { kind: "burned", atMs: 5_000, charsDone: 10 })).toEqual({
      kind: "burned",
      atMs: 5_000,
      charsDone: 10,
    });
  });

  it("un terminal déjà posé ne se laisse JAMAIS écraser, même par un autre terminal", () => {
    // Le cas qui a motivé le garde-fou : un PlayerFinished en vol après une brûlure ne
    // doit jamais faire redevenir « fini » une ligne déjà carbonisée (ADR 0015).
    const burned: RacerState = { kind: "burned", atMs: 5_000, charsDone: 10 };
    expect(advanceState(burned, { kind: "finished", wpm: 40, reps: 0 })).toBe(burned);
  });
});

describe("lastPlaced — qui brûlera au prochain tic", () => {
  const a = (playerId: string, done: number) => ({ playerId, done });

  it("désigne le moins avancé", () => {
    expect([...lastPlaced([a("p1", 100), a("p2", 20), a("p3", 60)])]).toEqual(["p2"]);
  });

  it("désigne TOUS les ex æquo — aucun départage n'est honnête", () => {
    const doomed = lastPlaced([a("p1", 100), a("p2", 20), a("p3", 20)]);
    expect(doomed.size).toBe(2);
    expect(doomed.has("p2") && doomed.has("p3")).toBe(true);
  });

  it("ne condamne personne quand il reste moins de deux vivants", () => {
    expect(lastPlaced([a("p1", 0)]).size).toBe(0);
    expect(lastPlaced([]).size).toBe(0);
  });

  it("traite le zéro comme une valeur — pas encore tapé, c'est bien le dernier", () => {
    expect([...lastPlaced([a("p1", 0), a("p2", 5)])]).toEqual(["p1"]);
  });
});

describe("aliveIds — le dernier vivant se compte sur les partants figés", () => {
  it("un rejoignant en cours de course (absent de `racers`) ne compte jamais comme vivant", () => {
    // p3 a rejoint la Room après le RaceStart — il n'apparaît que dans `players`, jamais
    // dans `racers`. S'il fuitait ici, un duel à 2 (p1 vs p2) ne se clôturerait jamais
    // tout seul : il resterait toujours 2 "vivants" (le survivant + le spectateur p3).
    const states = new Map<string, RacerState>([["p2", { kind: "burned", atMs: 1_000, charsDone: 0 }]]);
    expect(aliveIds(["p1", "p2"], states)).toEqual(["p1"]);
  });

  it("brûlés et sortis (arrivée/abandon/échec) sont tous deux retirés des vivants", () => {
    const states = new Map<string, RacerState>([
      ["p2", { kind: "burned", atMs: 1_000, charsDone: 0 }],
      ["p3", { kind: "finished", wpm: 40, reps: 0 }],
    ]);
    expect(aliveIds(["p1", "p2", "p3"], states)).toEqual(["p1"]);
  });
});

// --- Spam (ADR 0016) ----------------------------------------------------------

describe("spamReps — le compte se RELIT de la pile, jamais un compteur à part", () => {
  it("compte les mots verrouillés égaux au mot cible", () => {
    expect(spamReps("go", view(["go", "go", "go"], ""))).toBe(3);
  });

  it("un mot verrouillé FAUX n'est pas une répétition", () => {
    expect(spamReps("go", view(["go", "ga", "go"], ""))).toBe(2);
  });

  it("la répétition en cours de frappe n'en est pas encore une", () => {
    expect(spamReps("go", view(["go"], "go"))).toBe(1);
  });

  it("sans mot cible (hors Spam, ou avant le premier RoomState) : zéro", () => {
    expect(spamReps("", view([], ""))).toBe(0);
  });
});

describe("spamReps + FreeInput — Backspace au milieu d'une répétition (ADR 0016)", () => {
  /** Tape la séquence sur un vrai FreeInput ; « ⌫ » = Backspace, « ^ » = Ctrl+Backspace. */
  const type = (target: string[], seq: string): FreeInput => {
    const c = new FreeInput(target);
    let t = 0;
    for (const ch of seq) {
      if (ch === "⌫") c.handleKey("Backspace", false, t++);
      else if (ch === "^") c.handleKey("Backspace", true, t++);
      else c.handleKey(ch, false, t++);
    }
    return c;
  };
  const target = Array(10).fill("go");

  it("corriger une faute AVANT de verrouiller donne bien une répétition", () => {
    expect(spamReps("go", type(target, "ga⌫o ").view())).toBe(1);
  });

  it("Backspace en buffer vide rouvre la dernière répétition, qui se décompte", () => {
    // Le mot rouvert redevient éditable : il n'est plus verrouillé, donc plus compté.
    expect(spamReps("go", type(target, "go go ⌫").view())).toBe(1);
  });

  it("une répétition rouverte puis re-verrouillée recompte", () => {
    expect(spamReps("go", type(target, "go go ⌫ ").view())).toBe(2);
  });

  it("Ctrl+Backspace supprime la répétition entière sans la rouvrir", () => {
    const c = type(target, "go go ^");
    expect(spamReps("go", c.view())).toBe(1);
    expect(c.view().typed).toBe(""); // supprimée, pas remise dans le buffer
  });
});

describe("trackLabel — sous Spam la ligne affiche les répétitions, jamais un WPM", () => {
  it("le compte de répétitions remplace le WPM live", () => {
    expect(trackLabel({ kind: "racing", charsDone: 0, reps: 14 }, 55, 14)).toBe("14 ×");
  });

  it("reste le compte pour un vrai vainqueur, une fois son PlayerFinished reçu", () => {
    // Même piège qu'avant : un PlayerFinished SUIT toujours le SpamStop. `spamReps`
    // continue de l'emporter sur le WPM, même pour l'issue « finished ».
    expect(trackLabel({ kind: "finished", wpm: 72, reps: 14 }, 55, 14)).toBe("14 ×");
  });

  it("zéro répétition reste un compte, pas un repli sur le WPM", () => {
    expect(trackLabel({ kind: "finished", wpm: 30, reps: 0 }, 55, 0)).toBe("0 ×");
  });

  it("un Devancé affiche son propre compte, sans même passer par spamReps", () => {
    expect(trackLabel({ kind: "outpaced", reps: 5, charsDone: 0 }, 3)).toBe("5 ×");
  });

  it("abandon et échec l'emportent toujours — ce ne sont pas des Devancé", () => {
    expect(trackLabel({ kind: "abandoned", charsDone: 0 }, 3, 5)).toBe("abandon");
    expect(trackLabel({ kind: "failed", percent: 42, charsDone: 0 }, 3, 5)).toBe("échec (42%)");
  });
});

describe("outpaced — qui est Devancé quand Spam s'arrête (ADR 0016)", () => {
  it("quelqu'un a atteint le seuil : tous les autres sont Devancé", () => {
    const racing = [
      { playerId: "p1", reps: 20 },
      { playerId: "p2", reps: 12 },
    ];
    expect(outpaced(racing, 20).map((r) => r.playerId)).toEqual(["p2"]);
  });

  it("plafond de temps, personne n'a atteint le seuil : le plus haut compte gagne, le reste est Devancé", () => {
    const racing = [
      { playerId: "p1", reps: 15 },
      { playerId: "p2", reps: 9 },
    ];
    expect(outpaced(racing, 20).map((r) => r.playerId)).toEqual(["p2"]);
  });

  it("égalité au sommet : aucun des ex æquo n'est Devancé", () => {
    const racing = [
      { playerId: "p1", reps: 10 },
      { playerId: "p2", reps: 10 },
    ];
    expect(outpaced(racing, 20)).toEqual([]);
  });

  it("personne encore en course : rien à marquer", () => {
    expect(outpaced([], 20)).toEqual([]);
  });
});

describe("spamRefill — le texte de Spam ne s'épuise jamais", () => {
  it("ne rallonge pas tant qu'il reste de la marge devant le curseur", () => {
    expect(spamRefill(60, 0)).toBe(0);
    expect(spamRefill(60, 29)).toBe(0);
  });

  it("rallonge dès que le curseur entre dans la zone de garde", () => {
    expect(spamRefill(60, 30)).toBeGreaterThan(0);
  });

  it("le curseur ne rattrape JAMAIS la fin, même en tapant sans s'arrêter", () => {
    // C'est LA propriété du mode : sans elle, `FreeInput` retomberait sur un mot cible
    // vide et le plafond de buffer s'effondrerait au milieu d'une course.
    let length = 60;
    for (let wordIndex = 0; wordIndex < 2_000; wordIndex++) {
      length += spamRefill(length, wordIndex);
      expect(wordIndex).toBeLessThan(length);
    }
  });

  it("repart d'un texte déjà rallongé sans jamais reculer", () => {
    expect(spamRefill(300, 500)).toBeGreaterThan(0);
  });
});

describe("capRemaining — le temps restant avant le plafond de Spam", () => {
  it("part du plafond plein et décroît", () => {
    expect(capRemaining(0, 30)).toBe(30);
    expect(capRemaining(10_500, 30)).toBe(20);
  });

  it("ne descend jamais sous zéro — l'arrêt réel vient du serveur", () => {
    expect(capRemaining(30_000, 30)).toBe(0);
    expect(capRemaining(99_000, 30)).toBe(0);
  });
});

describe("nextBurnIn — le décompte avant la prochaine brûlure", () => {
  it("part de l'intervalle plein au départ", () => {
    expect(nextBurnIn(0, 10)).toBe(10);
  });

  it("décroît puis se réarme au tic suivant", () => {
    expect(nextBurnIn(3_000, 10)).toBe(7);
    expect(nextBurnIn(9_500, 10)).toBe(1);
    expect(nextBurnIn(10_000, 10)).toBe(10);
    expect(nextBurnIn(12_000, 10)).toBe(8);
  });

  it("n'affiche jamais zéro — un « 0 s » resterait figé une seconde entière", () => {
    for (let ms = 0; ms < 40_000; ms += 137) {
      const n = nextBurnIn(ms, 5);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

// --- Réglages de salon (issue #131) -------------------------------------------

describe("lobbyRowHtml — libellé, explication (icône) et contrôle, comme settings.ts mais sans DOM", () => {
  const selectRow: LobbyRow = {
    id: "raceGameMode",
    label: "Mode de jeu",
    tip: "Comment la course se gagne.",
    locked: false,
    readOnly: "Normal",
    control: {
      kind: "select",
      value: "spam",
      options: [
        { value: "normal", label: "Normal" },
        { value: "spam", label: "Spam" },
      ],
    },
    set: (v) => ({ type: "SetGameMode", mode: v as "normal" | "spam" | "floorIsLava" }),
  };

  it("rend le libellé lié par `for`, et l'explication dans l'icône « i », pas sous le libellé", () => {
    const html = lobbyRowHtml(selectRow);
    expect(html).toContain('<label for="raceGameMode">Mode de jeu</label>');
    expect(html).toContain('class="tip"');
    expect(html).toContain("Comment la course se gagne.");
    expect(html).not.toContain('class="set-desc"'); // pas la disposition de settings.ts
  });

  it("un `select` marque la valeur courante `selected`, les autres non", () => {
    const html = lobbyRowHtml(selectRow);
    expect(html).toMatch(/<option value="spam" selected>Spam<\/option>/);
    expect(html).not.toMatch(/<option value="normal" selected>/);
  });

  it("verrouillé (non-hôte) : une mention en lecture seule remplace le contrôle", () => {
    const html = lobbyRowHtml({ ...selectRow, locked: true });
    expect(html).toContain('<span class="lobby-value">Normal</span>');
    expect(html).not.toContain("<select");
    // Plus de contrôle à pointer : le libellé n'est plus un `<label for=…>`.
    expect(html).toContain("<span>Mode de jeu</span>");
  });

  it("un `toggle` s'étiquette lui-même (son `<label>` enveloppe déjà sa case)", () => {
    const html = lobbyRowHtml({
      id: "readyCheck",
      label: "Ready-check",
      tip: "…",
      locked: false,
      readOnly: "Désactivé",
      control: { kind: "toggle", value: true, onLabel: "Activé", offLabel: "Désactivé" },
      set: (v) => ({ type: "SetReadyCheck", enabled: v === "true" }),
    });
    expect(html).toContain("<span>Ready-check</span>");
    expect(html).not.toContain("<label for=");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain(">Activé<");
  });

  it("un `text` rend un champ natif avec son placeholder et sa longueur max", () => {
    const html = lobbyRowHtml({
      id: "spamWord",
      label: "Mot",
      tip: "…",
      locked: false,
      readOnly: "go",
      control: { kind: "text", value: "", placeholder: "go (aléatoire)", maxLength: 20 },
      set: (v) => ({ type: "SetSpamWord", word: v || null }),
    });
    expect(html).toContain('type="text"');
    expect(html).toContain('placeholder="go (aléatoire)"');
    expect(html).toContain('maxlength="20"');
  });

  it("un `segmented` ne s'étiquette pas par `for` (ce sont des boutons, pas un champ)", () => {
    const html = lobbyRowHtml({
      id: "textSource",
      label: "Texte",
      tip: "…",
      locked: false,
      readOnly: "Citation",
      control: {
        kind: "segmented",
        value: "quote",
        options: [
          { value: "quote", label: "Citation" },
          { value: "words", label: "Mots" },
        ],
      },
      set: () => ({ type: "SetTextSource", source: { kind: "quote" } }),
    });
    expect(html).toContain("<span>Texte</span>");
    expect(html).toMatch(/data-row="textSource" data-value="quote" class="on"/);
    expect(html).toMatch(/data-row="textSource" data-value="words">/);
  });

  it("un `segmented` avec `extra` rend un second groupe de boutons, sous le premier", () => {
    const html = lobbyRowHtml({
      id: "textSource",
      label: "Texte",
      tip: "…",
      locked: false,
      readOnly: "Mots (30)",
      control: {
        kind: "segmented",
        value: "words",
        options: [
          { value: "quote", label: "Citation" },
          { value: "words", label: "Mots" },
        ],
        extra: {
          value: "30",
          options: [
            { value: "15", label: "Court 15" },
            { value: "30", label: "Normal 30" },
            { value: "50", label: "Long 50" },
          ],
        },
      },
      set: () => ({ type: "SetTextSource", source: { kind: "quote" } }),
    });
    expect((html.match(/class="lobby-seg"/g) ?? []).length).toBe(2);
    expect(html).toMatch(/data-value="30" class="on"/);
  });

  it("un `segmented` sans `extra` ne rend qu'un seul groupe — pas de longueur pour une Citation", () => {
    const html = lobbyRowHtml({
      id: "textSource",
      label: "Texte",
      tip: "…",
      locked: false,
      readOnly: "Citation",
      control: {
        kind: "segmented",
        value: "quote",
        options: [
          { value: "quote", label: "Citation" },
          { value: "words", label: "Mots" },
        ],
      },
      set: () => ({ type: "SetTextSource", source: { kind: "quote" } }),
    });
    expect((html.match(/class="lobby-seg"/g) ?? []).length).toBe(1);
  });

  it("`note` ne s'affiche qu'à côté d'un contrôle actif, jamais en lecture seule", () => {
    const withNote: LobbyRow = { ...selectRow, note: "6 présents" };
    expect(lobbyRowHtml(withNote)).toContain('<span class="lobby-note">6 présents</span>');
    expect(lobbyRowHtml({ ...withNote, locked: true })).not.toContain("lobby-note");
  });
});

describe("textSourceEvent — l'événement de la ligne Texte (issue #131)", () => {
  it("« quote » : bascule sur Citation, sans longueur", () => {
    expect(textSourceEvent("quote", 30)).toEqual({ type: "SetTextSource", source: { kind: "quote" } });
  });

  it("« words » (bascule sans longueur précise) : reprend le repli fourni", () => {
    expect(textSourceEvent("words", 50)).toEqual({
      type: "SetTextSource",
      source: { kind: "words", count: 50 },
    });
  });

  it("une longueur cliquée l'emporte sur le repli", () => {
    expect(textSourceEvent("15", 50)).toEqual({
      type: "SetTextSource",
      source: { kind: "words", count: 15 },
    });
  });
});

describe("spamWordEvent — l'événement du champ Mot de Spam (issue #131)", () => {
  it("les espaces sont retirés : « deux mots » devient « deuxmots »", () => {
    expect(spamWordEvent("deux mots")).toEqual({ type: "SetSpamWord", word: "deuxmots" });
  });

  it("vidé (ou tout-espaces) : retour au mot par défaut, `null`", () => {
    expect(spamWordEvent("")).toEqual({ type: "SetSpamWord", word: null });
    expect(spamWordEvent("   ")).toEqual({ type: "SetSpamWord", word: null });
  });

  it("un mot sans espace passe tel quel", () => {
    expect(spamWordEvent("go")).toEqual({ type: "SetSpamWord", word: "go" });
  });
});

describe("activityExtra — l'état de Race traduit en Rich Presence (party + timestamps)", () => {
  const base = {
    ...initialRaceState(),
    players: [
      { playerId: "a", displayName: "A", avatarHash: null, ready: false },
      { playerId: "b", displayName: "B", avatarHash: null, ready: false },
    ],
    maxPlayers: 8,
  };

  it("hors course : l'effectif et « En attente », jamais de rebours", () => {
    const e = activityExtra({ ...base, phase: "lobby" });
    expect(e).toEqual({ party: [2, 8], state: "En attente" });
  });

  it("l'effectif compte les PRÉSENTS, pas les partants figés au RaceStart", () => {
    // 2 présents, 1 seul partant : c'est « reste-t-il une place » que la présence dit.
    const e = activityExtra({ ...base, phase: "running", racers: [base.players[0]] });
    expect(e.party).toEqual([2, 8]);
  });

  it("course normale : la ligne libre porte la Source de texte", () => {
    const e = activityExtra({ ...base, phase: "running", textSource: { kind: "words", count: 30 } });
    expect(e).toEqual({ party: [2, 8], state: "Mots (30)" });
  });

  it("floor is lava : « Survie », et surtout AUCUN rebours — le mode n'a pas de fin prévisible", () => {
    const e = activityExtra({ ...base, phase: "running", gameMode: "floorIsLava" });
    expect(e.state).toBe("Survie");
    expect(e.endsAt).toBeUndefined();
  });

  it("spam : le mot spammé, et un rebours calé sur le plafond de temps", () => {
    const e = activityExtra(
      { ...base, phase: "running", gameMode: "spam", spamWord: "banane", spamTimeCapS: 30 },
      1_000_000,
    );
    expect(e).toEqual({ party: [2, 8], state: "« banane »", endsAt: 1_030_000 });
  });

  it("spam sans mot choisi : on ne rend pas « « null » »", () => {
    const e = activityExtra({ ...base, phase: "running", gameMode: "spam", spamWord: null });
    expect(e.state).toBe("Mode Spam");
  });

  it("aucune party.id nulle part : un Code de partie ne doit pas fuiter dans une présence publique", () => {
    for (const phase of ["lobby", "running"] as const) {
      expect(activityExtra({ ...base, phase, code: "A7K2M" })).not.toHaveProperty("id");
    }
  });
});
