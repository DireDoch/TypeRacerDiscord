// =============================================================================
//  net.ts — transport WebSocket de la Race (Phase 2). Miroir de ws/protocol.rs.
//
//  Fin et sans état métier : (dé)sérialise les events typés et expose un callback.
//  L'orchestrateur de Race (ui/race.ts) porte la logique ; ici, juste le fil.
//  Wire JSON internally-tagged, ex. { "type": "JoinRoom", "channelId": "123" }.
// =============================================================================

import type { Keystroke, PerSecondPoint } from "./types";
import type { Difficulty } from "./difficulty";

export type { Difficulty };

/**
 * L'arrivée d'un partant, telle que le podium l'affiche (ADR 0010). Le serveur possédait
 * déjà tout ça et n'en gardait que le WPM ; il le transmet désormais d'un bloc, ce qui
 * permet au podium d'afficher le **Gap** et de déplier un graphe sans aucun aller-retour.
 */
export interface RaceResult {
  playerId: string;
  wpm: number;
  accuracy: number;
  durationMs: number;
  /** Abandon (ou déconnexion) : pas de série, donc pas de graphe à déplier. */
  forfeit: boolean;
  /** Échec Difficulté Master (issue #71, ADR 0013) — distinct d'un Abandon (involontaire),
   *  mêmes mécaniques par ailleurs. Pourcentage affiché (« failed (X%) »), jamais utilisé
   *  pour classer. `null` sinon, jamais en même temps que `forfeit`. */
  failedPercent: number | null;
  /** Brûlé en floor is lava (ADR 0015) : instant du décès, en ms depuis t=0. C'est ce qui
   *  CLASSE dans ce mode, et ce que le podium affiche en gros à la place du Gap — qui
   *  n'existe pas ici, personne ne franchissant la ligne. `null` = pas brûlé, donc le
   *  survivant ou n'importe quelle arrivée d'une Race normale. Un Brûlé porte un VRAI
   *  score partiel, contrairement à un Abandon ou à un Échec Master. */
  burnedAtMs: number | null;
  /** Répétitions correctes sous le Mode de jeu Spam (ADR 0016), recomptées par le SERVEUR
   *  sur le log contre sa propre copie du mot — jamais le compte déclaré en course. C'est
   *  ce qui CLASSE dans ce mode, et ce que le podium affiche en gros à la place du Gap.
   *  `null` hors Spam — et c'est aussi à ça que le podium reconnaît le mode, sans qu'aucun
   *  champ de mode n'ait à voyager jusqu'à lui (même astuce que `burnedAtMs`). */
  reps: number | null;
  perSecond: PerSecondPoint[];
}

/**
 * Le duel le plus serré d'une Race, rejoué au ralenti (ADR 0011). Le SERVEUR choisit la
 * paire (logique purement Rust) et n'envoie que ses **deux** logs, jamais les huit — le
 * client ne rejoue pas le choix, il reçoit le résultat. Les temps d'arrivée ne voyagent
 * pas : le client les dérive du dernier `t` de chaque log (l'arrivée EST la dernière frappe).
 */
export interface PlayOfTheGame {
  a: string;
  logA: Keystroke[];
  b: string;
  logB: Keystroke[];
}

/**
 * D'où vient le texte d'une Race (ADR 0009). Ce n'est PAS un Mode : la règle de fin
 * d'une Race est toujours « le texte entier, exactement », quelle que soit la Source.
 * Le recompute autoritaire reste `Words` dans les deux cas.
 */
export type TextSource = { kind: "quote" } | { kind: "words"; count: number };

/** Les trois seules longueurs que le serveur accepte — il refuse tout le reste. */
export const WORDS_LENGTHS = [15, 30, 50] as const;

/** Miroir de `ws/mod.rs` : tailles de Room réglables. 8 = plafond dur et défaut. */
export const ROOM_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;

/** Difficultés offertes comme Réglage de salon (ADR 0013) — Expert exclu, sa condition
 *  de déclenchement y est inatteignable (voir `ws/mod.rs::set_difficulty`). */
