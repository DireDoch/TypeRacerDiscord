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
  type ServerEvent,
  type TextSource,
} from "../core/net";
import { podiumHtml, wirePodium, type PodiumOptions } from "./podium";
import { DIFFICULTY_LABELS } from "./mode-labels";
import { runPlayOfTheGame } from "./potg";
import { liveWpm } from "../live-stats";
import { wordsHtml, placeCaret, escapeText } from "./typing-zone";
import { infoHtml, glyphTipHtml } from "./info-bubble";
import { loadPreferences } from "../core/preferences";
import {
  avatarUrl,
  getIdentity,
  proxyBase,
  updateActivity,
  type ActivityExtra,
  type ActivityState,
} from "../discord";
import {
  reduce,
  initialRaceState,
  stateOf,
  charsOf,
  repsFor,
  alive,
  isLastAlive,
  type RaceState,
  type RacerState,
} from "../core/race-state";

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

// `Phase`, `RacerState` et `advanceState` vivent désormais dans `core/race-state.ts`
// (issue #132/#139) : c'est l'état piloté par le serveur, plus une décision de vue.

export class Race {
  private me = "";
  private channelId = "";
  /** Ma Display identity, annoncée à la jointure (jamais résolue par le serveur). */
  private identity: Identity = { displayName: "", avatarHash: null };
  private socket: RaceSocket | null = null;

  /** État piloté par le serveur — phase, présents, réglages de Room, `RacerState` par
   *  joueur, résultats — voir `core/race-state.ts` (issue #132/#139). Transitionne
   *  UNIQUEMENT via `reduce()`, sauf `phase: "running"` : posé en local par le Countdown
   *  (aucun ServerEvent ne l'annonce), et le texte de Spam, rallongé en place par
   *  `topUpSpamText` (FreeInput tient `targetWords` par référence). */
  private state: RaceState = initialRaceState();

  private clock = new RunClock();
  private controller = new FreeInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;
  /** Nombre de mots verrouillés au dernier `Progress` diffusé (#94) — le seul déclencheur. */
  private lastLockedSent = 0;

  /** Handle d'arrêt du Play of the Game : sa présence EST « le duel est à l'écran ». */
  private potgStop: (() => void) | null = null;
  /**
   * Réglages dépliés sur le podium (#161). Chaque `RoomState` re-rend tout le `<section>` —
   * y compris celui que le réglage qu'on vient de changer provoque — donc le `<details>`
   * repartirait fermé à chaque clic. Purement cosmétique : n'entre dans aucune transition
   * de phase, ne décide d'aucun écran.
   */
  private settingsOpen = false;
  /**
   * Code de partie révélé pour CE lobby (#184). Volontairement dans l'instance et non
   * dans la Preference : « je le montre maintenant » ne veut pas dire « montre-le
   * toujours ». Quitter la Room le remet à zéro sans une ligne de plus.
   */
  private codeRevealed = false;
  /**
   * Dernière présence poussée, sérialisée. `setActivity` est limité côté Discord (~5
   * appels par 20 s) et un `RoomState` arrive à CHAQUE join, départ ou réglage touché :
   * sans cette comparaison, republier la présence à chaque état du salon brûlerait le
   * quota pour rien, et c'est justement le changement de Mode de jeu — rare — qu'on veut
   * voir passer.
   */
  private lastActivity = "";
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
  /** Publie la présence, sauf si elle est identique à la dernière poussée. */
  private pushActivity(state: ActivityState, extra: ActivityExtra): void {
    const key = `${state}|${JSON.stringify(extra)}`;
    if (key === this.lastActivity) return;
    this.lastActivity = key;
    updateActivity(state, extra);
  }

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

