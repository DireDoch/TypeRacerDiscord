// =============================================================================
//  net.ts — transport WebSocket de la Race (Phase 2). Miroir de ws/protocol.rs.
//
//  Fin et sans état métier : (dé)sérialise les events typés et expose un callback.
//  L'orchestrateur de Race (ui/race.ts) porte la logique ; ici, juste le fil.
//  Wire JSON internally-tagged, ex. { "type": "JoinRoom", "channelId": "123" }.
// =============================================================================

import type { Keystroke } from "./types";

/**
 * D'où vient le texte d'une Race (ADR 0009). Ce n'est PAS un Mode : la règle de fin
 * d'une Race est toujours « le texte entier, exactement », quelle que soit la Source.
 * Le recompute autoritaire reste `Words` dans les deux cas.
 */
export type TextSource = { kind: "quote" } | { kind: "words"; count: number };

/** Les trois seules longueurs que le serveur accepte — il refuse tout le reste. */
export const WORDS_LENGTHS = [15, 30, 50] as const;

/**
 * La Display identity annoncée à la Room. `playerId` reste la vérité durable (il possède
 * les Runs) ; le reste n'est que la façon de le dessiner — jamais vérifiée, jamais
 * persistée. L'avatar voyage en **hash**, jamais en URL : voir `discord.ts:avatarUrl`.
 */
export interface Identity {
  displayName: string;
  avatarHash: string | null;
}

/** Un présent, tel que la piste et le podium le dessinent. */
export interface PlayerEntry extends Identity {
  playerId: string;
}

/**
 * Client → Serveur.
 *
 * Trois portes d'entrée plutôt qu'un `JoinRoom` générique (ADR 0008) : elles n'ont pas
 * les mêmes droits de création côté serveur, et cette différence mérite d'être lisible
 * sur le fil plutôt que devinée à la longueur de la clé.
 */
export type ClientEvent =
  // Room du salon vocal : CRÉÉE à la volée. La clé vient du SDK, elle est authentique.
  | { type: "JoinChannel"; channelId: string; identity: Identity }
  // Room à Code de partie : le serveur tire le code et le renvoie dans le RoomState.
  | { type: "CreateRoom"; identity: Identity }
  // Room à Code de partie : ne crée JAMAIS. Code inconnu → RoomNotFound.
  | { type: "JoinCode"; code: string; identity: Identity }
  // owner uniquement, hors course (le serveur rejette le reste, longueur comprise)
  | { type: "SetTextSource"; source: TextSource }
  | { type: "StartRace" } // owner uniquement (le serveur rejette les autres)
  | { type: "Progress"; charsDone: number }
  // Le serveur possède seed/texte/config : Finish n'envoie que le log + la durée.
  | { type: "Finish"; keystrokes: Keystroke[]; endedAtMs: number }
  | { type: "LeaveRoom" };

/** Serveur → Client. */
export type ServerEvent =
  | {
      type: "RoomState";
      players: PlayerEntry[];
      owner: string;
      seed: number;
      targetText: string;
      /** Code de partie de la Room, `null` pour une Room de salon vocal. */
      code: string | null;
      /** Source EFFECTIVE du texte affiché : un repli après échec du proxy se lit ici. */
      textSource: TextSource;
    }
  | { type: "RaceStart"; startAtEpochMs: number }
  | { type: "PlayerProgress"; playerId: string; charsDone: number }
  | { type: "PlayerFinished"; playerId: string; wpm: number }
  | { type: "RaceOver"; ranking: string[] }
  // Échecs de jointure : envoyés au SEUL socket demandeur (aucune Room à qui diffuser).
  | { type: "RoomNotFound" }
  | { type: "RoomFull" };

/** Miroir de `ws/mod.rs` : alphabet d'un Code de partie, sans ambiguïté visuelle. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LEN = 5;

/**
 * Normalise une saisie de Code de partie : majuscules, caractères hors alphabet retirés,
 * tronqué à `CODE_LEN`. Le champ n'accepte donc jamais un code que le serveur ne pourrait
 * pas avoir tiré, et « rejoindre » ne s'active qu'à `CODE_LEN` exactement. Pure.
 */
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LEN);
}

/** Connexion à `/ws`. `token` sert d'identité (résolue serveur, jamais dans le corps). */
export class RaceSocket {
  private ws: WebSocket;

  /** `basePath` : "/.proxy" dans l'iframe Discord (CSP), "" partout ailleurs — voir
   *  `discord.ts:proxyBase()`. Pas de défaut : l'oublier casserait silencieusement
   *  dans l'iframe (CSP), donc chaque appelant le passe explicitement. */
  constructor(token: string, onEvent: (e: ServerEvent) => void, basePath: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(
      `${proto}://${location.host}${basePath}/ws?token=${encodeURIComponent(token)}`,
    );
    this.ws.onmessage = (m) => onEvent(JSON.parse(m.data) as ServerEvent);
  }

  /** Résout quand la connexion est ouverte (ou rejette si l'ouverture échoue). */
  ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("WS: ouverture échouée")), { once: true });
    });
  }

  send(e: ClientEvent): void {
    this.ws.send(JSON.stringify(e));
  }

  close(): void {
    this.ws.close();
  }
}