export const ROOM_DIFFICULTIES: Difficulty[] = ["normal", "master"];

/** Miroir de `ws/mod.rs` : durées de décompte réglables (ADR 0007). 7 = défaut. */
export const COUNTDOWN_VALUES = [3, 5, 7, 10] as const;

/**
 * Comment une Race se GAGNE (ADR 0015). Ni un Mode (solo, décide du texte), ni une Source
 * de texte, ni une Difficulté (condition d'échec INDIVIDUELLE — l'élimination, elle, est
 * comparative). Un seul à la fois : ce sont des règles de victoire, elles ne se cumulent pas.
 */
export type GameMode = "normal" | "floorIsLava" | "spam";

/** Miroir de `ws/mod.rs` : intervalles d'élimination réglables. 10 = défaut. */
export const LAVA_INTERVAL_VALUES = [5, 10, 15, 20] as const;

/** Miroir de `ws/mod.rs` : seuils de répétitions réglables en Spam. 20 = défaut. */
export const SPAM_THRESHOLD_VALUES = [10, 20, 30, 50] as const;

/** Miroir de `ws/mod.rs` : plafonds de temps réglables en Spam, plafonnés à 60 s
 *  (ADR 0016) — au-delà, la seconde façon de gagner cesse d'en être une. 30 = défaut. */
export const SPAM_TIME_CAP_VALUES = [15, 30, 45, 60] as const;