  /**
   * `race.ts` ne décide plus la transition d'état — `reduce()` (core/race-state.ts,
   * issue #132/#140) la porte, pure et testée sans DOM ni WebSocket. Ce qui reste ici :
   * déclencher les EFFETS que la transition appelle (Countdown, rAF, `socket.send`,
   * `updateActivity`, `render`) en comparant la phase avant/après.
   */
  private onEvent(e: ServerEvent): void {
    const prevPhase = this.state.phase;
    this.state = reduce(this.state, e, { me: this.me, myReps: this.myReps() });
    switch (e.type) {
      case "RoomState":
        // Duel à l'écran : on met à jour les données (join/leave du lobby d'après-course)
        // mais on NE re-render PAS — sinon on effacerait le Play of the Game en pleine lecture.
        if (this.potgStop) return;
        // À CHAQUE RoomState du salon, plus seulement à l'arrivée : changer le Mode de
        // jeu est justement ce qui doit changer le visuel affiché à ceux qui nous lisent.
        // `pushActivity` avale les répétitions, donc un join ou un réglage sans effet sur
        // la présence ne coûte pas un appel.
        if (this.state.phase === "lobby")
          this.pushActivity(lobbyActivityState(this.state.gameMode), activityExtra(this.state));
        this.render();
        break;
      // Jointure refusée : le socket reste ouvert côté serveur, mais la reprise se fait
      // par le menu (c'est lui qui porte le champ de saisie du code).
      case "RoomNotFound":
      case "RoomFull":
        this.render();
        break;
      case "RaceStart":
        // Un seul décompte vivant : `reduce` ignore un second RaceStart pendant le
        // décompte/la course, donc la phase n'a pas bougé — inutile d'y relancer les effets.
        if (prevPhase !== "countdown" && prevPhase !== "running") this.startCountdown();
        break;
      case "PlayerProgress":
        if (this.state.phase === "running") this.renderBars();
        break;
      // Spam terminé (ADR 0016) : seuil atteint par quelqu'un, ou plafond de temps expiré
      // — le message ne dit pas lequel, et personne n'a besoin de le savoir pour arrêter
      // de taper. Même geste que le brûlé de floor is lava : on livre son log et on
      // attend RaceOver, qui porte le seul classement qui compte (recompté par le serveur).
      case "SpamStop":
        this.stopAndSubmit();
        if (this.state.phase === "running") this.renderBars();
        break;
      case "PlayerFinished":
        // Un partant peut aussi sortir par Abandon/Échec Master, pas seulement par le
        // feu (ADR 0015) — sans ce même réflexe que PlayerBurned, le survivant ne se
        // déduirait dernier vivant qu'au watchdog (10 min).
        if (this.state.gameMode === "floorIsLava" && isLastAlive(this.state, this.me)) this.stopAndSubmit();
        if (this.state.phase === "running") this.renderBars();
        break;
      // Élimination floor is lava (ADR 0015). Le serveur a déjà décidé ; ce message dit au
      // brûlé d'arrêter de taper et de renvoyer son log. Le survivant, lui, n'a pas de
      // message à lui : il déduit sa victoire de ce qu'il ne reste que lui de vivant, et
      // envoie le sien de la même façon — sans ça, sa course ne se clôturerait qu'au
      // watchdog (10 min).
      case "PlayerBurned":
        if (e.playerId === this.me || isLastAlive(this.state, this.me)) this.stopAndSubmit();
        if (this.state.phase === "running") this.renderBars();
        break;
      case "RaceOver":
        // Podium affiché, mais on est revenu dans la Room — et le visuel du mode qu'on
        // vient de jouer reste à l'écran de ceux qui nous lisent (demande utilisateur :
        // « à la fin de la partie, le faire afficher quelque part »).
        this.pushActivity(lobbyActivityState(this.state.gameMode), activityExtra(this.state));
        cancelAnimationFrame(this.rafId);
        this.render();
        break;
    }
  }

  /** Arrête ma saisie et livre mon log — brûlé ou vainqueur, c'est le même geste.
   *
   *  `elapsed()` LÈVE tant que l'horloge n'a pas démarré, et un événement peut arriver
   *  avant le GO (course clôturée pendant le décompte parce que tout le monde a quitté,
   *  par exemple). L'exception remontait jusqu'à `onmessage` : le `Finish` n'était jamais
   *  envoyé et la Room attendait un log qui ne viendrait plus, jusqu'au watchdog de
   *  10 minutes. Rien à mesurer avant le GO — c'est zéro, et le log est vide de toute façon. */
  private stopAndSubmit(): void {
    if (this.doneLocal) return;
    this.doneLocal = true;
    const endedAtMs = this.clock.started ? this.clock.elapsed() : 0;
    this.socket?.send({ type: "Finish", keystrokes: this.log, endedAtMs });
  }

  // --- Cycle de course --------------------------------------------------------

