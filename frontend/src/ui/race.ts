// =============================================================================
//  ui/race.ts — écran de Race multijoueur (Phase 2).
//
//  Machine d'état pilotée par le SERVEUR : connecting → lobby → countdown →
//  running → over. Le serveur possède seed/texte (RoomState) et t=0 (RaceStart).
//   - RaceStart = signal « go » : décompte local de RACE_COUNTDOWN_S (texte visible
//     pour lire le 1er mot) puis RunClock.start() — SEUL point de bascule du temps
//     côté client.
//   - Saisie : FreeInput (curseur libre) → le flux n'est JAMAIS bloqué, on écrit et
//     on avance malgré les fautes (comme le solo). Mais la course ne se TERMINE que
//     lorsque TOUT le texte est exact (raceComplete) : il faut corriger pour finir.
//   - Progress diffusé pour les barres ; Finish (log brut) → recompute autoritaire
//     → RaceOver. Owner (1er arrivé) : seul à voir le bouton « Démarrer ».
// =============================================================================

import type { Keystroke } from "../core/types";
import type { InputView } from "../core/input/controller";
import { RunClock } from "../core/clock";
import { Countdown } from "../core/countdown";
import { FreeInput } from "../core/input/free-input";
import { detectDifficultyFailure } from "../core/difficulty";
import {
  RaceSocket,
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
  type Identity,
  type PlayerEntry,
  type PlayOfTheGame,
  type RaceResult,
  type ServerEvent,
  type TextSource,
} from "../core/net";
import { podiumHtml, wirePodium, type PodiumOptions } from "./podium";
import { runPlayOfTheGame } from "./potg";
import { liveWpm } from "../live-stats";
import { wordsHtml, placeCaret, escapeText } from "./typing-zone";
import { avatarUrl, getIdentity, proxyBase, updateActivity } from "../discord";

type Phase = "connecting" | "lobby" | "countdown" | "running" | "over" | "failed";

/**
 * Comment on entre dans une Room (ADR 0008). Le salon vocal est créé à la volée ; un
 * Code de partie est créé explicitement, ou rejoint sans jamais être créé.
 */
export type RaceIntent =
  | { kind: "channel" }
  | { kind: "create" }
  | { kind: "code"; code: string };

/**
 * Durée du décompte qui précède une Race (ADR 0007). C'est un réglage PRODUIT, pas une
 * unité de mesure : t=0 reste la fin du décompte quelle que soit la valeur, et la Race
 * n'est jamais PB-eligible — la changer n'invalide donc rien (contrairement à l'ADR 0004,
 * qui déplaçait t=0 lui-même en solo). 7 s = le temps de voir la grille de départ et de
 * lire le premier mot du texte, qui reste visible EN ENTIER pendant tout le décompte.
 *
 * Valeur de repli avant le premier `RoomState` (issue #61) — la Room réelle porte la
 * valeur réglée par l'owner dans `countdownS`, qui la remplace dès qu'elle arrive.
 */
export const RACE_COUNTDOWN_S = 7;

/**
 * L'état d'un partant, EXACTEMENT les quatre états terminaux du glossaire (Abandon,
 * Failed, Brûlé, Devancé) plus les deux non-terminaux (en course, arrivé) — un partant ne
 * peut pas être dans deux à la fois, GARANTI PAR LE TYPE au lieu d'un ordre de `if` à
 * documenter. « Devancé » s'anglicise en `outpaced` dans le type (le code est déjà en
 * anglais côté types : `Keystroke`, `RaceResult`) ; CONTEXT.md note le lien avec le terme
 * du glossaire.
 *
 * `reps` sur `finished` : sous Spam, la piste affiche TOUJOURS le compte de répétitions,
 * jamais le WPM (ADR 0016) — y compris pour le vainqueur une fois son `PlayerFinished`
 * reçu. `PlayerFinished` ne porte pas `reps`, donc on le fige ici au moment de la
 * transition plutôt que de le perdre. `0` partout ailleurs, où il ne s'affiche jamais.
 */
export type RacerState =
  | { kind: "racing"; charsDone: number; reps: number }
  | { kind: "finished"; wpm: number; reps: number }
  | { kind: "abandoned" }
  | { kind: "failed"; percent: number }
  | { kind: "burned"; atMs: number }
  | { kind: "outpaced"; reps: number };

/**
 * Pose `next` SAUF si `cur` est déjà un état terminal — un `PlayerFinished`/`Progress` en
 * vol au moment d'une brûlure/arrêt de Spam ne doit jamais écraser le verdict déjà posé.
 * C'est ce garde-fou, À L'ÉCRITURE, qui remplace l'ordre des `if` de l'ancien `trackLabel`
 * (issue #130) : un seul état vaut, plus une priorité à retenir à la lecture.
 *
 * Sûr précisément parce que le protocole garantit l'ordre : une brûlure (`PlayerBurned`)
 * est TOUJOURS diffusée avant le `Finish` qu'elle déclenche chez la victime (le serveur
 * traite les messages d'une Room en série, sous un seul verrou — ADR 0015), et une
 * connexion WebSocket préserve l'ordre d'émission. Un `PlayerFinished` ne peut donc jamais
 * doubler le `PlayerBurned` du même joueur dans l'autre sens. Pure.
 */
export function advanceState(cur: RacerState | undefined, next: RacerState): RacerState {
  return cur === undefined || cur.kind === "racing" ? next : cur;
}

export class Race {
  private me = "";
  private channelId = "";
  /** Ma Display identity, annoncée à la jointure (jamais résolue par le serveur). */
  private identity: Identity = { displayName: "", avatarHash: null };
  private socket: RaceSocket | null = null;

  private phase: Phase = "connecting";
  /** Présents AVEC leur Display identity — c'est ce que la piste dessine. */
  private players: PlayerEntry[] = [];
  /** Partants figés au RaceStart (miroir du `racers` serveur) — un rejoignant en cours
   * de course entre dans `players` mais jamais ici, donc jamais dans `alive()`. */
  private racers: PlayerEntry[] = [];
  private owner = "";
  private targetText = "";
  private targetWords: string[] = [];
  /** Code de partie de la Room, `null` pour une Room de salon vocal. */
  private code: string | null = null;
  /** Source EFFECTIVE du texte (ADR 0009) — pas celle demandée : un repli se lit ici. */
  private textSource: TextSource = { kind: "quote" };
  /** Taille max de la Room (réglage de l'hôte). Défaut = plafond dur du serveur. */
  private maxPlayers = 8;
  /** Durée du décompte (réglage de l'hôte, issue #61). Défaut avant le 1er RoomState. */
  private countdownS = RACE_COUNTDOWN_S;
  /** Ready-check (réglage de l'hôte, issue #63). Mon état "prêt" vit sur `players[]`. */
  private readyCheck = false;
  /** Difficulté de la Room (réglage de l'hôte, issue #71, ADR 0013). */
  private difficulty: Difficulty = "normal";
  /** Mode de jeu de la Room (réglage de l'hôte, ADR 0015) — comment la course se gagne. */
  private gameMode: GameMode = "normal";
  /** Intervalle d'élimination de floor is lava, en secondes. Inerte en `normal`. */
  private lavaIntervalS = 10;
  /** Mot personnalisé de Spam (réglage de l'hôte, ADR 0016), `null` = mot par défaut. */
  private spamWord: string | null = null;
  /** Seuil de répétitions qui gagne la Race. Inerte hors `spam`. */
  private spamThreshold = 20;
  /** Plafond de temps de Spam, en secondes. Inerte hors `spam`. */
  private spamTimeCapS = 30;
  /** Message affiché en phase "failed" (code inconnu, Room pleine). */
  private failure = "";

