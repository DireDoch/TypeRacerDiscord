// =============================================================================
//  net.ts — transport WebSocket de la Race (Phase 2). Miroir de ws/protocol.rs.
//
//  Fin et sans état métier : (dé)sérialise les events typés et expose un callback.
//  L'orchestrateur de Race (ui/race.ts) porte la logique ; ici, juste le fil.
//  Wire JSON internally-tagged, ex. { "type": "JoinRoom", "channelId": "123" }.
// =============================================================================

import type { Keystroke } from "./types";

/** Client → Serveur. */
export type ClientEvent =
  | { type: "JoinRoom"; channelId: string }
  | { type: "StartRace" } // owner uniquement (le serveur rejette les autres)
  | { type: "Progress"; charsDone: number }
  // Le serveur possède seed/texte/config : Finish n'envoie que le log + la durée.
  | { type: "Finish"; keystrokes: Keystroke[]; endedAtMs: number }
  | { type: "LeaveRoom" };

/** Serveur → Client. */
export type ServerEvent =
  | { type: "RoomState"; players: string[]; owner: string; seed: number; targetText: string }
  | { type: "RaceStart"; startAtEpochMs: number }
  | { type: "PlayerProgress"; playerId: string; charsDone: number }
  | { type: "PlayerFinished"; playerId: string; wpm: number }
  | { type: "RaceOver"; ranking: string[] };

/** Connexion à `/ws`. `token` sert d'identité (résolue serveur, jamais dans le corps). */
export class RaceSocket {
  private ws: WebSocket;

  /** `basePath` : "/.proxy" dans l'iframe Discord (CSP), "" partout ailleurs. */
  constructor(token: string, onEvent: (e: ServerEvent) => void, basePath = "") {
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