  /**
   * Effets du passage en "countdown" — `reduce` a déjà gelé `racers`/`states`/
   * `playOfTheGame` et posé la phase ; seul l'appelant (`onEvent`) sait si la transition
   * a vraiment eu lieu (voir sa garde sur `prevPhase`), donc plus de garde ici.
   */
  private startCountdown(): void {
    // Un RaceStart reçu pendant le Play of the Game interrompt l'écran : la course prime.
    this.potgStop?.();
    this.potgStop = null;
    this.countdownN = this.state.countdownS;
    // Contrôleur neuf dès le décompte : le texte ENTIER s'affiche vierge (le joueur lit
    // le début pendant l'attente) — indispensable après une revanche (état stale).
    this.doneLocal = false;
    this.controller = new FreeInput(this.state.targetWords);
    this.countdown = new Countdown(
      this.state.countdownS,
      (n) => {
        this.countdownN = n;
        this.render();
      },
      () => this.beginRun(),
    );
    this.countdown.start();
  }

  /** `phase: "running"` n'est PAS posé par `reduce` : c'est ce Countdown local qui y
   *  bascule à zéro, sans qu'aucun ServerEvent ne l'annonce (issue #132/#140). */
  private beginRun(): void {
    this.countdown = null;
    this.state = { ...this.state, phase: "running" };
    this.pushActivity(
      this.state.gameMode === "normal" ? "race" : this.state.gameMode,
      activityExtra(this.state),
    );
    this.doneLocal = false;
    this.log = [];
    this.lastLockedSent = 0; // revanche : sans ça, aucun Progress ne repartirait
    this.controller = new FreeInput(this.state.targetWords);
    this.clock.start(); // t=0 (pilotée par RaceStart, plus par un décompte local isolé)
    this.render();
    this.loop();
  }

  /** Boucle d'affichage : rafraîchit mon WPM live tant que je cours. */
  private loop(): void {
    if (this.state.phase !== "running") return;
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
    if (this.state.gameMode !== "spam") return 0;
    return spamReps(this.state.targetWords[0] ?? "", this.controller.view());
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
    if (this.state.gameMode !== "spam") return;
    const word = this.state.targetWords[0];
    if (word === undefined) return;
    const n = spamRefill(this.state.targetWords.length, this.controller.view().wordIndex);
    if (n === 0) return;
    for (let i = 0; i < n; i++) this.state.targetWords.push(word);
    this.state.targetText = this.state.targetWords.join(" ");
  }

  /** charsDone = mots verrouillés (+ espaces) + préfixe correct du mot courant. */
  private charsDone(): number {
    const v = this.controller.view();
    const n = v.lockedWords.reduce((a, w) => a + w.length, 0) + v.lockedWords.length;
    const t = this.state.targetWords[v.wordIndex] ?? "";
    let i = 0;
    while (i < v.typed.length && i < t.length && v.typed[i] === t[i]) i++;
    return n + i;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.state.phase !== "running" || this.doneLocal) return;
    if (e.key !== "Backspace" && e.key !== " " && e.key.length !== 1) return;
    e.preventDefault();

    const k = this.controller.handleKey(e.key, e.ctrlKey, this.clock.elapsed());
    if (k) this.log.push(k);

