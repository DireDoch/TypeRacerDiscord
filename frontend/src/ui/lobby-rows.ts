// =============================================================================
//  ui/lobby-rows.ts — les Réglages de salon du lobby, déclarés et rendus (#131, #203).
//
//  Le pendant CLIENT de `ws/room_setting.rs` : là-bas une variante `RoomSetting` par
//  Réglage, ici une entrée de `lobbyRows()`. AJOUTER UN RÉGLAGE : une ligne de plus dans
//  `lobbyRows`, une explication dans `LOBBY_TIPS`, rien d'autre à toucher — le rendu
//  (`lobbyRowHtml`) et le câblage (`wireLobbySettings`, dans `race.ts`) sont génériques.
//
//  Tout est PUR : `lobbyRows` prend l'état de Race et l'identité du lecteur, et rend un
//  tableau. Aucun `this`, aucun DOM, aucun socket — c'est ce qui rend testable la
//  question « quels Réglages, à qui, dans quel état », qui ne l'était pas quand la table
//  était une méthode privée de la classe `Race` (#203).
// =============================================================================

import {
  COUNTDOWN_VALUES,
  LAVA_INTERVAL_VALUES,
  ROOM_DIFFICULTIES,
  ROOM_SIZES,
  SPAM_THRESHOLD_VALUES,
  SPAM_TIME_CAP_VALUES,
  SPAM_WORD_MAX_LEN,
  WORDS_LENGTHS,
  type ClientEvent,
  type Difficulty,
  type GameMode,
  type TextSource,
} from "../core/net";
import type { RaceState } from "../core/race-state";
import { DIFFICULTY_LABELS, GAME_MODES, GAME_MODE_LABELS } from "./mode-labels";
import { infoHtml } from "./info-bubble";
import { escapeText } from "./typing-zone";

// ----------------------------------------------------------------------------
//  Modèle de ligne (issue #131) — sur le patron de settings.ts, adapté à la disposition
//  du lobby (icône « i » plutôt que description toujours visible : le lobby est un
//  panneau compact à côté de la piste, pas un écran dédié).
// ----------------------------------------------------------------------------

/** Une paire valeur/libellé, pour les options d'un `select` ou d'un groupe segmenté. */
interface LobbyOption {
  value: string;
  label: string;
}

/**
 * Quatre familles suffisent à tous les Réglages de salon actuels — `text` est le
 * cinquième kind que `settings.ts` n'a pas (le mot de Spam) : né ici, comme les autres
 * sont nés de leur première Preference (issue #131).
 *
 * `segmented.extra` : un second groupe de boutons, sous le premier, dans le MÊME contrôle
 * — le seul besoin actuel est Texte (la longueur, seulement sous « Mots »). Généraliser un
 * champ optionnel plutôt qu'un kind à part évite de dupliquer tout le reste de la ligne
 * (label, tip, locked) pour un contrôle qui reste sémantiquement UNE seule ligne.
 */
export type LobbyControl =
  | { kind: "select"; value: string; options: LobbyOption[] }
  | { kind: "segmented"; value: string; options: LobbyOption[]; extra?: { value: string; options: LobbyOption[] } }
  | { kind: "toggle"; value: boolean; onLabel: string; offLabel: string }
  | { kind: "text"; value: string; placeholder: string; maxLength: number };

/**
 * Une ligne de Réglage de salon : libellé + explication + contrôle, la règle « lecture
 * seule pour les non-hôtes » (`locked`) et l'événement à émettre (`set`) — déclarée une
 * fois, plus une méthode de rendu ET un bloc de câblage par réglage (issue #131).
 */
export interface LobbyRow {
  /** DOM id du contrôle ET clé que le délégué unique lit dans `data-row`. */
  id: string;
  label: string;
  tip: string;
  locked: boolean;
  /** Mention affichée à la place du contrôle quand `locked`. */
  readOnly: string;
  control: LobbyControl;
  /** Complément affiché après le contrôle, propriétaire seulement (ex. « 6 présents »). */
  note?: string;
  set: (raw: string) => ClientEvent;
}

/** Un groupe de boutons segmentés — Texte en superpose deux dans le même contrôle. */
function lobbySegHtml(rowId: string, value: string, options: LobbyOption[]): string {
  return `<div class="lobby-seg">${options
    .map(
      (o) =>
        `<button data-row="${rowId}" data-value="${o.value}"${o.value === value ? ' class="on"' : ""}>${o.label}</button>`,
    )
    .join("")}</div>`;
}

