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
import { avatarUrl, getIdentity, proxyBase } from "../discord";

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

export class Race {
  private me = "";
  private channelId = "";
  /** Ma Display identity, annoncée à la jointure (jamais résolue par le serveur). */
  private identity: Identity = { displayName: "", avatarHash: null };
  private socket: RaceSocket | null = null;

  private phase: Phase = "connecting";
  /** Présents AVEC leur Display identity — c'est ce que la piste dessine. */
  private players: PlayerEntry[] = [];
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
  /** Message affiché en phase "failed" (code inconnu, Room pleine). */
  private failure = "";

  private clock = new RunClock();
  private controller = new FreeInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;
  /** Nombre de mots verrouillés au dernier `Progress` diffusé (#94) — le seul déclencheur. */
  private lastLockedSent = 0;

  /** charsDone diffusé par joueur (barres, non autoritaire). */
  private progress = new Map<string, number>();
  /** WPM autoritaire par joueur ayant fini (signal LIVE, pour la piste). */
  private finished = new Map<string, number>();
  /** Joueurs ayant ABANDONNÉ — la piste affiche « abandon », jamais leur « 0 wpm ». */
  private forfeited = new Set<string>();
  /** Joueurs ayant ÉCHOUÉ (Master, ADR 0013), avec leur pourcentage — la piste affiche
   *  « échec (X%) », jamais « abandon » ni leur « 0 wpm ». */
  private failedPercents = new Map<string, number>();
  /** Joueurs BRÛLÉS (ADR 0015) avec l'instant du décès en ms — la piste affiche
   *  « brûlé à X s » et embrase leur ligne. Sert aussi à savoir qui est encore vivant. */
  private burned = new Map<string, number>();
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
        this.targetText = e.targetText;
        this.targetWords = e.targetText.split(" ").filter((w) => w.length > 0);
        // Duel à l'écran : on met à jour les données (join/leave du lobby d'après-course)
        // mais on NE re-render PAS — sinon on effacerait le Play of the Game en pleine lecture.
        if (this.potgStop) return;
        if (this.phase === "connecting") this.phase = "lobby";
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
        this.progress.set(e.playerId, e.charsDone);
        if (this.phase === "running") this.renderBars();
        break;
      case "PlayerFinished":
        this.finished.set(e.playerId, e.wpm);
        if (e.forfeit) this.forfeited.add(e.playerId);
        if (e.failedPercent !== null) this.failedPercents.set(e.playerId, e.failedPercent);
        if (this.phase === "running") this.renderBars();
        break;
      case "PlayerBurned":
        this.onBurned(e.playerId, e.atMs);
        break;
      case "RaceOver":
        this.results = e.results;
        this.playOfTheGame = e.playOfTheGame;
        // Snapshot AVANT que le RoomState de revanche (ordonné après) n'écrase targetWords.
        this.racedWords = this.targetWords.slice();
        this.phase = "over";
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
    this.burned.set(playerId, atMs);
    if (playerId === this.me) this.stopAndSubmit();
    else if (this.isLastAlive()) this.stopAndSubmit();
    if (this.phase === "running") this.renderBars();
  }

  /** Les vivants : présents ni brûlés ni déjà sortis (arrivée, abandon, échec). */
  private alive(): PlayerEntry[] {
    return this.players.filter(
      (p) => !this.burned.has(p.playerId) && !this.finished.has(p.playerId),
    );
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
    this.progress.clear();
    this.finished.clear();
    this.forfeited.clear();
    this.failedPercents.clear();
    this.burned.clear();
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
    const locked = this.controller.view().lockedWords.length;
    if (locked !== this.lastLockedSent) {
      this.lastLockedSent = locked;
      this.socket?.send({ type: "Progress", charsDone: this.charsDone() });
    }

    // Fin de course : uniquement quand TOUT le texte est exact (flux jamais bloqué,
    // mais il faut avoir corrigé ses fautes pour terminer).
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
    this.wireSourceButtons();
    this.root
      .querySelector<HTMLSelectElement>("#maxPlayers")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetMaxPlayers",
          max: Number((e.target as HTMLSelectElement).value),
        }),
      );
    this.root
      .querySelector<HTMLSelectElement>("#raceCountdown")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetCountdown",
          seconds: Number((e.target as HTMLSelectElement).value),
        }),
      );
    this.root
      .querySelector<HTMLInputElement>("#readyCheck")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetReadyCheck",
          enabled: (e.target as HTMLInputElement).checked,
        }),
      );
    this.root.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click", () => {
      const me = this.players.find((p) => p.playerId === this.me);
      this.socket?.send({ type: "SetReady", ready: !(me?.ready ?? false) });
    });
    this.root
      .querySelector<HTMLSelectElement>("#raceDifficulty")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetDifficulty",
          difficulty: (e.target as HTMLSelectElement).value as Difficulty,
        }),
      );
    this.root
      .querySelector<HTMLSelectElement>("#raceGameMode")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetGameMode",
          mode: (e.target as HTMLSelectElement).value as GameMode,
        }),
      );
    this.root
      .querySelector<HTMLSelectElement>("#lavaInterval")
      ?.addEventListener("change", (e) =>
        this.socket?.send({
          type: "SetLavaInterval",
          seconds: Number((e.target as HTMLSelectElement).value),
        }),
      );
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

  /** Passer à `words` conserve la longueur courante, sinon on retombe sur la médiane. */
  private wireSourceButtons(): void {
    const send = (source: TextSource): void =>
      this.socket?.send({ type: "SetTextSource", source });
    this.root.querySelectorAll<HTMLButtonElement>("[data-src]").forEach((b) => {
      b.addEventListener("click", () =>
        send(
          b.dataset.src === "quote"
            ? { kind: "quote" }
            : { kind: "words", count: currentCount(this.textSource) },
        ),
      );
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-len]").forEach((b) => {
      b.addEventListener("click", () =>
        send({ kind: "words", count: Number(b.dataset.len) }),
      );
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
          // Les cinq Réglages de salon dans UNE grille (#95) : c'est le conteneur commun
          // qui les aligne, pas cinq blocs qui se ressemblent de loin.
          // La Source est MASQUÉE en floor is lava : le mode impose son texte (ADR 0015),
          // l'afficher laisserait croire qu'on peut encore le choisir.
          `<div class="lobby-settings">${
            this.gameModeHtml() +
            this.lavaIntervalHtml() +
            (this.gameMode === "floorIsLava" ? "" : this.sourceHtml()) +
            this.sizeHtml() +
            this.countdownHtml() +
            this.readyCheckHtml() +
            this.difficultyHtml()
          }</div>` +
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
          <p class="hint">${this.doneLocal ? "Terminé — en attente des autres…" : "Tape le texte ; corrige tes fautes pour finir"}</p>
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

  /** Code de partie, affiché à TOUT le lobby : n'importe qui peut inviter, pas que l'hôte. */
  private codeHtml(): string {
    if (this.code === null) return "";
    return `<p class="race-code">Code de partie : <strong>${escapeText(this.code)}</strong></p>`;
  }

  /**
   * Réglage de la Source de texte (ADR 0009). Boutons pour l'hôte, simple mention pour
   * les autres : ils doivent SAVOIR ce qui les attend sans pouvoir le changer.
   * La longueur n'existe que pour `words` — celle d'une Quote appartient à la citation.
   */
  private sourceHtml(): string {
    const src = this.textSource;
    if (this.me !== this.owner) {
      return lobbyRow("Texte", LOBBY_TIPS.source, lobbyValue(sourceLabel(src)));
    }
    const on = (active: boolean) => (active ? ' class="on"' : "");
    const lengths =
      src.kind === "words"
        ? `<div class="lobby-seg">${WORDS_LENGTHS.map(
            (n, i) =>
              `<button data-len="${n}"${on(src.count === n)}>${LENGTH_LABELS[i]} ${n}</button>`,
          ).join("")}</div>`
        : "";
    return lobbyRow(
      "Texte",
      LOBBY_TIPS.source,
      `<div class="lobby-seg">
        <button data-src="quote"${on(src.kind === "quote")}>Citation</button>
        <button data-src="words"${on(src.kind === "words")}>Mots</button>
      </div>${lengths}`,
    );
  }

  /**
   * Taille max de la Room (issue #62). `select` natif plutôt que sept boutons : choisir
   * une valeur dans une plage est exactement ce que l'élément natif fait, clavier et
   * lecteur d'écran compris. Les non-hôtes lisent le compte : ils subissent le réglage.
   */
  private sizeHtml(): string {
    const taken = this.players.length;
    if (this.me !== this.owner) {
      return lobbyRow("Salon", LOBBY_TIPS.size, lobbyValue(`${taken}/${this.maxPlayers} joueurs`));
    }
    const opts = ROOM_SIZES.map(
      (n) =>
        `<option value="${n}"${n === this.maxPlayers ? " selected" : ""}>${n} joueurs</option>`,
    ).join("");
    return lobbyRow(
      "Salon",
      LOBBY_TIPS.size,
      `<select id="maxPlayers">${opts}</select><span class="lobby-note">${taken} présents</span>`,
      "maxPlayers",
    );
  }

  /**
   * Durée du décompte avant le départ (issue #61). Même patron que la taille max :
   * `select` natif pour l'hôte, simple mention pour les autres — ils subissent le réglage.
   */
  private countdownHtml(): string {
    if (this.me !== this.owner) {
      return lobbyRow("Décompte", LOBBY_TIPS.countdown, lobbyValue(`${this.countdownS} s`));
    }
    const opts = COUNTDOWN_VALUES.map(
      (n) => `<option value="${n}"${n === this.countdownS ? " selected" : ""}>${n} s</option>`,
    ).join("");
    return lobbyRow(
      "Décompte",
      LOBBY_TIPS.countdown,
      `<select id="raceCountdown">${opts}</select>`,
      "raceCountdown",
    );
  }

  /**
   * Ready-check (issue #63) : case à cocher pour l'hôte, simple mention pour les autres —
   * même patron que les autres réglages de salon.
   */
  private readyCheckHtml(): string {
    if (this.me !== this.owner) {
      return lobbyRow(
        "Ready-check",
        LOBBY_TIPS.ready,
        lobbyValue(this.readyCheck ? "Activé" : "Désactivé"),
      );
    }
    // La case n'est plus une checkbox nue : `.lobby-check` lui donne la même bordure et
    // le même fond que les `select` voisins (#95). L'input reste natif dessous — clavier
    // et lecteur d'écran inchangés, seule la peinture change.
    return lobbyRow(
      "Ready-check",
      LOBBY_TIPS.ready,
      `<label class="lobby-check">
        <input type="checkbox" id="readyCheck"${this.readyCheck ? " checked" : ""}>
        <span>${this.readyCheck ? "Activé" : "Désactivé"}</span>
      </label>`,
    );
  }

  /** Bouton pour se marquer prêt/pas prêt — seulement visible quand le réglage est actif. */
  private readyBtnHtml(): string {
    if (!this.readyCheck) return "";
    const ready = this.players.find((p) => p.playerId === this.me)?.ready ?? false;
    return `<button id="toggleReady" class="${ready ? "on" : ""}">${ready ? "Prêt ✓" : "Se dire prêt"}</button>`;
  }

  /**
   * Difficulté de la Room (issue #71, ADR 0013) : Normal | Master seulement — Expert
   * n'est pas un Réglage de salon, sa condition de déclenchement y est inatteignable.
   * Même patron que les autres réglages : `select` pour l'hôte, mention pour les autres.
   */
  private difficultyHtml(): string {
    if (this.me !== this.owner) {
      return lobbyRow(
        "Difficulté",
        LOBBY_TIPS.difficulty,
        lobbyValue(DIFFICULTY_LABELS[this.difficulty]),
      );
    }
    const opts = ROOM_DIFFICULTIES.map(
      (d) => `<option value="${d}"${d === this.difficulty ? " selected" : ""}>${DIFFICULTY_LABELS[d]}</option>`,
    ).join("");
    return lobbyRow(
      "Difficulté",
      LOBBY_TIPS.difficulty,
      `<select id="raceDifficulty">${opts}</select>`,
      "raceDifficulty",
    );
  }

  /**
   * Mode de jeu (ADR 0015) : comment la course se GAGNE. Même patron que les autres
   * réglages — `select` pour l'hôte, mention pour les autres, qui le subissent.
   */
  private gameModeHtml(): string {
    if (this.me !== this.owner) {
      return lobbyRow("Mode de jeu", LOBBY_TIPS.gameMode, lobbyValue(GAME_MODE_LABELS[this.gameMode]));
    }
    const opts = GAME_MODES.map(
      (m) => `<option value="${m}"${m === this.gameMode ? " selected" : ""}>${GAME_MODE_LABELS[m]}</option>`,
    ).join("");
    return lobbyRow("Mode de jeu", LOBBY_TIPS.gameMode, `<select id="raceGameMode">${opts}</select>`, "raceGameMode");
  }

  /** Intervalle d'élimination — n'apparaît QUE quand floor is lava est choisi. */
  private lavaIntervalHtml(): string {
    if (this.gameMode !== "floorIsLava") return "";
    if (this.me !== this.owner) {
      return lobbyRow("Élimination", LOBBY_TIPS.lava, lobbyValue(`toutes les ${this.lavaIntervalS} s`));
    }
    const opts = LAVA_INTERVAL_VALUES.map(
      (n) => `<option value="${n}"${n === this.lavaIntervalS ? " selected" : ""}>toutes les ${n} s</option>`,
    ).join("");
    return lobbyRow("Élimination", LOBBY_TIPS.lava, `<select id="lavaInterval">${opts}</select>`, "lavaInterval");
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
      live.innerHTML = `<span class="live-wpm">${wpm} wpm</span>${lava}`;
    }
  }

  /**
   * La piste : une ligne par joueur, la voiture en tête de sa progression, le WPM à la
   * ligne d'arrivée. Même donnée que les anciennes barres (`charsDone`), autre costume.
   */
  private barsHtml(): string {
    const total = Math.max(1, this.targetText.length);
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
              done: p.playerId === this.me ? this.charsDone() : this.progress.get(p.playerId) ?? 0,
            })),
          )
        : new Set<string>();
    return this.players
      .map((p) => {
        const isMe = p.playerId === this.me;
        const done = isMe ? this.charsDone() : this.progress.get(p.playerId) ?? 0;
        const final = this.finished.get(p.playerId);
        const burnedAt = this.burned.get(p.playerId);
        const pct = trackPercent(done, total, {
          finished: final !== undefined,
          forfeited: this.forfeited.has(p.playerId),
          failed: this.failedPercents.has(p.playerId),
        });
        const label = trackLabel(
          this.forfeited.has(p.playerId),
          this.failedPercents.get(p.playerId),
          final,
          liveWpmOf(done, elapsed),
          burnedAt,
        );
        // La ligne d'un brûlé RESTE à l'écran, carbonisée : voir le cimetière se remplir
        // fait partie du mode. `.burned` porte l'embrasement, `.doomed` le sursis.
        const classes = [
          "bar",
          isMe ? "me" : "",
          final !== undefined ? "done" : "",
          burnedAt !== undefined ? "burned" : "",
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
      endAtFirst: this.gameMode === "floorIsLava",
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

/**
 * Remplissage de la piste, en pourcentage.
 *
 * Une VRAIE arrivée remplit la piste à fond quoi qu'ait dit le dernier `Progress` :
 * depuis #94 le dernier mot n'est pas verrouillé quand on finit sans taper d'espace
 * derrière, et la voiture s'arrêterait à un mot de la ligne d'arrivée.
 *
 * Mais un abandon et un échec Master arrivent par le MÊME `PlayerFinished` que l'arrivée.
 * Sans les exclure, la voiture de celui qui renonce à 10 % se téléporte sur la ligne
 * d'arrivée pendant que son étiquette dit « abandon ». Ils restent où ils se sont
 * arrêtés — c'est exactement ce que la piste doit raconter. Pure.
 */
export function trackPercent(
  done: number,
  total: number,
  state: { finished: boolean; forfeited: boolean; failed: boolean },
): number {
  if (state.finished && !state.forfeited && !state.failed) return 100;
  return Math.min(100, Math.round((done / Math.max(1, total)) * 100));
}

/**
 * Étiquette de la ligne d'arrivée sur la piste. Un abandon affiche « abandon » et JAMAIS
 * « 0 wpm » — le flag est explicite, on ne le déduit pas d'un WPM nul. Un Échec Master
 * (ADR 0013) affiche « échec (X%) », distinct de l'abandon. Sinon : le WPM autoritaire
 * (✓) une fois fini, le WPM live dérivé tant qu'on court. Pure.
 */
export function trackLabel(
  forfeited: boolean,
  failedPercent: number | undefined,
  finalWpm: number | undefined,
  liveWpm: number,
  burnedAtMs?: number,
): string {
  // Le brûlé passe AVANT l'arrivée : son log revient par `Finish` (ADR 0015), donc un
  // `PlayerFinished` suit son décès — sans cette priorité, sa ligne redeviendrait
  // « 32 wpm ✓ » une seconde après avoir pris feu.
  if (burnedAtMs !== undefined) return `brûlé à ${Math.round(burnedAtMs / 1000)} s`;
  if (failedPercent !== undefined) return `échec (${failedPercent}%)`;
  if (forfeited) return "abandon";
  if (finalWpm !== undefined) return `${finalWpm} wpm ✓`;
  return `${liveWpm} wpm`;
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
 * Explications des cinq Réglages de salon (#95), servies par l'icône « i ». Elles vivent
 * ici, à côté des méthodes qui dessinent les réglages, pour qu'ajouter un réglage sans son
 * explication saute aux yeux.
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
    "Comment la course se gagne. Normal : le premier à taper tout le texte. Floor is lava : le joueur le moins avancé brûle à intervalle régulier, et le dernier vivant gagne — il n'y a pas de ligne d'arrivée, le texte est trop long pour être fini.",
  lava:
    "Toutes les combien de secondes le joueur le moins avancé est éliminé. La première élimination tombe au bout d'un intervalle complet, jamais avant.",
} as const;

/** Les Modes de jeu offerts (ADR 0015). Un seul à la fois : ils ne se cumulent pas. */
const GAME_MODES: GameMode[] = ["normal", "floorIsLava"];

const GAME_MODE_LABELS: Record<GameMode, string> = {
  normal: "Normal",
  floorIsLava: "Floor is lava",
};

/**
 * Une ligne de Réglage de salon (#95) : libellé + icône « i » à gauche, contrôle à droite.
 * Ce patron unique est ce qui ALIGNE les cinq réglages — avant, chacun réutilisait `.hint`
 * (pensée pour un paragraphe centré isolé) et retombait où il pouvait.
 *
 * Les non-hôtes reçoivent la valeur en lecture seule dans la même colonne, à la même
 * place, avec la même explication : ils subissent le réglage, ils doivent le comprendre.
 *
 * `forId` relie le libellé à son contrôle quand celui-ci est un `select` ; le Ready-check
 * s'en passe, son `<label>` enveloppe déjà sa case.
 */
function lobbyRow(label: string, tip: string, control: string, forId?: string): string {
  const name = forId
    ? `<label for="${forId}">${escapeText(label)}</label>`
    : `<span>${escapeText(label)}</span>`;
  // L'explication est un <button> et non un <span> : c'est ce qui la rend atteignable au
  // TAP (le focus l'ouvre) et au clavier, sans une ligne de JS. Le survol la donne à la
  // souris, le focus au doigt — deux pseudo-classes, aucun écouteur.
  return `<div class="lobby-row">
    <div class="lobby-key">${name}<button type="button" class="info"
      aria-label="Explication : ${escapeText(label)}">i<span class="tip" role="tooltip">${escapeText(tip)}</span></button></div>
    <div class="lobby-ctl">${control}</div>
  </div>`;
}

/** Valeur d'un réglage en lecture seule (vue des non-hôtes) — même colonne, même ligne. */
function lobbyValue(v: string): string {
  return `<span class="lobby-value">${escapeText(v)}</span>`;
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