  private clock = new RunClock();
  private controller = new FreeInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;
  /** Nombre de mots verrouillés au dernier `Progress` diffusé (#94) — le seul déclencheur. */
  private lastLockedSent = 0;

  /** Un `RacerState` par joueur — un seul état, jamais deux à la fois (issue #130). */
  private states = new Map<string, RacerState>();
  /** Résultats complets de la dernière course, DANS L'ORDRE DU CLASSEMENT (ADR 0010). */
  private results: RaceResult[] = [];
  /** Le duel le plus serré (ADR 0011), ou `null` s'il n'y en a pas eu → bouton absent. */
  private playOfTheGame: PlayOfTheGame | null = null;
  /**
   * Snapshot des mots de la course JOUÉE, figé à `RaceOver`. Le `RoomState` de revanche
   * (ordonné APRÈS, garanti par le WebSocket) écrase `targetWords` avec le texte suivant ;
   * le Play of the Game rejoue les logs contre CE texte-ci, jamais celui de la revanche.
   */
  private racedWords: string[] = [];
  /** Handle d'arrêt du Play of the Game : sa présence EST « le duel est à l'écran ». */
  private potgStop: (() => void) | null = null;
  private countdownN = RACE_COUNTDOWN_S;
  private countdown: Countdown | null = null;
  private rafId = 0;