/** Miroir de `ws/mod.rs` : longueur max d'un mot personnalisé. Le serveur revalide. */
export const SPAM_WORD_MAX_LEN = 20;

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
  /** Prêt pour le ready-check (issue #63). Sans objet quand le réglage est désactivé. */
  ready: boolean;
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
  // owner uniquement, hors course, 2–8 (le serveur rejette le reste)
  | { type: "SetMaxPlayers"; max: number }
  // owner uniquement, hors course, 3/5/7/10 (le serveur rejette le reste)
  | { type: "SetCountdown"; seconds: number }
  // owner uniquement, hors course. Vide les prêts déjà marqués (nouveau départ à zéro).
  | { type: "SetReadyCheck"; enabled: boolean }
  // n'importe quel présent, hors course. Sans effet sur StartRace si ready-check est off.
  | { type: "SetReady"; ready: boolean }
  // owner uniquement, hors course. Normal | Master seulement — Expert n'est pas un
  // Réglage de salon (ADR 0013), le serveur rejette toute autre valeur.
  | { type: "SetDifficulty"; difficulty: Difficulty }
  // owner uniquement, hors course (ADR 0015). Bascule le texte : floor is lava impose le sien.
  | { type: "SetGameMode"; mode: GameMode }
  // owner uniquement, hors course, 5/10/15/20 (le serveur rejette le reste). Inerte en normal.
  | { type: "SetLavaInterval"; seconds: number }
  // owner uniquement, hors course (ADR 0016). `null` = mot par défaut (tiré de la liste
  // de la Source `Mots`). Sinon un mot VALIDÉ côté serveur : non vide, sans espace,
  // ≤ 20 caractères — un espace ferait silencieusement plusieurs mots cibles.
  | { type: "SetSpamWord"; word: string | null }
  // owner uniquement, hors course, 10/20/30/50 (le serveur rejette le reste). Inerte hors spam.
  | { type: "SetSpamThreshold"; count: number }
  // owner uniquement, hors course, 15/30/45/60 (le serveur rejette le reste). Inerte hors spam.
  | { type: "SetSpamTimeCap"; seconds: number }
  | { type: "StartRace" } // owner uniquement (le serveur rejette les autres)
  // `reps` : répétitions correctes DÉCLARÉES sous Spam (ADR 0016), 0 partout ailleurs.
  // `charsDone` ne pourrait pas les porter — un mot faux avance les caractères sans être
  // une répétition. Déclaratif, mais il ne fait qu'ARRÊTER la course : le classement vient
  // du recompute serveur au Finish.
  | { type: "Progress"; charsDone: number; reps: number }
  // Le serveur possède seed/texte/config : Finish n'envoie que le log + la durée.
  | { type: "Finish"; keystrokes: Keystroke[]; endedAtMs: number }
  // Abandon VOLONTAIRE de la course en cours — le joueur RESTE au lobby (distinct de
  // LeaveRoom, qui quitte la Room). Enregistré comme une arrivée en abandon côté serveur.
  | { type: "Forfeit" }
  // Échec Difficulté Master détecté localement (ADR 0013) : le serveur REJOUE le log
  // contre SON texte avant d'y croire — jamais fait confiance sur la seule parole du client.
  | { type: "Fail"; keystrokes: Keystroke[] }
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
      /** Taille max courante de la Room — lue par TOUT le lobby, pas que par l'hôte. */
      maxPlayers: number;
      /** Durée du décompte avant le départ — lue par TOUT le lobby, pas que par l'hôte. */
      countdownS: number;
      /** Ready-check activé ou non. L'état "prêt" de chacun se lit sur `players[].ready`. */
      readyCheck: boolean;
      /** Difficulté de la Room (Normal | Master, issue #71, ADR 0013). */
      difficulty: Difficulty;
      /** Mode de jeu de la Room (ADR 0015) — lu par TOUT le lobby : il décide comment on gagne. */
      gameMode: GameMode;
      /** Intervalle d'élimination de floor is lava, en secondes. Inerte en `normal`. */
      lavaIntervalS: number;
      /** Mot personnalisé de Spam, ou `null` quand la Room utilise le mot par défaut. Le
       *  mot RÉELLEMENT en jeu se lit toujours dans `targetText` (il en est la répétition) ;
       *  ce champ ne dit que ce que l'hôte a choisi, pour redessiner son champ de saisie. */
      spamWord: string | null;
      /** Seuil de répétitions qui gagne la Race. Inerte hors `spam`. */
      spamThreshold: number;
      /** Plafond de temps de Spam, en secondes. Inerte hors `spam`. */
      spamTimeCapS: number;
    }
  | { type: "RaceStart"; startAtEpochMs: number }
  // `reps` porte le compte de répétitions sous Spam (ADR 0016), 0 partout ailleurs —
  // c'est ce que la piste affiche à la place du WPM dans ce mode.
  | { type: "PlayerProgress"; playerId: string; charsDone: number; reps: number }
  // `forfeit` : abandon — la piste affiche « abandon » plutôt que « 0 wpm ». `failedPercent`
  // (ADR 0013) affiche « échec (X%) » à la place — jamais les deux en même temps.
  | { type: "PlayerFinished"; playerId: string; wpm: number; forfeit: boolean; failedPercent: number | null }
  // Élimination floor is lava (ADR 0015). Diffusé AVANT que le log du brûlé n'arrive :
  // c'est ce message qui le lui demande, en lui disant d'arrêter de taper. Plusieurs
  // peuvent tomber sur le même tic (égalité : les deux brûlent). Le survivant n'a pas
  // d'événement à lui — il déduit sa victoire de ce qu'il ne reste que lui de vivant.
  | { type: "PlayerBurned"; playerId: string; atMs: number }
  // Arrêt d'une Race sous Spam (ADR 0016) : quelqu'un a verrouillé le seuil, ou le plafond
  // de temps a expiré — un seul message pour les deux, le mode ne les distingue pas non
  // plus. Diffusé UNE fois à TOUT LE MONDE (contrairement à PlayerBurned, qui vise un
  // joueur) : c'est ce message qui demande à chacun son log. Il ne désigne AUCUN vainqueur,
  // délibérément — le classement arrive juste après, dans RaceOver, recompté par le serveur.
  | { type: "SpamStop" }
  // L'ORDRE DU TABLEAU EST LE CLASSEMENT — pas de champ d'ordre séparé (ADR 0010).
  // `playOfTheGame` porte les deux logs du duel le plus serré, ou `null` s'il n'y en a
  // pas eu (< 2 finisseurs, ou meilleur écart > 2 s) — le bouton est alors absent (ADR 0011).
  | { type: "RaceOver"; results: RaceResult[]; playOfTheGame: PlayOfTheGame | null }
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
