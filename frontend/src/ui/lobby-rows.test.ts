// =============================================================================
//  ui/lobby-rows.test.ts — les Réglages de salon : la table ET son rendu (#131, #203).
//
//  Avant #203, seul le RENDU d'une ligne était testé (`lobbyRowHtml`, sur une ligne
//  fabriquée dans le test) : la table vivait dans une méthode privée de `Race`. Les
//  derniers `describe` couvrent ce qui manquait — quelles lignes existent, pour qui,
//  et quel `ClientEvent` chacune émet.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  lobbyRows,
  lobbyRowHtml,
  sourceLabel,
  currentCount,
  textSourceEvent,
  spamWordEvent,
  type LobbyRow,
} from "./lobby-rows";
import { initialRaceState, type RaceState } from "../core/race-state";
import {
  COUNTDOWN_VALUES,
  LAVA_INTERVAL_VALUES,
  ROOM_SIZES,
  SPAM_THRESHOLD_VALUES,
  SPAM_TIME_CAP_VALUES,
  WORDS_LENGTHS,
} from "../core/net";

/** Un lobby dont « moi » est l'hôte, sauf mention contraire. Une Room a TOUJOURS un
 *  texte dès qu'elle existe (le serveur en pose un à la création), d'où `targetWords`. */
function lobby(over: Partial<RaceState> = {}): RaceState {
  return {
    ...initialRaceState(),
    phase: "lobby",
    owner: "moi",
    targetWords: ["mot"],
    ...over,
  };
}

const idsOf = (state: RaceState, me = "moi"): string[] => lobbyRows(state, me).map((r) => r.id);

const rowOf = (state: RaceState, id: string, me = "moi"): LobbyRow => {
  const row = lobbyRows(state, me).find((r) => r.id === id);
  if (!row) throw new Error(`ligne absente : ${id}`);
  return row;
};

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

// --- La table elle-même (issue #203) ------------------------------------------
//
// Ce que `lobbyRowHtml` ne dit pas : QUELLES lignes existent, pour QUI, et quel
// `ClientEvent` chacune émet. Intestable tant que la table était une méthode privée
// de la classe `Race`.