function lobbyControlHtml(row: LobbyRow): string {
  const c = row.control;
  switch (c.kind) {
    case "select": {
      const opts = c.options
        .map((o) => `<option value="${o.value}"${o.value === c.value ? " selected" : ""}>${o.label}</option>`)
        .join("");
      return `<select id="${row.id}" data-row="${row.id}">${opts}</select>`;
    }
    case "segmented":
      return lobbySegHtml(row.id, c.value, c.options) + (c.extra ? lobbySegHtml(row.id, c.extra.value, c.extra.options) : "");
    case "toggle":
      // La case n'est pas une checkbox nue : `.lobby-check` lui donne la même bordure et
      // le même fond que les `select` voisins (#95). L'input reste natif dessous.
      return `<label class="lobby-check">
        <input type="checkbox" id="${row.id}" data-row="${row.id}"${c.value ? " checked" : ""}>
        <span>${c.value ? c.onLabel : c.offLabel}</span>
      </label>`;
    case "text":
      // `maxlength` natif plutôt qu'un compteur en JS : le navigateur fait déjà respecter
      // la longueur, et le serveur revalide de toute façon (le champ n'est pas une garantie).
      return `<input type="text" id="${row.id}" data-row="${row.id}" value="${escapeText(c.value)}"
        placeholder="${escapeText(c.placeholder)}" maxlength="${c.maxLength}" autocomplete="off">`;
  }
}

/**
 * Une ligne de Réglage de salon (#95) : libellé + icône « i » à gauche, contrôle à droite.
 * Ce patron unique est ce qui ALIGNE les réglages — avant, chacun réutilisait `.hint`
 * (pensée pour un paragraphe centré isolé) et retombait où il pouvait.
 *
 * Les non-hôtes reçoivent la valeur en lecture seule dans la même colonne, à la même
 * place, avec la même explication : ils subissent le réglage, ils doivent le comprendre.
 *
 * Le libellé pointe son contrôle par `for=` sauf pour un `toggle` (son `<label>` enveloppe
 * déjà sa case) et un `segmented` (des boutons, pas un champ de formulaire) — et jamais en
 * lecture seule, où il n'y a plus de contrôle à pointer. Pure.
 */
export function lobbyRowHtml(row: LobbyRow): string {
  const selfLabeled = row.locked || row.control.kind === "toggle" || row.control.kind === "segmented";
  const name = selfLabeled
    ? `<span>${escapeText(row.label)}</span>`
    : `<label for="${row.id}">${escapeText(row.label)}</label>`;
  const ctl = row.locked
    ? `<span class="lobby-value">${escapeText(row.readOnly)}</span>`
    : lobbyControlHtml(row) + (row.note ? `<span class="lobby-note">${escapeText(row.note)}</span>` : "");
  // L'explication vit dans `ui/info-bubble.ts` depuis #180 : la barre de config solo
  // en avait besoin à l'identique, et la recopier aurait fait diverger les deux.
  return `<div class="lobby-row">
    <div class="lobby-key">${name}${infoHtml(row.label, row.tip)}</div>
    <div class="lobby-ctl">${ctl}</div>
  </div>`;
}

/** Longueur à reprendre quand on (re)passe sur `words`. Médiane par défaut. */
export function currentCount(src: TextSource): number {
  return src.kind === "words" ? src.count : WORDS_LENGTHS[1];
}

/** Mention lue par les non-hôtes : ils subissent le réglage, ils doivent le voir. */
export function sourceLabel(src: TextSource): string {
  return src.kind === "quote" ? "Citation" : `Mots (${src.count})`;
}

/**
 * `ClientEvent` du contrôle segmenté « Texte » (issue #131) — un délégué générique lit une
 * valeur brute, seule cette ligne sait la traduire. `v` vaut "quote", "words" (bascule
 * sans longueur précise — `fallbackCount` reprend la longueur courante, la médiane venant
 * d'une Citation qui n'en a pas), ou une longueur cliquée dans le second groupe. Pure.
 */
export function textSourceEvent(v: string, fallbackCount: number): ClientEvent {
  if (v === "quote") return { type: "SetTextSource", source: { kind: "quote" } };
  if (v === "words") return { type: "SetTextSource", source: { kind: "words", count: fallbackCount } };
  return { type: "SetTextSource", source: { kind: "words", count: Number(v) } };
}

/**
 * `ClientEvent` du champ « Mot » de Spam (issue #131). Vidé = retour au mot par défaut.
 * Les espaces sont retirés pour que « deux mots » devienne « deuxmots » plutôt que d'être
 * rejeté en silence par le serveur, qui reste seul juge (il revalide, longueur comprise). Pure.
 */
