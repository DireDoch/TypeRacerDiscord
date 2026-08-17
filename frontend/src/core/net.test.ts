import { describe, it, expect } from "vitest";
import {
  normalizeCode,
  CODE_ALPHABET,
  CODE_LEN,
  COUNTDOWN_VALUES,
  LAVA_INTERVAL_VALUES,
  ROOM_DIFFICULTIES,
  ROOM_SIZES,
  SPAM_THRESHOLD_VALUES,
  SPAM_TIME_CAP_VALUES,
  SPAM_WORD_MAX_LEN,
  WORDS_LENGTHS,
} from "./net";
import { initialRaceState } from "./race-state";
import roomSettings from "../../../test-vectors/room-settings.json";

describe("normalizeCode — saisie d'un Code de partie", () => {
  it("met en majuscules (un code se dicte, il s'entend sans casse)", () => {
    expect(normalizeCode("k7m2q")).toBe("K7M2Q");
  });

  it("retire les caractères que le serveur ne peut pas avoir tirés", () => {
    // 0, O, 1, I, L sont hors alphabet : ambigus à l'oral comme à l'écrit.
    expect(normalizeCode("K0O1IL")).toBe("K");
    expect(normalizeCode("K7-M2 Q")).toBe("K7M2Q");
  });

  it("tronque à CODE_LEN — un collage trop long ne bloque pas le champ", () => {
    expect(normalizeCode("K7M2QZZZ")).toHaveLength(CODE_LEN);
  });

  it("ne produit jamais que des caractères de l'alphabet", () => {
    const out = normalizeCode("aB3$éz9L1O0");
    expect([...out].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
  });

  it("un code incomplet reste incomplet (le bouton Rejoindre s'y adosse)", () => {
    expect(normalizeCode("K7M").length).toBeLessThan(CODE_LEN);
    expect(normalizeCode("")).toBe("");
  });
});

// --- Réglages de salon : parité avec le serveur (issue #202) -------------------
//
// Les constantes ci-dessous portent toutes le commentaire « Miroir de `ws/mod.rs` » et
// ont été recopiées à la main. Le vecteur est maintenant l'autorité, et
// `backend/src/ws/room_setting.rs` lit le MÊME fichier : un palier changé d'un seul côté
// fait échouer les deux CI.
//
// L'enjeu n'est pas cosmétique : le client OFFRE ces valeurs, le serveur les REVALIDE.
// Quand les deux divergent, `apply_setting` répond `Rejected` sans aucun événement de
// retour — le joueur clique, rien ne bouge, et rien n'est journalisé nulle part.

describe("Réglages de salon — les paliers offerts sont exactement ceux du serveur", () => {
  const d = roomSettings.domains;

  it("les longueurs de la Source Mots (ADR 0009)", () => {
    expect([...WORDS_LENGTHS]).toEqual(d.wordsLengths);
  });

  it("les tailles de Room", () => {
    expect([...ROOM_SIZES]).toEqual(d.maxPlayers);
  });

  it("les durées de décompte (ADR 0007)", () => {
    expect([...COUNTDOWN_VALUES]).toEqual(d.countdown);
  });

  it("les intervalles d'élimination (ADR 0015)", () => {
    expect([...LAVA_INTERVAL_VALUES]).toEqual(d.lavaInterval);
  });

  it("les seuils et plafonds de Spam (ADR 0016)", () => {
    expect([...SPAM_THRESHOLD_VALUES]).toEqual(d.spamThreshold);
    expect([...SPAM_TIME_CAP_VALUES]).toEqual(d.spamTimeCap);
    expect(SPAM_WORD_MAX_LEN).toBe(roomSettings.spamWord.maxLen);
  });

  it("les Difficultés — Expert n'est pas un Réglage de salon (ADR 0013)", () => {
    expect(ROOM_DIFFICULTIES).toEqual(d.difficulties);
    expect(ROOM_DIFFICULTIES).not.toContain("expert");
  });
});

describe("Réglages de salon — les replis affichés avant le premier RoomState", () => {
  // #185 a fait passer le décompte de 7 à 5 s côté serveur ; trois endroits du client
  // disaient encore 7, et le lobby affichait donc 7 puis sautait à 5. Le repli n'a plus
  // qu'un seul endroit (`initialRaceState`), et le vecteur le tient.

  it("l'état initial de Race porte les défauts d'une Room neuve", () => {
    const s = initialRaceState();
    const def = roomSettings.defaults;
    expect(s.countdownS).toBe(def.countdown);
    expect(s.maxPlayers).toBe(def.maxPlayers);
    expect(s.lavaIntervalS).toBe(def.lavaInterval);
    expect(s.spamThreshold).toBe(def.spamThreshold);
    expect(s.spamTimeCapS).toBe(def.spamTimeCap);
    expect(s.difficulty).toBe(def.difficulty);
    expect(s.gameMode).toBe(def.gameMode);
    expect(s.readyCheck).toBe(def.readyCheck);
    expect(s.spamWord).toBe(def.spamWord);
  });

  it("le repli du décompte est un palier que le serveur accepte", () => {
    expect(COUNTDOWN_VALUES).toContain(initialRaceState().countdownS);
  });
});