    // Difficulté Master (issue #71, ADR 0013) : détectée localement sur le log free-input,
    // avant tout le reste. Le serveur REJOUE contre son propre texte pour confirmer avant
    // d'enregistrer un Échec — jamais fait confiance sur la seule parole du client.
    if (this.state.difficulty === "master") {
      const fail = detectDifficultyFailure("master", this.state.targetWords, this.log);
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
    if (raceComplete(this.state.targetWords, this.controller.view())) {
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
    if (this.state.phase !== "running" || this.doneLocal) return;
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
    this.root
      .querySelector<HTMLDetailsElement>(".lobby-reopen")
      ?.addEventListener("toggle", (e) => {
        this.settingsOpen = (e.target as HTMLDetailsElement).open;
      });
    this.root.querySelector<HTMLButtonElement>("#revealCode")?.addEventListener("click", () => {
      this.codeRevealed = true;
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>("#copyCode")?.addEventListener("click", (e) => {
      const code = this.state.code;
      if (code === null) return;
      // Le retour visuel se joue sur le bouton lui-même : dans l'iframe Discord la
      // permission presse-papiers peut être refusée, et un « Copié ✓ » qui ment serait
      // pire que pas de retour du tout. D'où le `.catch`, qui dit franchement non.
      const btn = e.currentTarget as HTMLButtonElement;
      navigator.clipboard
        .writeText(code)
        .then(() => (btn.textContent = "Copié ✓"))
        .catch(() => (btn.textContent = "Copie refusée"));
    });
    this.root.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click", () => {
      const me = this.state.players.find((p) => p.playerId === this.me);
      this.socket?.send({ type: "SetReady", ready: !(me?.ready ?? false) });
    });
    if (this.state.phase === "over") {
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
    switch (this.state.phase) {
      case "connecting":
        return `<p class="hint">Connexion…</p>`;
      case "failed":
        return `<p class="hint">${escapeText(this.state.failure)}</p>` + this.exitBtnHtml();
      case "lobby":
        return (
          this.codeHtml() +
          // Deux colonnes : QUI est là à gauche, ce qu'on va jouer à droite. Empilée sous
          // les Réglages, la liste des joueurs se retrouvait sous la ligne de flottaison
          // dès que le salon en comptait trois — or c'est elle qu'on regarde en attendant,
          // et c'est elle qui porte les « prêt ». Le bouton personnel « Se dire prêt » la
          // suit : on se déclare là où on lit son propre état.
          //
          // Les Réglages de salon se DÉCLARENT (`lobbyRows()`, sur le modèle de
          // `settings.ts:sections()`) et se rendent dans UNE grille (#95, issue #131) —
          // c'est le conteneur commun qui les aligne, pas dix méthodes qui se ressemblent
          // de loin. La Source est absente de la liste dès qu'un Mode de jeu impose son
          // texte (ADR 0015, 0016) : l'afficher laisserait croire qu'on peut encore le choisir.
          `<div class="lobby-body">
             <div class="lobby-roster">
               <h3 class="lobby-roster-title">Dans le salon · ${this.state.players.length}</h3>
               ${this.cardsHtml()}
               ${this.readyBtnHtml()}
             </div>
             <div class="lobby-settings">${this.lobbyRows().map(lobbyRowHtml).join("")}</div>
           </div>` +
          this.startBtnHtml() +
          this.exitBtnHtml()
        );
      case "countdown":
        return `<div class="countdown">${this.countdownN}</div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>`;
      case "running":
        return `<div class="live-bar" id="liveBar"></div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>
          <div class="bars" id="bars" style="--n:${this.state.players.length}">${this.barsHtml()}</div>
          <p class="hint">${this.doneLocal ? "Terminé — en attente des autres…" : this.runningHint()}</p>
          ${this.forfeitBtnHtml()}
          ${this.exitBtnHtml()}`;
      case "over":
        // Revanche : le serveur a déjà re-diffusé un RoomState avec un NOUVEAU texte ;
        // le même bouton StartRace relance (owner seulement). Le podium est donc posé
        // par-dessus un lobby DÉJÀ prêt — aucune séquence serveur, aucun minuteur.
        //
        // Les Réglages de salon sont REPOSÉS ici (issue #161), repliés : sans eux, la seule
        // façon de changer de Mode de jeu après une course était de quitter la Room — ce qui
        // transfère l'hôte (#23) et fait perdre la couronne à celui qui voulait régler.
        // C'est la MÊME grille que le lobby, donc le même `wireLobbySettings` la câble (il
        // ne cherche que `.lobby-settings`) et le même `locked` la met en lecture seule pour
        // les non-hôtes. `<details>` plutôt qu'un écran de plus : rien à afficher tant qu'on
        // ne l'ouvre pas, donc un podium de la même hauteur qu'avant.
        return (
          podiumHtml(this.podiumOptions()) +
          `<details class="lobby-reopen"${this.settingsOpen ? " open" : ""}>
             <summary>Réglages du salon</summary>
             <div class="lobby-settings">${this.lobbyRows().map(lobbyRowHtml).join("")}</div>
           </details>` +
          this.potgBtnHtml() +
          // `end_race` vide les prêts (« nouvelle manche = nouvelle confirmation », #63) et
          // `start_race` les exige : sans ce bouton ici, un salon en ready-check ne pouvait
          // plus jamais relancer depuis le podium — « Démarrer » refusé en silence (#165).
          this.readyBtnHtml() +
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
    if (this.state.gameMode === "spam") {
      return `Répète le mot ; ${this.state.spamThreshold} répétitions correctes pour gagner`;
    }
    if (this.state.gameMode === "floorIsLava") return "Tape sans t'arrêter : le dernier avance vers le feu";
    return "Tape le texte ; corrige tes fautes pour finir";
  }

  /**
   * Code de partie, affiché à TOUT le lobby : n'importe qui peut inviter, pas que l'hôte.
   *
   * Masqué par défaut (#184) — Preference `hideRaceCode`, donc device-local : ce qui
   * passe à l'antenne est l'écran du streamer, pas celui des invités. En faire un
   * Réglage de salon l'aurait caché à ceux qui doivent justement le lire.
   *
   * `codeRevealed` vit dans l'instance et non dans la Preference : révéler vaut pour
   * CE lobby, pas pour toujours. Quitter la Room le remet à zéro tout seul.
   */
  private codeHtml(): string {
    if (this.state.code === null) return "";
    const hidden = loadPreferences().hideRaceCode && !this.codeRevealed;
    const shown = hidden
      ? `<button type="button" id="revealCode" class="race-code-hidden"
           aria-label="Révéler le Code de partie">${"•".repeat(this.state.code.length)}</button>`
      : `<strong>${escapeText(this.state.code)}</strong>`;
    // « Copier » est ce qui rend le code utilisable SANS jamais l'afficher — sans lui, le
    // défaut masqué laisserait un hôte débutant ignorer qu'il existe un code à
    // communiquer, alors que c'est le seul chemin depuis un autre serveur Discord.
    return `<p class="race-code">Code de partie : ${shown}
      <button type="button" id="copyCode" class="secondary">Copier</button></p>`;
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
    const isOwner = this.me === this.state.owner;
    const rows: LobbyRow[] = [
      {
        id: "raceGameMode",
        label: "Mode de jeu",
        tip: LOBBY_TIPS.gameMode,
        locked: !isOwner,
        readOnly: GAME_MODE_LABELS[this.state.gameMode],
        control: {
          kind: "select",
          value: this.state.gameMode,
          options: GAME_MODES.map((m) => ({ value: m, label: GAME_MODE_LABELS[m] })),
        },
        set: (v) => ({ type: "SetGameMode", mode: v as GameMode }),
      },
    ];
    if (this.state.gameMode === "floorIsLava") {
      rows.push({
        id: "lavaInterval",
        label: "Élimination",
        tip: LOBBY_TIPS.lava,
        locked: !isOwner,
        readOnly: `toutes les ${this.state.lavaIntervalS} s`,
        control: {
          kind: "select",
          value: String(this.state.lavaIntervalS),
          options: LAVA_INTERVAL_VALUES.map((n) => ({ value: String(n), label: `toutes les ${n} s` })),
        },
        set: (v) => ({ type: "SetLavaInterval", seconds: Number(v) }),
      });
    }
    if (this.state.gameMode === "spam") {
      // Le mot RÉELLEMENT en jeu est celui du texte : sous mot par défaut, `spamWord` est
      // `null` et seul `targetText` sait lequel le serveur a tiré.
      const inPlay = this.state.targetWords[0] ?? "";
      rows.push(
        {
          id: "spamWord",
          label: "Mot",
          tip: LOBBY_TIPS.spamWord,
          locked: !isOwner,
          readOnly: inPlay,
          control: {
            kind: "text",
            value: this.state.spamWord ?? "",
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
          readOnly: `${this.state.spamThreshold} répétitions`,
          control: {
            kind: "select",
            value: String(this.state.spamThreshold),
            options: SPAM_THRESHOLD_VALUES.map((n) => ({ value: String(n), label: `${n} répétitions` })),
          },
          set: (v) => ({ type: "SetSpamThreshold", count: Number(v) }),
        },
        {
          id: "spamTimeCap",
          label: "Temps max",
          tip: LOBBY_TIPS.spamTimeCap,
          locked: !isOwner,
          readOnly: `${this.state.spamTimeCapS} s`,
          control: {
            kind: "select",
            value: String(this.state.spamTimeCapS),
            options: SPAM_TIME_CAP_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
          },
          set: (v) => ({ type: "SetSpamTimeCap", seconds: Number(v) }),
        },
      );
    }
    if (this.state.gameMode === "normal") {
      const src = this.state.textSource;
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
        // `currentCount(this.state.textSource)` : le repli quand on bascule sur « Mots » sans
        // avoir cliqué une longueur précise (garde la longueur courante, ou la médiane
        // si on vient de Citation, qui n'en a pas).
        set: (v) => textSourceEvent(v, currentCount(this.state.textSource)),
      });
    }
    rows.push(
      {
        id: "maxPlayers",
        label: "Salon",
        tip: LOBBY_TIPS.size,
        locked: !isOwner,
        readOnly: `${this.state.players.length}/${this.state.maxPlayers} joueurs`,
        note: isOwner ? `${this.state.players.length} présents` : undefined,
        control: {
          kind: "select",
          value: String(this.state.maxPlayers),
          options: ROOM_SIZES.map((n) => ({ value: String(n), label: `${n} joueurs` })),
        },
        set: (v) => ({ type: "SetMaxPlayers", max: Number(v) }),
      },
      {
        id: "raceCountdown",
        label: "Décompte",
        tip: LOBBY_TIPS.countdown,
        locked: !isOwner,
        readOnly: `${this.state.countdownS} s`,
        control: {
          kind: "select",
          value: String(this.state.countdownS),
          options: COUNTDOWN_VALUES.map((n) => ({ value: String(n), label: `${n} s` })),
        },
        set: (v) => ({ type: "SetCountdown", seconds: Number(v) }),
      },
      {
        id: "readyCheck",
        label: "Ready-check",
        tip: LOBBY_TIPS.ready,
        locked: !isOwner,
        readOnly: this.state.readyCheck ? "Activé" : "Désactivé",
        control: { kind: "toggle", value: this.state.readyCheck, onLabel: "Activé", offLabel: "Désactivé" },
        set: (v) => ({ type: "SetReadyCheck", enabled: v === "true" }),
      },
      {
        id: "raceDifficulty",
        label: "Difficulté",
        tip: LOBBY_TIPS.difficulty,
        locked: !isOwner,
        readOnly: DIFFICULTY_LABELS[this.state.difficulty],
        control: {
          kind: "select",
          value: this.state.difficulty,
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
    if (!this.state.readyCheck) return "";
    const ready = this.state.players.find((p) => p.playerId === this.me)?.ready ?? false;
    // `secondary`, le même vocabulaire que « Copier » juste au-dessus et que les boutons
    // de l'écran de résultats : sans classe, il restait un bouton natif blanc au milieu
    // d'un écran sombre. `ready` l'allume en vert — le seul endroit de l'app où cette
    // couleur sert, parce que c'est le seul état qui veut dire « c'est bon pour moi ».
    return `<button id="toggleReady" class="secondary${ready ? " ready" : ""}">${
      ready ? "Prêt ✓" : "Se dire prêt"
    }</button>`;
  }

  /** Cartes de présence empilées (owner en tête, moi souligné). */
  private cardsHtml(): string {
    const cards = this.state.players
      .map((p) => {
        const isOwner = p.playerId === this.state.owner;
        const isMe = p.playerId === this.me;
        const tags = [isOwner ? "owner" : "", isMe ? "me" : "", p.ready ? "is-ready" : ""]
          .filter(Boolean)
          .join(" ");
        const label = isMe ? `${p.displayName} (toi)` : p.displayName;
        const readyTag = this.state.readyCheck
          ? `<span class="card-ready">${p.ready ? "✓" : "⌛"}</span>`
          : "";
        // La couronne portait zéro explication (#182) : elle marque l'hôte, et l'hôte est
        // le seul à pouvoir toucher aux Réglages de salon (ADR 0009). Le dire là où le
        // symbole est, plutôt qu'ajouter une légende que personne ne lit.
        const crown = isOwner
          ? glyphTipHtml(
              "👑",
              "Hôte du salon",
              "L'hôte règle le mode de jeu, la source du texte et les autres réglages du salon, et c'est lui qui lance la course. Le rôle revient au premier arrivé, et passe au suivant s'il quitte la Room.",
            )
          : "";
        return `<div class="card ${tags}">${avatarHtml(p)} <span class="card-name">${escapeText(
          label,
        )}</span>${crown}${readyTag}</div>`;
      })
      .join("");
    return `<div class="cards">${cards}</div>`;
  }

  private startBtnHtml(): string {
    if (this.me === this.state.owner) {
      // Floor is lava exige deux partants (ADR 0015) : seul, on est déjà le dernier
      // vivant. Le serveur refuse en silence — le bouton doit donc dire pourquoi, sinon
      // l'hôte clique dans le vide sans comprendre.
      if (this.state.gameMode === "floorIsLava" && this.state.players.length < 2) {
        return `<button id="startRace" class="primary" disabled>Démarrer la course</button>
          <p class="hint">Floor is lava demande au moins deux joueurs — seul, tu es déjà le dernier vivant.</p>`;
      }
      // `primary` : c'est LE bouton de l'écran, et c'est le patron que « Recommencer »
      // et « Continuer » portent déjà ailleurs.
      return `<button id="startRace" class="primary">Démarrer la course</button>`;
    }
    return `<p class="hint">En attente que l'hôte lance la course…</p>`;
  }

  /**
   * `← menu`. Rendu dans les TROIS phases, course comprise (#186).
   *
   * Il manquait à `running`, et `forfeitBtnHtml()` s'efface dès `doneLocal` : un joueur
   * qui avait fini ou abandonné n'avait donc plus AUCUN bouton tant que `RaceOver`
   * n'arrivait pas — ni « Abandonner » (consommé), ni « ← menu » (jamais rendu ici).
   * Seul dans une Room, c'était un écran sans issue jusqu'au watchdog serveur.
   *
   * Partir en pleine course ne demande AUCUN code serveur nouveau : `destroy()` ferme
   * le socket, la boucle WS se termine et `leave_room` fait déjà le reste — retrait de
   * la présence, `close_race(room, true)` qui déclare abandon les partants restants dès
   * que plus personne n'attend, et suppression pure et simple d'une Room devenue vide
   * (son Code meurt avec elle, ADR 0008). Le glossaire (**Abandon**) veut un seul
   * chemin pour l'abandon et la déconnexion : c'est celui-là.
   */
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
    return wordsHtml(this.state.targetWords, this.controller.view(), !this.doneLocal);
  }

  private renderBars(): void {
    const bars = this.root.querySelector<HTMLElement>("#bars");
    if (bars) {
      // `--n` = le nombre de pistes à faire tenir (#96) : c'est lui qui décide de la
      // hauteur des jauges. Il est reposé ici parce qu'un joueur peut quitter la Room
      // en pleine course, et que la piste doit alors se ré-agrandir.
      bars.style.setProperty("--n", String(this.state.players.length));
      bars.innerHTML = this.barsHtml();
    }
    const live = this.root.querySelector<HTMLElement>("#liveBar");
    if (live) {
      const wpm = this.doneLocal ? 0 : liveWpm(this.state.targetWords, this.controller.view(), this.clock.elapsed());
      // Le décompte avant la prochaine brûlure : c'est lui qui rend le mode angoissant.
      // Tant qu'il reste quelqu'un à éliminer — sinon la course est déjà jouée.
      const lava =
        this.state.gameMode === "floorIsLava" && alive(this.state).length > 1
          ? `<span class="live-lava">🔥 ${nextBurnIn(this.clock.elapsed(), this.state.lavaIntervalS)} s</span>`
          : "";
      // Les DEUX façons de gagner, côte à côte (ADR 0016) : ce qu'il me reste à taper, et
      // ce qu'il me reste de temps pour le faire. Une seule des deux affichée laisserait
      // le joueur ignorer laquelle va claquer.
      const spam =
        this.state.gameMode === "spam"
          ? `<span class="live-spam">${this.myReps()} / ${this.state.spamThreshold} ×</span>
             <span class="live-spam">⏱ ${capRemaining(this.clock.elapsed(), this.state.spamTimeCapS)} s</span>`
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
    const spam = this.state.gameMode === "spam";
    const total = spam ? Math.max(1, this.state.spamThreshold) : Math.max(1, this.state.targetText.length);
    const elapsed = this.clock.elapsed();
    // Le condamné en sursis (ADR 0015) : marqué EN PERMANENCE, pas seulement au tic.
    // C'est ça, le mode — pas des morts surprises, mais quelques secondes à se voir
    // dernier en tapant plus vite. Calculé en local sur la même règle que le serveur ;
    // mon propre `charsDone` est plus frais que celui qu'il a reçu, donc c'est un
    // avertissement, jamais un verdict.
    const ctx = { me: this.me, myReps: this.myReps() };
    const doomed =
      this.state.gameMode === "floorIsLava" && this.state.phase === "running"
        ? lastPlaced(
            alive(this.state).map((p) => ({
              playerId: p.playerId,
              done: p.playerId === this.me ? this.charsDone() : charsOf(stateOf(this.state, p.playerId)),
            })),
          )
        : new Set<string>();
    return this.state.players
      .map((p) => {
        const isMe = p.playerId === this.me;
        const state = stateOf(this.state, p.playerId);
        const chars = isMe ? this.charsDone() : charsOf(state);
        const reps = repsFor(this.state, ctx, p.playerId);
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
    return {
      results: this.state.results,
      players: this.state.players,
      me: this.me,
      gameMode: this.state.gameMode,
    };
  }

  /** Bouton du duel — présent seulement quand le serveur a désigné un Play of the Game. */
  private potgBtnHtml(): string {
    return this.state.playOfTheGame ? `<button id="playOfTheGame" class="on">Play of the Game</button>` : "";
  }

  /**
   * Ouvre le duel : monte l'écran autonome (`runPlayOfTheGame`) et garde son handle
   * d'arrêt — sa présence gèle le re-render sur `RoomState` (voir la garde). On NE change
   * PAS de phase : `potgStop` est le seul signal « duel à l'écran ». Retour → on redessine
   * le podium (phase toujours "over").
   */
  private openPotg(): void {
    const potg = this.state.playOfTheGame;
    if (!potg) return;
    const entry = (id: string): PlayerEntry =>
      this.state.players.find((p) => p.playerId === id) ?? {
        playerId: id,
        displayName: id, // parti depuis : on retombe sur le snowflake, comme le podium
        avatarHash: null,
        ready: false,
      };
    this.potgStop = runPlayOfTheGame(this.root, {
      racedWords: this.state.racedWords,
      // Les deux Modes de jeu s'arrêtent sans que personne ne franchisse de ligne : la
      // fenêtre du duel court avant la sortie la PLUS TÔT des deux, pas avant une seconde
      // arrivée qui n'existe pas (ADR 0015, 0016).
      endAtFirst: this.state.gameMode !== "normal",
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

// `aliveIds` et `outpaced` vivent désormais dans `core/race-state.ts` (issue #132/#140).

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
  // L'explication vit dans `ui/info-bubble.ts` depuis #180 : la barre de config solo
  // en avait besoin à l'identique, et la recopier aurait fait diverger les deux.
  return `<div class="lobby-row">
    <div class="lobby-key">${name}${infoHtml(row.label, row.tip)}</div>
    <div class="lobby-ctl">${ctl}</div>
  </div>`;
}

/** Libellés de Difficulté (issue #71) — Expert n'apparaît dans aucun `select` de Room,
 *  mais reste couvert ici : `this.state.difficulty` a le type `Difficulty` au complet. */

/** Longueur à reprendre quand on (re)passe sur `words`. Médiane par défaut. */
export function currentCount(src: TextSource): number {
  return src.kind === "words" ? src.count : WORDS_LENGTHS[1];
}

/** Mention lue par les non-hôtes : ils subissent le réglage, ils doivent le voir. */
export function sourceLabel(src: TextSource): string {
  return src.kind === "quote" ? "Citation" : `Mots (${src.count})`;
}

/**
 * Traduit `RaceState` en `ActivityExtra` pour la Rich Presence. C'est ICI que vit la
 * connaissance du domaine (Mode de jeu, Source de texte, plafond Spam) : `discord.ts`
 * n'importe rien de `core/` et n'a pas à savoir ce qu'est un Spam.
 *
 * L'effectif est celui des PRÉSENTS, pas des partants figés au RaceStart : la question à
 * laquelle une présence répond est « est-ce que je peux encore entrer ? », et un
 * spectateur arrivé en pleine course occupe une place quand même.
 *
 * Pure — `now` est injecté plutôt que lu, sinon le rebours Spam ne serait pas testable.
 */
/**
 * L'état de présence du salon, d'après le Mode de jeu réglé (#115). Un salon montre ce
 * qu'on est sur le POINT de jouer — c'est ce que lit un ami dans la liste des membres —
 * et le mode se change jusqu'au dernier instant, donc la présence doit suivre.
 *
 * `discord.ts` n'apprend toujours pas ce qu'est un Mode de jeu : c'est ici, où `RaceState`
 * est déjà tenu, que la traduction se fait.
 */
export function lobbyActivityState(gameMode: RaceState["gameMode"]): ActivityState {
  switch (gameMode) {
    case "floorIsLava":
      return "lobbyFloorIsLava";
    case "spam":
      return "lobbySpam";
    default:
      return "lobbyNormal";
  }
}

export function activityExtra(s: RaceState, now: number = Date.now()): ActivityExtra {
  const party: [number, number] = [s.players.length, s.maxPlayers];
  if (s.phase !== "running") return { party, state: "En attente" };
  switch (s.gameMode) {
    // Le seul Mode de jeu à plafond de temps, donc le seul à afficher un rebours. Il MENT
    // quelques secondes si la course s'arrête au seuil AVANT le plafond : la transition
    // suivante (RaceOver → lobby) le corrige, et c'est décoratif.
    case "spam":
      return {
        party,
        state: s.spamWord ? `« ${s.spamWord} »` : "Mode Spam",
        endsAt: now + s.spamTimeCapS * 1000,
      };
    // Aucune fin prévisible : la lave tue à intervalle jusqu'au dernier vivant, et une
    // course normale finit quand quelqu'un arrive. Chrono qui monte pour les deux.
    case "floorIsLava":
      return { party, state: "Survie" };
    default:
      return { party, state: sourceLabel(s.textSource) };
  }
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