export function spamWordEvent(v: string): ClientEvent {
  const word = v.replace(/\s+/g, "");
  return { type: "SetSpamWord", word: word === "" ? null : word };
}

/** Libellés des trois longueurs, dans l'ordre de `WORDS_LENGTHS`. */
const LENGTH_LABELS = ["Court", "Normal", "Long"] as const;

/**
 * Explications des Réglages de salon (#95), servies par l'icône « i ». Depuis #131 c'est
 * `lobbyRows()` qui les associe à leur ligne — elles vivent ici, à part, seulement parce
 * que ce sont de longs paragraphes qui alourdiraient la déclaration si on les y recopiait.
 */
const LOBBY_TIPS = {
  source:
    "Le texte à taper pendant la course : une Citation (longueur aléatoire) ou des Mots générés (Court 15 / Normal 30 / Long 50).",
  size: "Nombre maximum de joueurs admis dans ce salon, de 2 à 8. Une fois atteint, la Room affiche complet.",
  countdown:
    "Durée du compte à rebours (3, 5, 7 ou 10 s) entre « Démarrer la course » et le premier mot à taper.",
  ready:
    "Quand activé, chaque joueur doit se déclarer prêt avant que l'hôte puisse démarrer la course.",
  difficulty:
    "Normal : aucune contrainte. Master : la course s'arrête au tout premier caractère mal tapé (avant toute correction possible) — le joueur est classé échec, la course se débloque immédiatement pour les autres.",
  gameMode:
    "Comment la course se gagne. Normal : le premier à taper tout le texte. Floor is lava : le joueur le moins avancé brûle à intervalle régulier, et le dernier vivant gagne. Spam : un seul mot, répété sans fin — gagne qui atteint le premier le nombre de répétitions visé, ou qui en a le plus quand le temps est écoulé.",
  lava:
    "Toutes les combien de secondes le joueur le moins avancé est éliminé. La première élimination tombe au bout d'un intervalle complet, jamais avant.",
  spamWord:
    "Le mot à répéter. Laissé vide, il est tiré au hasard à chaque manche. Sinon : pas d'espace (ce serait deux mots), 20 caractères au plus — chiffres et ponctuation acceptés.",
  spamThreshold:
    "Combien de répétitions correctes il faut verrouiller pour gagner sur-le-champ. Un mot mal tapé ne compte pas ; effacer une répétition la décompte.",
  spamTimeCap:
    "Temps maximum de la course. S'il s'écoule avant que quiconque ait atteint l'objectif, c'est celui qui a le plus de répétitions correctes qui gagne.",
} as const;

/**
 * Les Réglages de salon offerts par CE lobby, dans l'ordre d'affichage (#131, #203).
 *
 * `me` sert uniquement à `locked` : la garde owner-only de CONTEXT.md est la même que
 * celle du serveur (`apply_setting`), et elle est posée ici une fois par ligne — un
 * non-hôte voit tout, en lecture seule, jamais un panneau vide.
 *
 * L'ORDRE DE LA LISTE EST L'ORDRE D'AFFICHAGE — Mode de jeu d'abord (c'est lui qui décide
 * des suivantes), puis les réglages propres à un Mode de jeu, puis Texte, puis les quatre
 * réglages communs.
 *
 * Les lignes conditionnelles suivent le Mode de jeu : la Source de texte est INERTE sous
 * Floor is lava et Spam (chacun impose son texte, ADR 0015/0016), donc elle disparaît
 * plutôt que de mentir ; les réglages d'un Mode de jeu n'apparaissent que sous lui. Pure.
 */