describe("lobbyRows — la composition suit le Mode de jeu", () => {
  // Les Réglages qui ne dépendent d'aucun Mode de jeu : toujours là, dans cet ordre.
  const communs = ["raceGameMode", "maxPlayers", "raceCountdown", "readyCheck", "raceDifficulty"];

  it("Normal : la Source de texte est réglable, les Réglages de Mode de jeu sont absents", () => {
    const ids = idsOf(lobby({ gameMode: "normal" }));
    expect(ids).toContain("textSource");
    expect(ids).not.toContain("lavaInterval");
    expect(ids).not.toContain("spamWord");
    for (const id of communs) expect(ids).toContain(id);
  });

  it("Floor is lava : l'intervalle apparaît, la Source disparaît (inerte, ADR 0015)", () => {
    const ids = idsOf(lobby({ gameMode: "floorIsLava" }));
    expect(ids).toContain("lavaInterval");
    expect(ids).not.toContain("textSource");
    expect(ids).not.toContain("spamWord");
    for (const id of communs) expect(ids).toContain(id);
  });

  it("Spam : mot, objectif et plafond apparaissent, la Source disparaît (ADR 0016)", () => {
    const ids = idsOf(lobby({ gameMode: "spam" }));
    expect(ids).toEqual(
      expect.arrayContaining(["spamWord", "spamThreshold", "spamTimeCap"]),
    );
    expect(ids).not.toContain("textSource");
    expect(ids).not.toContain("lavaInterval");
    for (const id of communs) expect(ids).toContain(id);
  });

  it("le Mode de jeu est toujours la première ligne — c'est lui qui décide des suivantes", () => {
    for (const gameMode of ["normal", "floorIsLava", "spam"] as const) {
      expect(idsOf(lobby({ gameMode }))[0]).toBe("raceGameMode");
    }
  });

  it("aucun identifiant de ligne n'est en double (le délégué unique lit `data-row`)", () => {
    for (const gameMode of ["normal", "floorIsLava", "spam"] as const) {
      const ids = idsOf(lobby({ gameMode }));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("lobbyRows — la garde owner-only (CONTEXT.md) porte sur TOUTES les lignes", () => {
  it("l'hôte règle tout", () => {
    for (const gameMode of ["normal", "floorIsLava", "spam"] as const) {
      for (const row of lobbyRows(lobby({ gameMode }), "moi")) expect(row.locked).toBe(false);
    }
  });

  it("un non-hôte voit tout, en lecture seule — jamais un panneau vide", () => {
    for (const gameMode of ["normal", "floorIsLava", "spam"] as const) {
      const rows = lobbyRows(lobby({ gameMode }), "quelquun-dautre");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.locked).toBe(true);
        expect(row.readOnly).not.toBe("");
      }
    }
  });

  it("l'effectif présent n'est annoté que pour l'hôte", () => {
    const state = lobby();
    expect(rowOf(state, "maxPlayers").note).toBeDefined();
    expect(rowOf(state, "maxPlayers", "autre").note).toBeUndefined();
  });
});

describe("lobbyRows — chaque ligne émet son ClientEvent, avec le bon TYPE de valeur", () => {
  it("les Réglages numériques envoient des nombres, pas les chaînes du DOM", () => {
    expect(rowOf(lobby(), "maxPlayers").set("4")).toEqual({ type: "SetMaxPlayers", max: 4 });
    expect(rowOf(lobby(), "raceCountdown").set("10")).toEqual({ type: "SetCountdown", seconds: 10 });
    expect(rowOf(lobby({ gameMode: "floorIsLava" }), "lavaInterval").set("15")).toEqual({
      type: "SetLavaInterval",
      seconds: 15,
    });
    expect(rowOf(lobby({ gameMode: "spam" }), "spamThreshold").set("30")).toEqual({
      type: "SetSpamThreshold",
      count: 30,
    });
    expect(rowOf(lobby({ gameMode: "spam" }), "spamTimeCap").set("45")).toEqual({
      type: "SetSpamTimeCap",
      seconds: 45,
    });
  });

  it("le ready-check traduit la case cochée en booléen", () => {
    expect(rowOf(lobby(), "readyCheck").set("true")).toEqual({ type: "SetReadyCheck", enabled: true });
    expect(rowOf(lobby(), "readyCheck").set("false")).toEqual({ type: "SetReadyCheck", enabled: false });
  });

  it("le Mode de jeu et la Difficulté passent leur valeur telle quelle", () => {
    expect(rowOf(lobby(), "raceGameMode").set("spam")).toEqual({ type: "SetGameMode", mode: "spam" });
    expect(rowOf(lobby(), "raceDifficulty").set("master")).toEqual({
      type: "SetDifficulty",
      difficulty: "master",
    });
  });

  it("le mot de Spam affiché est celui RÉELLEMENT en jeu, pas le réglage", () => {
    // Mot par défaut : `spamWord` est `null` et seul le texte sait lequel a été tiré.
    const state = lobby({ gameMode: "spam", spamWord: null, targetWords: ["chat", "chat"] });
    expect(rowOf(state, "spamWord").readOnly).toBe("chat");
  });

  it("basculer sur Mots reprend la longueur courante, jamais 0", () => {
    const state = lobby({ textSource: { kind: "words", count: 50 } });
    expect(rowOf(state, "textSource").set("words")).toEqual({
      type: "SetTextSource",
      source: { kind: "words", count: 50 },
    });
  });
});

describe("lobbyRows — les options offertes sont exactement le domaine du serveur", () => {
  // Le pendant client de `RoomSetting::value_is_valid` : offrir une valeur hors palier la
  // ferait refuser en silence par `apply_setting` (aucun événement de retour).
  const valuesOf = (row: LobbyRow): string[] =>
    row.control.kind === "select" ? row.control.options.map((o) => o.value) : [];

  it("chaque select ne propose que des paliers acceptés", () => {
    expect(valuesOf(rowOf(lobby(), "maxPlayers"))).toEqual(ROOM_SIZES.map(String));
    expect(valuesOf(rowOf(lobby(), "raceCountdown"))).toEqual(COUNTDOWN_VALUES.map(String));
    expect(valuesOf(rowOf(lobby({ gameMode: "floorIsLava" }), "lavaInterval"))).toEqual(
      LAVA_INTERVAL_VALUES.map(String),
    );
    expect(valuesOf(rowOf(lobby({ gameMode: "spam" }), "spamThreshold"))).toEqual(
      SPAM_THRESHOLD_VALUES.map(String),
    );
    expect(valuesOf(rowOf(lobby({ gameMode: "spam" }), "spamTimeCap"))).toEqual(
      SPAM_TIME_CAP_VALUES.map(String),
    );
  });

  it("Expert n'est jamais proposé en Race (ADR 0013)", () => {
    expect(valuesOf(rowOf(lobby(), "raceDifficulty"))).not.toContain("expert");
  });

  it("la longueur de Mots ne propose que les trois longueurs acceptées (ADR 0009)", () => {
    const row = rowOf(lobby({ textSource: { kind: "words", count: 30 } }), "textSource");
    const extra = row.control.kind === "segmented" ? row.control.extra : undefined;
    expect(extra?.options.map((o) => Number(o.value))).toEqual([...WORDS_LENGTHS]);
  });

  it("sous Citation, aucune longueur n'est offerte — elle appartient à la citation", () => {
    const row = rowOf(lobby({ textSource: { kind: "quote" } }), "textSource");
    expect(row.control.kind === "segmented" && row.control.extra).toBeUndefined();
  });
});