  /** `onExit` : navigation retour vers le menu (lobby et écran RaceOver). */
  constructor(
    private readonly root: HTMLElement,
    private readonly onExit?: () => void,
    private readonly intent: RaceIntent = { kind: "channel" },
  ) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  /** Démontage propre : coupe écouteur, rAF et socket (→ LeaveRoom côté serveur). */
  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    cancelAnimationFrame(this.rafId);
    this.potgStop?.(); // coupe le rAF du duel s'il tournait
    this.potgStop = null;
    this.countdown?.cancel();
    this.countdown = null;
    this.socket?.close();
    this.socket = null;
  }

  async mount(): Promise<void> {
    const id = await getIdentity();
    this.me = id.playerId;
    this.channelId = id.channelId;
    this.identity = { displayName: id.displayName, avatarHash: id.avatarHash };
    this.socket = new RaceSocket(id.token, (e) => this.onEvent(e), proxyBase());
    await this.socket.ready();
    this.socket.send(this.joinEvent());
    this.render();
  }

  /** Traduit l'intention d'entrée en événement de jointure (ADR 0008). */
  private joinEvent(): ClientEvent {
    const identity = this.identity;
    switch (this.intent.kind) {
      case "channel":
        return { type: "JoinChannel", channelId: this.channelId, identity };
      case "create":
        return { type: "CreateRoom", identity };
      case "code":
        return { type: "JoinCode", code: this.intent.code, identity };
    }
  }

  // --- Événements serveur -----------------------------------------------------

  private onEvent(e: ServerEvent): void {
    switch (e.type) {
      case "RoomState":
        this.players = e.players;
        this.owner = e.owner;
        this.code = e.code;
        this.textSource = e.textSource;
        this.maxPlayers = e.maxPlayers;
        this.countdownS = e.countdownS;
        this.readyCheck = e.readyCheck;
        this.difficulty = e.difficulty;
        this.gameMode = e.gameMode;
        this.lavaIntervalS = e.lavaIntervalS;
        this.spamWord = e.spamWord;
        this.spamThreshold = e.spamThreshold;
        this.spamTimeCapS = e.spamTimeCapS;
        // Le texte n'est PAS repris pendant qu'on court. Le serveur ne le change jamais
        // en course, mais un rejoignant fait re-diffuser `RoomState` — et sous Spam le
        // client a rallongé son texte lui-même (`topUpSpamText`) : le reprendre du
        // serveur le retronquerait à sa longueur de départ, sous les doigts du joueur et
        // sous le curseur de `FreeInput`, qui tient ce tableau par référence.
        if (this.phase !== "countdown" && this.phase !== "running") {
          this.targetText = e.targetText;
          this.targetWords = e.targetText.split(" ").filter((w) => w.length > 0);
        }
        // Duel à l'écran : on met à jour les données (join/leave du lobby d'après-course)
        // mais on NE re-render PAS — sinon on effacerait le Play of the Game en pleine lecture.
        if (this.potgStop) return;
        if (this.phase === "connecting") {
          this.phase = "lobby";
          updateActivity("lobby");
        }
        this.render();
        break;
      // Jointure refusée : le socket reste ouvert côté serveur, mais la reprise se fait
      // par le menu (c'est lui qui porte le champ de saisie du code).
      case "RoomNotFound":
        this.fail("Code de partie inconnu. Vérifie-le auprès de l'hôte.");
        break;
      case "RoomFull":
        this.fail("Cette partie est complète (8 joueurs).");
        break;
      case "RaceStart":
        this.startCountdown();
        break;
      case "PlayerProgress":
        // N'écrase jamais un état terminal déjà connu — un Progress attardé (en vol au
        // moment d'un Finish/Forfeit/Fail/brûlure/arrêt de Spam) ne doit pas ressusciter
        // « en course » un partant que le serveur a déjà clos.
        this.advance(e.playerId, { kind: "racing", charsDone: e.charsDone, reps: e.reps });
        if (this.phase === "running") this.renderBars();
        break;
      // Spam terminé (ADR 0016) : seuil atteint par quelqu'un, ou plafond de temps expiré
      // — le message ne dit pas lequel, et personne n'a besoin de le savoir pour arrêter
      // de taper. Même geste que le brûlé de floor is lava : on livre son log et on
      // attend RaceOver, qui porte le seul classement qui compte (recompté par le serveur).
      case "SpamStop":
        this.markOutpaced();
        this.stopAndSubmit();
        if (this.phase === "running") this.renderBars();
        break;
      case "PlayerFinished": {
        // `reps` sous Spam : PlayerFinished ne le porte pas, on fige le dernier connu au
        // moment de la transition — sinon la piste retomberait à « 0 × » sur la ligne
        // d'un vrai vainqueur (voir RacerState).
        const reps = this.repsFor(e.playerId, this.stateOf(e.playerId));
        this.advance(
          e.playerId,
          e.forfeit
            ? { kind: "abandoned" }
            : e.failedPercent !== null
              ? { kind: "failed", percent: e.failedPercent }
              : { kind: "finished", wpm: e.wpm, reps },
        );
        // Un partant peut aussi sortir par Abandon/Échec Master, pas seulement par le
        // feu (ADR 0015) — sans ce même réflexe qu'`onBurned`, le survivant ne se
        // déduirait dernier vivant qu'au watchdog (10 min).
        if (this.gameMode === "floorIsLava" && this.isLastAlive()) this.stopAndSubmit();
        if (this.phase === "running") this.renderBars();
        break;
      }
      case "PlayerBurned":
        this.onBurned(e.playerId, e.atMs);
        break;
      case "RaceOver":
        this.results = e.results;
        this.playOfTheGame = e.playOfTheGame;
        // Snapshot AVANT que le RoomState de revanche (ordonné après) n'écrase targetWords.
        this.racedWords = this.targetWords.slice();
        this.phase = "over";
        updateActivity("lobby"); // podium affiché, mais on est revenu dans la Room
        cancelAnimationFrame(this.rafId);
        this.render();
        break;
    }
  }

  /**
   * Élimination floor is lava (ADR 0015). Le serveur a déjà décidé ; ce message dit au
   * brûlé d'arrêter de taper et de renvoyer son log — d'où le `Finish`, qui veut déjà dire
   * « voici mon log, j'ai fini ». Le survivant, lui, n'a pas de message à lui : il déduit
   * sa victoire de ce qu'il ne reste que lui de vivant, et envoie le sien de la même façon.
   * Sans ça, sa course ne se clôturerait qu'au watchdog.
   */
  private onBurned(playerId: string, atMs: number): void {
    this.advance(playerId, { kind: "burned", atMs });
    if (playerId === this.me) this.stopAndSubmit();
    else if (this.isLastAlive()) this.stopAndSubmit();
    if (this.phase === "running") this.renderBars();
  }

  /** Lit l'état d'un partant, « en course à zéro » avant son premier signal (ADR 0016
   *  inclus : personne n'a encore de `reps` avant le premier mot verrouillé). */
  private stateOf(playerId: string): RacerState {
    return this.states.get(playerId) ?? { kind: "racing", charsDone: 0, reps: 0 };
  }

  /** Pose un état via `advanceState` (garde-fou contre un message en vol qui écraserait
   *  un verdict déjà posé — voir sa doc). */
  private advance(playerId: string, next: RacerState): void {
    this.states.set(playerId, advanceState(this.states.get(playerId), next));
  }

  /** Répétitions d'un partant : les MIENNES se relisent toujours en local (plus fraîches
   *  que le dernier `Progress` reçu, qui a pu dater d'avant mon dernier mot verrouillé) ;
   *  celles des autres viennent de leur dernier état connu. */
  private repsFor(playerId: string, state: RacerState): number {
    return playerId === this.me ? this.myReps() : repsOf(state);
  }

  /**
   * Devancé (ADR 0016) : posé au `SpamStop`, pas déduit à l'affichage — le seul instant où
   * le client sait qui est encore « en course ». Si quelqu'un a atteint le seuil, tous les
   * autres sont Devancé ; sinon (plafond de temps, personne ne l'a atteint) c'est le plus
   * haut compte connu qui gagne (glossaire Spam) et tout le reste est Devancé.
   */
  private markOutpaced(): void {
    const racing: { playerId: string; reps: number }[] = [];
    for (const p of this.racers) {
      const s = this.stateOf(p.playerId);
      if (s.kind !== "racing") continue;
      racing.push({ playerId: p.playerId, reps: this.repsFor(p.playerId, s) });
    }
    for (const r of outpaced(racing, this.spamThreshold)) {
      this.states.set(r.playerId, { kind: "outpaced", reps: r.reps });
    }
  }

  /** Les vivants : partants figés au RaceStart, ni brûlés ni déjà sortis (arrivée,
   * abandon, échec) — un rejoignant en cours de course n'en fait jamais partie. */
  private alive(): PlayerEntry[] {
    const ids = new Set(aliveIds(this.racers.map((p) => p.playerId), this.states));
    return this.racers.filter((p) => ids.has(p.playerId));
  }

  private isLastAlive(): boolean {
    const alive = this.alive();
    return alive.length === 1 && alive[0].playerId === this.me;
  }

  /** Arrête ma saisie et livre mon log — brûlé ou vainqueur, c'est le même geste. */
  private stopAndSubmit(): void {
    if (this.doneLocal) return;
    this.doneLocal = true;
    this.socket?.send({ type: "Finish", keystrokes: this.log, endedAtMs: this.clock.elapsed() });
  }

  private fail(message: string): void {
    this.phase = "failed";
    this.failure = message;
    this.render();
  }

  // --- Cycle de course --------------------------------------------------------

  private startCountdown(): void {
    // Un RaceStart reçu pendant le Play of the Game interrompt l'écran : la course prime.
    this.potgStop?.();
    this.potgStop = null;
    // Un seul décompte vivant : un second RaceStart pendant le décompte/la course est ignoré.
    if (this.phase === "countdown" || this.phase === "running") return;
    this.phase = "countdown";
    this.countdownN = this.countdownS;
    // Figé ici, pas relu ailleurs : un RoomState reçu pendant la course (un rejoignant)
    // ne doit pas faire grossir la liste des partants.
    this.racers = this.players.slice();
    this.states.clear();
    this.playOfTheGame = null;
    // Contrôleur neuf dès le décompte : le texte ENTIER s'affiche vierge (le joueur lit
    // le début pendant l'attente) — indispensable après une revanche (état stale).
    this.doneLocal = false;
    this.controller = new FreeInput(this.targetWords);
    this.countdown = new Countdown(
      this.countdownS,
      (n) => {
        this.countdownN = n;
        this.render();
      },
      () => this.beginRun(),
    );
    this.countdown.start();
  }

  private beginRun(): void {
    this.countdown = null;
    this.phase = "running";
    updateActivity(this.gameMode === "normal" ? "race" : this.gameMode);
    this.doneLocal = false;
    this.log = [];
    this.lastLockedSent = 0; // revanche : sans ça, aucun Progress ne repartirait
    this.controller = new FreeInput(this.targetWords);
    this.clock.start(); // t=0 (pilotée par RaceStart, plus par un décompte local isolé)
    this.render();
    this.loop();
  }

  /** Boucle d'affichage : rafraîchit mon WPM live tant que je cours. */
  private loop(): void {
    if (this.phase !== "running") return;
    this.renderBars();
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  /**
   * Mes répétitions correctes sous Spam (ADR 0016). Se RELIT de la pile `locked` à chaque
   * appel, jamais un compteur incrémenté à part qui pourrait diverger du buffer réel —
   * c'est ce qui fait marcher Backspace au milieu d'une répétition sans code nouveau.
   * 0 hors Spam, où la notion n'existe pas.
   */
  private myReps(): number {
    if (this.gameMode !== "spam") return 0;
    return spamReps(this.targetWords[0] ?? "", this.controller.view());
  }

  /**
   * Allonge le texte de Spam quand le curseur approche de sa fin (ADR 0016) — c'est ça,
   * « texte infini » : le mot est le même à chaque position, donc le client n'a rien à
   * demander au serveur pour continuer. Même idée que le Time infini du solo, sans le
   * générateur : il n'y a pas de suite pseudo-aléatoire à poursuivre, juste un mot.
   *
   * MUTE le tableau au lieu de le remplacer : `FreeInput` le tient par référence, donc la
   * rallonge lui est visible sans le reconstruire — le reconstruire perdrait la pile de
   * mots déjà verrouillés, c'est-à-dire toutes les répétitions déjà acquises.
   */
  private topUpSpamText(): void {
    if (this.gameMode !== "spam") return;
    const word = this.targetWords[0];
    if (word === undefined) return;
    const n = spamRefill(this.targetWords.length, this.controller.view().wordIndex);
    if (n === 0) return;
    for (let i = 0; i < n; i++) this.targetWords.push(word);
    this.targetText = this.targetWords.join(" ");
  }

  /** charsDone = mots verrouillés (+ espaces) + préfixe correct du mot courant. */
  private charsDone(): number {
    const v = this.controller.view();
    const n = v.lockedWords.reduce((a, w) => a + w.length, 0) + v.lockedWords.length;
    const t = this.targetWords[v.wordIndex] ?? "";
    let i = 0;
    while (i < v.typed.length && i < t.length && v.typed[i] === t[i]) i++;
    return n + i;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.phase !== "running" || this.doneLocal) return;
    if (e.key !== "Backspace" && e.key !== " " && e.key.length !== 1) return;
    e.preventDefault();

    const k = this.controller.handleKey(e.key, e.ctrlKey, this.clock.elapsed());
    if (k) this.log.push(k);

    // Difficulté Master (issue #71, ADR 0013) : détectée localement sur le log free-input,
    // avant tout le reste. Le serveur REJOUE contre son propre texte pour confirmer avant
    // d'enregistrer un Échec — jamais fait confiance sur la seule parole du client.
    if (this.difficulty === "master") {
      const fail = detectDifficultyFailure("master", this.targetWords, this.log);
      if (fail) {
        this.doneLocal = true;
        this.socket?.send({ type: "Fail", keystrokes: this.log });
        this.renderWords();
        this.renderBars();
        return;
      }
    }

    // Progress ne part QU'AU verrouillage d'un mot (#94), plus à chaque frappe : les
    // barres des autres avancent alors par sauts proportionnels à la longueur du mot
    // fini, et le fil ne porte plus une trame par caractère. Ma propre barre, elle, ne
    // change pas de rythme — elle lit `charsDone()` en local à chaque rendu et ignore
    // complètement ce que ce protocole diffuse.
    // Sous Spam, le texte s'allonge AVANT le rendu et avant tout calcul de progression :
    // le curseur ne doit jamais se retrouver au-delà de la fin du tableau.
    this.topUpSpamText();

    const locked = this.controller.view().lockedWords.length;
    if (locked !== this.lastLockedSent) {
      this.lastLockedSent = locked;
      // Un verrouillage est exactement l'instant où une répétition se termine : c'est
      // pourquoi le seuil de Spam se vérifie côté serveur sur CE message (ADR 0016),
      // plutôt qu'au tic du watchdog, qui le ferait traîner d'une seconde.
      this.socket?.send({ type: "Progress", charsDone: this.charsDone(), reps: this.myReps() });
    }

    // Fin de course : uniquement quand TOUT le texte est exact (flux jamais bloqué,
    // mais il faut avoir corrigé ses fautes pour terminer). Sous Spam et floor is lava
    // c'est inatteignable par construction — le texte n'a pas de fin —, et c'est le
    // serveur qui arrête la course (`SpamStop`, `PlayerBurned`).
    if (raceComplete(this.targetWords, this.controller.view())) {
      this.doneLocal = true;
      this.socket?.send({ type: "Finish", keystrokes: this.log, endedAtMs: this.clock.elapsed() });
    }
    this.renderWords();
    this.renderBars();
  }

  /**
   * Abandon volontaire : on arrête la voiture localement (`doneLocal`) et on prévient le
   * serveur, qui enregistre une arrivée en abandon SANS nous retirer de la Room. On attend
   * ensuite RaceOver comme après une vraie arrivée — d'où le même « en attente des autres… ».
   */
  private forfeit(): void {
    if (this.phase !== "running" || this.doneLocal) return;
    this.doneLocal = true;
    this.socket?.send({ type: "Forfeit" });
    this.render();
  }

  // --- Rendu ------------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = `<section class="race">${this.bodyHtml()}</section>`;
    const btn = this.root.querySelector<HTMLButtonElement>("#startRace");
    if (btn) btn.addEventListener("click", () => this.socket?.send({ type: "StartRace" }));
    this.root
      .querySelector<HTMLButtonElement>("#exitRace")
      ?.addEventListener("click", () => this.onExit?.());
    this.root
      .querySelector<HTMLButtonElement>("#forfeitRace")
      ?.addEventListener("click", () => this.forfeit());
    this.wireLobbySettings();
    this.root.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click", () => {
      const me = this.players.find((p) => p.playerId === this.me);
      this.socket?.send({ type: "SetReady", ready: !(me?.ready ?? false) });
    });
    if (this.phase === "over") {
      wirePodium(this.root, this.podiumOptions());
      this.root
        .querySelector<HTMLButtonElement>("#playOfTheGame")
        ?.addEventListener("click", () => this.openPotg());
    }
    // Décompte et début de course passent par render() : le bloc doit être placé
    // là aussi, sinon le 1er caractère (inversé sous lui) reste invisible.
    const wordsEl = this.root.querySelector<HTMLElement>("#words");
    if (wordsEl) placeCaret(wordsEl);
  }

  /**
   * Délégué UNIQUE pour les dix Réglages de salon (issue #131) — remplace les dix blocs
   * `querySelector` + `addEventListener` d'avant, un par réglage. `data-row` porte la clé
   * de la ligne déclarée dans `lobbyRows()`, qui seule sait quel `ClientEvent` construire :
   * ce délégué ne connaît que « quelle ligne, quelle valeur brute », jamais le protocole.
   *
   * Deux familles d'interaction natives à couvrir, donc deux écouteurs : `click` pour les
   * boutons segmentés (Texte), dont `data-value` porte déjà la valeur choisie ; `change`
   * pour `select`/case à cocher/texte, où c'est `target.value` (ou `.checked`) qui la porte.
   * Un seul re-render régénère les deux à chaque fois — pas de recâblage à part.
   */
  private wireLobbySettings(): void {
    const panel = this.root.querySelector<HTMLElement>(".lobby-settings");
    if (!panel) return;
    const dispatch = (rowId: string, raw: string): void => {
      const row = this.lobbyRows().find((r) => r.id === rowId);
      if (row) this.socket?.send(row.set(raw));
    };
    panel.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-row][data-value]");
      if (target?.dataset.row && target.dataset.value !== undefined) {
        dispatch(target.dataset.row, target.dataset.value);
      }
    });
    // `change` et non `input` : on n'envoie pas un réglage de salon à chaque caractère
    // tapé — le mot de Spam part au blur/à l'Entrée, pas frappe par frappe (ADR 0016).
    panel.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const rowId = target.dataset.row;
      if (!rowId) return;
      const raw =
        target instanceof HTMLInputElement && target.type === "checkbox"
          ? String(target.checked)
          : target.value;
      dispatch(rowId, raw);
    });
  }

  private bodyHtml(): string {
    switch (this.phase) {
      case "connecting":
        return `<p class="hint">Connexion…</p>`;
      case "failed":
        return `<p class="hint">${escapeText(this.failure)}</p>` + this.exitBtnHtml();
      case "lobby":
        return (
          this.codeHtml() +
          // Les Réglages de salon se DÉCLARENT (`lobbyRows()`, sur le modèle de
          // `settings.ts:sections()`) et se rendent dans UNE grille (#95, issue #131) —
          // c'est le conteneur commun qui les aligne, pas dix méthodes qui se ressemblent
          // de loin. La Source est absente de la liste dès qu'un Mode de jeu impose son
          // texte (ADR 0015, 0016) : l'afficher laisserait croire qu'on peut encore le choisir.
          `<div class="lobby-settings">${this.lobbyRows().map(lobbyRowHtml).join("")}</div>` +
          this.cardsHtml() +
          this.readyBtnHtml() +
          this.startBtnHtml() +
          this.exitBtnHtml()
        );
      case "countdown":
        return `<div class="countdown">${this.countdownN}</div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>`;
      case "running":
        return `<div class="live-bar" id="liveBar"></div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>
          <div class="bars" id="bars" style="--n:${this.players.length}">${this.barsHtml()}</div>
          <p class="hint">${this.doneLocal ? "Terminé — en attente des autres…" : this.runningHint()}</p>
          ${this.forfeitBtnHtml()}`;
      case "over":
        // Revanche : le serveur a déjà re-diffusé un RoomState avec un NOUVEAU texte ;
        // le même bouton StartRace relance (owner seulement). Le podium est donc posé
        // par-dessus un lobby DÉJÀ prêt — aucune séquence serveur, aucun minuteur.
        return (
          podiumHtml(this.podiumOptions()) +
          this.potgBtnHtml() +
          this.startBtnHtml() +
          this.exitBtnHtml()
        );
    }
  }

  /**
   * La consigne pendant la course. « Corrige tes fautes pour finir » ne vaut que sous
   * Normal : les deux Modes de jeu n'ont pas de ligne d'arrivée à atteindre, et Spam
   * demande précisément l'inverse — verrouiller vite, pas finir un texte.
   */
  private runningHint(): string {
    if (this.gameMode === "spam") {
      return `Répète le mot ; ${this.spamThreshold} répétitions correctes pour gagner`;
    }
    if (this.gameMode === "floorIsLava") return "Tape sans t'arrêter : le dernier avance vers le feu";
    return "Tape le texte ; corrige tes fautes pour finir";
  }

  /** Code de partie, affiché à TOUT le lobby : n'importe qui peut inviter, pas que l'hôte. */
  private codeHtml(): string {
    if (this.code === null) return "";
    return `<p class="race-code">Code de partie : <strong>${escapeText(this.code)}</strong></p>`;
  }

  /**
   * Les Réglages de salon, DÉCLARÉS (issue #131, sur le modèle de `settings.ts:sections()`)
   * plutôt que codés un par un : une entrée par ligne, `lobbyRowHtml` fait le rendu (pur,
   * testé sans DOM) et `wireLobbySettings` le câblage (un délégué unique). `locked` porte
   * UNE FOIS la règle « lecture seule pour les non-hôtes », recopiée dix fois avant.
   *
   * L'ordre de la liste EST l'ordre d'affichage — Mode de jeu d'abord, puis les réglages
   * propres à un Mode de jeu (Élimination sous floor is lava ; Mot/Objectif/Temps max sous
   * Spam), puis Texte (absent dès qu'un Mode de jeu impose son texte, ADR 0015/0016), puis
   * les quatre réglages communs.
   */
  private lobbyRows(): LobbyRow[] {
    const isOwner = this.me === this.owner;
    const rows: LobbyRow[] = [
      {
        id: "raceGameMode",
        label: "Mode de jeu",
        tip: LOBBY_TIPS.gameMode,
        locked: !isOwner,
        readOnly: GAME_MODE_LABELS[this.gameMode],
        control: {
          kind: "select",
          value: this.gameMode,
          options: GAME_MODES.map((m) => ({ value: m, label: GAME_MODE_LABELS[m] })),
        },
        set: (v) => ({ type: "SetGameMode", mode: v as GameMode }),
      },
    ];
    if (this.gameMode === "floorIsLava") {
      rows.push({
        id: "lavaInterval",
        label: "Élimination",
        tip: LOBBY_TIPS.lava,
        locked: !isOwner,
        readOnly: `toutes les ${this.lavaIntervalS} s`,
        control: {
          kind: "select",
          value: String(this.lavaIntervalS),
          options: LAVA_INTERVAL_VALUES.map((n) => ({ value: String(n), label: `toutes les ${n} s` })),
        },
        set: (v) => ({ type: "SetLavaInterval", seconds: Number(v) }),
      });
    }
    if (this.gameMode === "spam") {
      // Le mot RÉELLEMENT en jeu est celui du texte : sous mot par défaut, `spamWord` est
      // `null` et seul `targetText` sait lequel le serveur a tiré.
      const inPlay = this.targetWords[0] ?? "";
      rows.push(
        {
          id: "spamWord",
          label: "Mot",
          tip: LOBBY_TIPS.spamWord,
          locked: !isOwner,
          readOnly: inPlay,
          control: {
            kind: "text",
            value: this.spamWord ?? "",
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
          readOnly: `${this.spamThreshold} répétitions`,
          control: {
            kind: "select",
            value: String(this.spamThreshold),
            options: SPAM_THRESHOLD_VALUES.map((n) => ({ value: String(n), label: `${n} répétitions` })),
          },
          set: (v) => ({ type: "SetSpamThreshold", count: Number(v) }),
        },
        {
          id: "spamTimeCap",
          label: "Temps max",
          tip: LOBBY_TIPS.spamTimeCap,
          locked: !isOwner,
          readOnly: `${this.spamTimeCapS} s`,
          control: {
            kind: "select",
            value: String(this.spamTimeCapS),
            options: SPAM_TIME_CAP_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
          },
          set: (v) => ({ type: "SetSpamTimeCap", seconds: Number(v) }),
        },
      );
    }
    if (this.gameMode === "normal") {
      const src = this.textSource;
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
        // `currentCount(this.textSource)` : le repli quand on bascule sur « Mots » sans
        // avoir cliqué une longueur précise (garde la longueur courante, ou la médiane
        // si on vient de Citation, qui n'en a pas).
        set: (v) => textSourceEvent(v, currentCount(this.textSource)),
      });
    }
    rows.push(
      {
        id: "maxPlayers",
        label: "Salon",
        tip: LOBBY_TIPS.size,
        locked: !isOwner,
        readOnly: `${this.players.length}/${this.maxPlayers} joueurs`,
        note: isOwner ? `${this.players.length} présents` : undefined,
        control: {
          kind: "select",
          value: String(this.maxPlayers),
          options: ROOM_SIZES.map((n) => ({ value: String(n), label: `${n} joueurs` })),
        },
        set: (v) => ({ type: "SetMaxPlayers", max: Number(v) }),
      },
      {
        id: "raceCountdown",
        label: "Décompte",
        tip: LOBBY_TIPS.countdown,
        locked: !isOwner,
        readOnly: `${this.countdownS} s`,
        control: {
          kind: "select",
          value: String(this.countdownS),
          options: COUNTDOWN_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
        },
        set: (v) => ({ type: "SetCountdown", seconds: Number(v) }),
      },
      {
        id: "readyCheck",
        label: "Ready-check",
        tip: LOBBY_TIPS.ready,
        locked: !isOwner,
        readOnly: this.readyCheck ? "Activé" : "Désactivé",
        control: { kind: "toggle", value: this.readyCheck, onLabel: "Activé", offLabel: "Désactivé" },
        set: (v) => ({ type: "SetReadyCheck", enabled: v === "true" }),
      },
      {
        id: "raceDifficulty",
        label: "Difficulté",
        tip: LOBBY_TIPS.difficulty,
        locked: !isOwner,
        readOnly: DIFFICULTY_LABELS[this.difficulty],
        control: {
          kind: "select",
          value: this.difficulty,
          options: ROOM_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })),
        },
        set: (v) => ({ type: "SetDifficulty", difficulty: v as Difficulty }),
      },
    );
    return rows;
  }

  /** Bouton pour se marquer prêt/pas prêt — seulement visible quand le réglage est actif.
   *  PAS un Réglage de salon (`lobbyRows()`) : personnel à chaque joueur, pas owner-only. */
  private readyBtnHtml(): string {
    if (!this.readyCheck) return "";
    const ready = this.players.find((p) => p.playerId === this.me)?.ready ?? false;
    return `<button id="toggleReady" class="${ready ? "on" : ""}">${ready ? "Prêt ✓" : "Se dire prêt"}</button>`;
  }

  /** Cartes de présence empilées (owner en tête, moi souligné). */
  private cardsHtml(): string {
    const cards = this.players
      .map((p) => {
        const isOwner = p.playerId === this.owner;
        const isMe = p.playerId === this.me;
        const tags = [isOwner ? "owner" : "", isMe ? "me" : ""].filter(Boolean).join(" ");
        const label = isMe ? `${p.displayName} (toi)` : p.displayName;
        const readyTag = this.readyCheck ? (p.ready ? " ✓" : " ⌛") : "";
        return `<div class="card ${tags}">${avatarHtml(p)} ${escapeText(label)}${
          isOwner ? " 👑" : ""
        }${readyTag}</div>`;
      })
      .join("");
    return `<div class="cards">${cards}</div>`;
  }

  private startBtnHtml(): string {
    if (this.me === this.owner) {
      // Floor is lava exige deux partants (ADR 0015) : seul, on est déjà le dernier
      // vivant. Le serveur refuse en silence — le bouton doit donc dire pourquoi, sinon
      // l'hôte clique dans le vide sans comprendre.
      if (this.gameMode === "floorIsLava" && this.players.length < 2) {
        return `<button id="startRace" disabled>Démarrer la course</button>
          <p class="hint">Floor is lava demande au moins deux joueurs — seul, tu es déjà le dernier vivant.</p>`;
      }
      return `<button id="startRace" class="on">Démarrer la course</button>`;
    }
    return `<p class="hint">En attente que l'hôte lance la course…</p>`;
  }

  private exitBtnHtml(): string {
    return this.onExit ? `<button id="exitRace" class="back-btn">← menu</button>` : "";
  }

  /**
   * « Abandonner » : renonce à CETTE course sans quitter la Room (distinct de « ← menu »).
   * Visible seulement pendant qu'on court — une fois abandonné/fini, plus rien à abandonner.
   */
  private forfeitBtnHtml(): string {
    return this.doneLocal ? "" : `<button id="forfeitRace">Abandonner</button>`;
  }

  private renderWords(): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (!el) return;
    el.innerHTML = this.wordsAreaHtml();
    placeCaret(el);
  }

  private wordsAreaHtml(): string {
    return wordsHtml(this.targetWords, this.controller.view(), !this.doneLocal);
  }

  private renderBars(): void {
    const bars = this.root.querySelector<HTMLElement>("#bars");
    if (bars) {
      // `--n` = le nombre de pistes à faire tenir (#96) : c'est lui qui décide de la
      // hauteur des jauges. Il est reposé ici parce qu'un joueur peut quitter la Room
      // en pleine course, et que la piste doit alors se ré-agrandir.
      bars.style.setProperty("--n", String(this.players.length));
      bars.innerHTML = this.barsHtml();
    }
    const live = this.root.querySelector<HTMLElement>("#liveBar");
    if (live) {
      const wpm = this.doneLocal ? 0 : liveWpm(this.targetWords, this.controller.view(), this.clock.elapsed());
      // Le décompte avant la prochaine brûlure : c'est lui qui rend le mode angoissant.
      // Tant qu'il reste quelqu'un à éliminer — sinon la course est déjà jouée.
      const lava =
        this.gameMode === "floorIsLava" && this.alive().length > 1
          ? `<span class="live-lava">🔥 ${nextBurnIn(this.clock.elapsed(), this.lavaIntervalS)} s</span>`
          : "";
      // Les DEUX façons de gagner, côte à côte (ADR 0016) : ce qu'il me reste à taper, et
      // ce qu'il me reste de temps pour le faire. Une seule des deux affichée laisserait
      // le joueur ignorer laquelle va claquer.
      const spam =
        this.gameMode === "spam"
          ? `<span class="live-spam">${this.myReps()} / ${this.spamThreshold} ×</span>
             <span class="live-spam">⏱ ${capRemaining(this.clock.elapsed(), this.spamTimeCapS)} s</span>`
          : "";
      live.innerHTML = `<span class="live-wpm">${wpm} wpm</span>${lava}${spam}`;
    }
  }

  /**
   * La piste : une ligne par joueur, la voiture en tête de sa progression, le WPM à la
   * ligne d'arrivée. Même donnée que les anciennes barres (`charsDone`), autre costume.
   */
  private barsHtml(): string {
    // Sous Spam la piste ne se mesure pas en caractères : le texte est infini, une
    // progression sur sa longueur ne voudrait rien dire et reculerait à chaque rallonge.
    // Elle se mesure en répétitions sur l'objectif — la grandeur qui décide de la victoire,
    // donc celle que la piste doit montrer (ADR 0016).
    const spam = this.gameMode === "spam";
    const total = spam ? Math.max(1, this.spamThreshold) : Math.max(1, this.targetText.length);
    const elapsed = this.clock.elapsed();
    // Le condamné en sursis (ADR 0015) : marqué EN PERMANENCE, pas seulement au tic.
    // C'est ça, le mode — pas des morts surprises, mais quelques secondes à se voir
    // dernier en tapant plus vite. Calculé en local sur la même règle que le serveur ;
    // mon propre `charsDone` est plus frais que celui qu'il a reçu, donc c'est un
    // avertissement, jamais un verdict.
    const doomed =
      this.gameMode === "floorIsLava" && this.phase === "running"
        ? lastPlaced(
            this.alive().map((p) => ({
              playerId: p.playerId,
              done: p.playerId === this.me ? this.charsDone() : charsOf(this.stateOf(p.playerId)),
            })),
          )
        : new Set<string>();
    return this.players
      .map((p) => {
        const isMe = p.playerId === this.me;
        const state = this.stateOf(p.playerId);
        const chars = isMe ? this.charsDone() : charsOf(state);
        const reps = this.repsFor(p.playerId, state);
        const done = spam ? reps : chars;
        // Sous Spam, personne n'« arrive » : remplir la piste à fond au PlayerFinished
        // téléporterait sur la ligne un Devancé qui s'est arrêté à 3 répétitions — le
        // calcul naturel (reps / seuil) suffit déjà, il plafonne tout seul à 100 %.
        const pct = trackPercent(done, total, state, spam);
        const label = trackLabel(state, liveWpmOf(chars, elapsed), spam ? reps : undefined);
        // La ligne d'un brûlé RESTE à l'écran, carbonisée : voir le cimetière se remplir
        // fait partie du mode. `.burned` porte l'embrasement, `.doomed` le sursis.
        const classes = [
          "bar",
          isMe ? "me" : "",
          state.kind !== "racing" ? "done" : "",
          state.kind === "burned" ? "burned" : "",
          doomed.has(p.playerId) ? "doomed" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="${classes}">
          <span class="bar-label">${escapeText(isMe ? `${p.displayName} (toi)` : p.displayName)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%">${avatarHtml(p, "car")}</div></div>
          <span class="bar-wpm">${label}</span>
        </div>`;
      })
      .join("");
  }

  private podiumOptions(): PodiumOptions {
    return { results: this.results, players: this.players, me: this.me };
  }

  /** Bouton du duel — présent seulement quand le serveur a désigné un Play of the Game. */
  private potgBtnHtml(): string {
    return this.playOfTheGame ? `<button id="playOfTheGame" class="on">Play of the Game</button>` : "";
  }

  /**
   * Ouvre le duel : monte l'écran autonome (`runPlayOfTheGame`) et garde son handle
   * d'arrêt — sa présence gèle le re-render sur `RoomState` (voir la garde). On NE change
   * PAS de phase : `potgStop` est le seul signal « duel à l'écran ». Retour → on redessine
   * le podium (phase toujours "over").
   */
  private openPotg(): void {
    const potg = this.playOfTheGame;
    if (!potg) return;
    const entry = (id: string): PlayerEntry =>
      this.players.find((p) => p.playerId === id) ?? {
        playerId: id,
        displayName: id, // parti depuis : on retombe sur le snowflake, comme le podium
        avatarHash: null,
        ready: false,
      };
    this.potgStop = runPlayOfTheGame(this.root, {
      racedWords: this.racedWords,
      // Les deux Modes de jeu s'arrêtent sans que personne ne franchisse de ligne : la
      // fenêtre du duel court avant la sortie la PLUS TÔT des deux, pas avant une seconde
      // arrivée qui n'existe pas (ADR 0015, 0016).
      endAtFirst: this.gameMode !== "normal",
      logA: potg.logA,
      playerA: entry(potg.a),
      logB: potg.logB,
      playerB: entry(potg.b),
      onBack: () => {
        this.potgStop = null;
        this.render();
      },
    });
  }
}

/**
 * Pastille d'avatar. L'initiale est rendue DERRIÈRE l'image : si celle-ci ne charge pas
 * (compte sans avatar, CSP de l'iframe), elle reste visible d'elle-même — pas de `onerror`.
 * `alt=""` : le nom est déjà écrit juste à côté, l'annoncer deux fois est du bruit.
 */
function avatarHtml(p: PlayerEntry, cls = "car"): string {
  const initial = escapeText([...p.displayName][0]?.toUpperCase() ?? "?");
  const src = escapeText(avatarUrl(p.playerId, p.avatarHash));
  return `<span class="${cls}">${initial}<img src="${src}" alt="" loading="lazy"></span>`;
}

/**
 * WPM live d'un joueur, DÉRIVÉ de sa progression : `charsDone` ne compte que les
 * caractères corrects, donc chaque client calcule celui de tout le monde sans qu'aucun
 * champ ne soit ajouté au protocole.
 *
 * ponytail: les t=0 diffèrent d'une fraction de seconde d'un client à l'autre (le
 * décompte est local), soit ~2 % d'écart sur une course de 30 s. Assumé pour un compteur
 * d'ambiance ; le WPM de record reste celui du recompute autoritaire au Finish. Si un
 * jour ce chiffre doit être exact, c'est `RaceStart.startAtEpochMs` qu'il faut utiliser
 * comme origine commune, pas un champ de plus dans `Progress`.
 */
export function liveWpmOf(charsDone: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round(charsDone / 5 / (elapsedMs / 60000));
}

/** `charsDone` d'un état, 0 hors « en course » (le seul où il existe). */
function charsOf(state: RacerState): number {
  return state.kind === "racing" ? state.charsDone : 0;
}

/** `reps` d'un état, 0 là où il n'a pas de sens (abandon, échec, brûlé). */
function repsOf(state: RacerState): number {
  return state.kind === "racing" || state.kind === "finished" || state.kind === "outpaced"
    ? state.reps
    : 0;
}

/**
 * Remplissage de la piste, en pourcentage.
 *
 * Une VRAIE arrivée remplit la piste à fond quoi qu'ait dit le dernier `Progress` :
 * depuis #94 le dernier mot n'est pas verrouillé quand on finit sans taper d'espace
 * derrière, et la voiture s'arrêterait à un mot de la ligne d'arrivée. Un abandon et un
 * échec Master, eux, restent où ils se sont arrêtés — `RacerState` rend ces deux issues
 * IMPOSSIBLES à confondre avec une arrivée, plus besoin de les exclure une par une.
 *
 * Sous Spam personne n'« arrive » : le calcul naturel (`done / total`) plafonne déjà tout
 * seul à 100 % une fois le seuil atteint, donc `spam` désactive la téléportation plutôt
 * que de la déclencher pour un Devancé arrêté à mi-piste. Pure.
 */
export function trackPercent(done: number, total: number, state: RacerState, spam = false): number {
  if (state.kind === "finished" && !spam) return 100;
  return Math.min(100, Math.round((done / Math.max(1, total)) * 100));
}

/**
 * Étiquette de la ligne d'arrivée sur la piste — un `switch` total sur `RacerState` :
 * chaque partant a EXACTEMENT une étiquette, plus d'ordre de priorité à documenter entre
 * abandon/échec/brûlure/Devancé, le type ne permet plus qu'ils se chevauchent. `liveWpm`
 * et `spamReps` restent externes : ce sont des grandeurs dérivées à chaque rendu, jamais
 * un état posé. Pure.
 */
export function trackLabel(
  state: RacerState,
  liveWpm: number,
  /** Répétitions sous Spam (ADR 0016) ; `undefined` dans tous les autres modes. */
  spamReps?: number,
): string {
  switch (state.kind) {
    case "burned":
      return `brûlé à ${Math.round(state.atMs / 1000)} s`;
    case "failed":
      return `échec (${state.percent}%)`;
    case "abandoned":
      return "abandon";
    case "outpaced":
      return `${state.reps} ×`;
    case "racing":
    case "finished":
      // Spam : le chiffre de la ligne est le compte de répétitions, jamais un WPM — c'est
      // la grandeur qui décide de la victoire (ADR 0016), y compris pour un vrai vainqueur.
      if (spamReps !== undefined) return `${spamReps} ×`;
      return state.kind === "finished" ? `${state.wpm} wpm ✓` : `${liveWpm} wpm`;
  }
}

/**
 * Secondes restantes avant le plafond de temps de Spam (ADR 0016). Dérivé en local du
 * chrono : le client connaît le plafond depuis le lobby, aucun événement serveur n'est
 * nécessaire pour l'afficher — l'arrêt réel, lui, vient du serveur (`SpamStop`).
 *
 * Compte depuis GO (`clock.start()`, après le décompte), et c'est pour s'aligner sur CE
 * compteur que `spam_tick` ajoute le décompte à son plafond : le serveur, lui, mesure
 * depuis `StartRace`, qui tombe un décompte plus tôt. Pure.
 */
export function capRemaining(elapsedMs: number, capS: number): number {
  return Math.max(0, Math.ceil(capS - Math.max(0, elapsedMs) / 1000));
}

/**
 * Qui est en dernière position — donc qui brûlera au prochain tic (ADR 0015). Même règle
 * que le serveur : le minimum de `charsDone`, et TOUS les ex æquo (une égalité les emporte
 * tous les deux, aucun départage n'étant honnête). Vide si moins de deux vivants : il n'y
 * a plus personne à condamner. Pure — c'est le test qui la garde alignée sur `lava_tick`.
 */
export function lastPlaced(alive: { playerId: string; done: number }[]): Set<string> {
  if (alive.length < 2) return new Set();
  const least = Math.min(...alive.map((a) => a.done));
  return new Set(alive.filter((a) => a.done === least).map((a) => a.playerId));
}

/**
 * Les vivants (ADR 0015) : `racers` doit être la liste FIGÉE au RaceStart, jamais les
 * présents courants — un rejoignant en cours de course ne doit jamais s'y compter, ni
 * comme candidat au feu, ni comme le dernier vivant qui clôt la course.
 */
export function aliveIds(racers: string[], states: Map<string, RacerState>): string[] {
  return racers.filter((id) => {
    const s = states.get(id);
    return s === undefined || s.kind === "racing";
  });
}

/**
 * Qui est Devancé quand Spam s'arrête (ADR 0016) — parmi ceux ENCORE en course à cet
 * instant. Si quelqu'un a atteint le seuil, c'est lui le vainqueur et tous les autres sont
 * Devancé. Sinon (plafond de temps écoulé, personne ne l'a atteint) le glossaire tranche :
 * « qui en a le plus quand le temps est écoulé » gagne — c'est donc le plus haut compte
 * CONNU qui fait office de seuil, et tout le reste est Devancé. Les ex æquo au sommet ne
 * sont jamais Devancé (même règle que `lastPlaced` : aucun départage n'est honnête). Pure.
 */
export function outpaced(
  racing: { playerId: string; reps: number }[],
  threshold: number,
): { playerId: string; reps: number }[] {
  if (racing.length === 0) return [];
  const reachedThreshold = racing.some((r) => r.reps >= threshold);
  const bar = reachedThreshold ? threshold : Math.max(...racing.map((r) => r.reps));
  return racing.filter((r) => r.reps < bar);
}

/**
 * Secondes avant la prochaine élimination (ADR 0015). Dérivé en local de
 * `t=0 + n × intervalle` : le client connaît l'horaire depuis le départ, aucun événement
 * serveur n'est nécessaire pour l'afficher. Toujours dans `1..=intervalle`.
 */
export function nextBurnIn(elapsedMs: number, intervalS: number): number {
  const interval = Math.max(1, intervalS);
  const remaining = interval - ((Math.max(0, elapsedMs) / 1000) % interval);
  // `ceil` : on affiche « 1 s » pendant la dernière seconde, jamais « 0 s » — un zéro
  // resterait affiché une seconde entière avant que le tic ne tombe vraiment.
  return Math.max(1, Math.min(interval, Math.ceil(remaining)));
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

/** Les Modes de jeu offerts (ADR 0015, 0016). Un seul à la fois : ils ne se cumulent pas. */
const GAME_MODES: GameMode[] = ["normal", "floorIsLava", "spam"];

const GAME_MODE_LABELS: Record<GameMode, string> = {
  normal: "Normal",
  floorIsLava: "Floor is lava",
  spam: "Spam",
};

/**
 * De combien de répétitions le client pousse le texte de Spam devant le curseur (ADR 0016).
 * Assez pour que les lignes visibles soient toujours remplies, et assez pour qu'une rafale
 * de frappes entre deux rendus ne rattrape jamais la fin du tableau.
 *
 * ponytail: le texte n'est jamais élagué par l'arrière, donc `wordsHtml` re-rend tous les
 * mots déjà tapés à chaque frappe — au plafond de 60 s ça plafonne vers 400 mots, du même
 * ordre que les 200 mots imposés de floor is lava. Si ça devient visible, c'est une fenêtre
 * de rendu qu'il faut (ne dessiner que les lignes visibles), pas un lookahead plus petit.
 */
const SPAM_LOOKAHEAD = 30;

/**
 * Combien de répétitions ajouter au texte pour garder `SPAM_LOOKAHEAD` mots devant le
 * curseur — 0 s'il y a déjà de la marge (ADR 0016). C'est le cœur du « texte infini » :
 * extrait ici pour être testable, la méthode qui l'appelle ne faisant plus que pousser.
 *
 * Le serveur pose `SPAM_LEAD_WORDS` (60) mots au départ ; à partir de là c'est cette
 * fonction seule qui décide de la longueur, sans jamais rien demander au serveur. Pure.
 */
export function spamRefill(length: number, wordIndex: number): number {
  return wordIndex + SPAM_LOOKAHEAD < length ? 0 : SPAM_LOOKAHEAD;
}

/**
 * Répétitions correctes verrouillées (ADR 0016) : les mots de la pile égaux au mot cible.
 * Une répétition en cours de frappe n'en est pas une — seul un mot verrouillé compte.
 *
 * Se relit intégralement de la pile à chaque appel, jamais un compteur tenu à part : c'est
 * exactement ce qui fait que Backspace (qui rouvre le dernier mot verrouillé) décompte la
 * répétition sans une ligne de code de plus. Pure.
 */
export function spamReps(word: string, view: InputView): number {
  if (word === "") return 0;
  return view.lockedWords.filter((w) => w === word).length;
}

// ----------------------------------------------------------------------------
//  Réglages de salon (issue #131) — modèle de ligne, sur le patron de settings.ts, adapté
//  à la disposition du lobby (icône « i » plutôt que description toujours visible : le
//  lobby est un panneau compact à côté de la piste, pas un écran dédié). Rendu PUR, testé
//  sans DOM comme `settings.test.ts`.
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
  // L'explication est un <button> et non un <span> : c'est ce qui la rend atteignable au
  // TAP (le focus l'ouvre) et au clavier, sans une ligne de JS. Le survol la donne à la
  // souris, le focus au doigt — deux pseudo-classes, aucun écouteur.
  return `<div class="lobby-row">
    <div class="lobby-key">${name}<button type="button" class="info"
      aria-label="Explication : ${escapeText(row.label)}">i<span class="tip" role="tooltip">${escapeText(row.tip)}</span></button></div>
    <div class="lobby-ctl">${ctl}</div>
  </div>`;
}

/** Libellés de Difficulté (issue #71) — Expert n'apparaît dans aucun `select` de Room,
 *  mais reste couvert ici : `this.difficulty` a le type `Difficulty` au complet. */
const DIFFICULTY_LABELS: Record<Difficulty, string> = { normal: "Normal", expert: "Expert", master: "Master" };

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

/**
 * Course terminée = TOUT le texte tapé exactement. Le curseur reste libre (on peut
 * avancer avec des fautes) mais on ne finit qu'une fois tout corrigé. Fonction pure.
 */
export function raceComplete(targetWords: string[], view: InputView): boolean {
  const n = targetWords.length;
  if (n === 0) return false;
  const lockedExact = view.lockedWords.every((w, i) => w === targetWords[i]);
  // Espace tapé après le dernier mot : tous les mots verrouillés et exacts.
  if (view.lockedWords.length === n) return lockedExact;
  // Dernier mot en cours de frappe : précédents exacts + mot courant exact.
  if (view.lockedWords.length === n - 1) return lockedExact && view.typed === targetWords[n - 1];
  return false;
}