export function lobbyRows(state: RaceState, me: string): LobbyRow[] {
  const isOwner = me === state.owner;
  const rows: LobbyRow[] = [
    {
      id: "raceGameMode",
      label: "Mode de jeu",
      tip: LOBBY_TIPS.gameMode,
      locked: !isOwner,
      readOnly: GAME_MODE_LABELS[state.gameMode],
      control: {
        kind: "select",
        value: state.gameMode,
        options: GAME_MODES.map((m) => ({ value: m, label: GAME_MODE_LABELS[m] })),
      },
      set: (v) => ({ type: "SetGameMode", mode: v as GameMode }),
    },
  ];
  if (state.gameMode === "floorIsLava") {
    rows.push({
      id: "lavaInterval",
      label: "Élimination",
      tip: LOBBY_TIPS.lava,
      locked: !isOwner,
      readOnly: `toutes les ${state.lavaIntervalS} s`,
      control: {
        kind: "select",
        value: String(state.lavaIntervalS),
        options: LAVA_INTERVAL_VALUES.map((n) => ({ value: String(n), label: `toutes les ${n} s` })),
      },
      set: (v) => ({ type: "SetLavaInterval", seconds: Number(v) }),
    });
  }
  if (state.gameMode === "spam") {
    // Le mot RÉELLEMENT en jeu est celui du texte : sous mot par défaut, `spamWord` est
    // `null` et seul `targetText` sait lequel le serveur a tiré.
    const inPlay = state.targetWords[0] ?? "";
    rows.push(
      {
        id: "spamWord",
        label: "Mot",
        tip: LOBBY_TIPS.spamWord,
        locked: !isOwner,
        readOnly: inPlay,
        control: {
          kind: "text",
          value: state.spamWord ?? "",
          placeholder: `${inPlay} (aléatoire)`,
          maxLength: SPAM_WORD_MAX_LEN,
        },
        set: spamWordEvent,
      },
      {
        id: "spamThreshold",
        label: "Objectif",
        tip: LOBBY_TIPS.spamThreshold,
        locked: !isOwner,
        readOnly: `${state.spamThreshold} répétitions`,
        control: {
          kind: "select",
          value: String(state.spamThreshold),
          options: SPAM_THRESHOLD_VALUES.map((n) => ({ value: String(n), label: `${n} répétitions` })),
        },
        set: (v) => ({ type: "SetSpamThreshold", count: Number(v) }),
      },
      {
        id: "spamTimeCap",
        label: "Temps max",
        tip: LOBBY_TIPS.spamTimeCap,
        locked: !isOwner,
        readOnly: `${state.spamTimeCapS} s`,
        control: {
          kind: "select",
          value: String(state.spamTimeCapS),
          options: SPAM_TIME_CAP_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
        },
        set: (v) => ({ type: "SetSpamTimeCap", seconds: Number(v) }),
      },
    );
  }
  if (state.gameMode === "normal") {
    const src = state.textSource;
    rows.push({
      id: "textSource",
      label: "Texte",
      tip: LOBBY_TIPS.source,
      locked: !isOwner,
      readOnly: sourceLabel(src),
      control: {
        kind: "segmented",
        value: src.kind,
        options: [
          { value: "quote", label: "Citation" },
          { value: "words", label: "Mots" },
        ],
        // La longueur n'existe que pour `words` — celle d'une Quote lui appartient.
        extra:
          src.kind === "words"
            ? {
                value: String(src.count),
                options: WORDS_LENGTHS.map((n, i) => ({ value: String(n), label: `${LENGTH_LABELS[i]} ${n}` })),
              }
            : undefined,
      },
      // `currentCount(src)` : le repli quand on bascule sur « Mots » sans avoir cliqué une
      // longueur précise (garde la longueur courante, ou la médiane si on vient de
      // Citation, qui n'en a pas).
      set: (v) => textSourceEvent(v, currentCount(src)),
    });
  }
  rows.push(
    {
      id: "maxPlayers",
      label: "Salon",
      tip: LOBBY_TIPS.size,
      locked: !isOwner,
      readOnly: `${state.players.length}/${state.maxPlayers} joueurs`,
      note: isOwner ? `${state.players.length} présents` : undefined,
      control: {
        kind: "select",
        value: String(state.maxPlayers),
        options: ROOM_SIZES.map((n) => ({ value: String(n), label: `${n} joueurs` })),
      },
      set: (v) => ({ type: "SetMaxPlayers", max: Number(v) }),
    },
    {
      id: "raceCountdown",
      label: "Décompte",
      tip: LOBBY_TIPS.countdown,
      locked: !isOwner,
      readOnly: `${state.countdownS} s`,
      control: {
        kind: "select",
        value: String(state.countdownS),
        options: COUNTDOWN_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
      },
      set: (v) => ({ type: "SetCountdown", seconds: Number(v) }),
    },
    {
      id: "readyCheck",
      label: "Ready-check",
      tip: LOBBY_TIPS.ready,
      locked: !isOwner,
      readOnly: state.readyCheck ? "Activé" : "Désactivé",
      control: { kind: "toggle", value: state.readyCheck, onLabel: "Activé", offLabel: "Désactivé" },
      set: (v) => ({ type: "SetReadyCheck", enabled: v === "true" }),
    },
    {
      id: "raceDifficulty",
      label: "Difficulté",
      tip: LOBBY_TIPS.difficulty,
      locked: !isOwner,
      readOnly: DIFFICULTY_LABELS[state.difficulty],
      control: {
        kind: "select",
        value: state.difficulty,
        options: ROOM_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })),
      },
      set: (v) => ({ type: "SetDifficulty", difficulty: v as Difficulty }),
    },
  );
  return rows;
}
