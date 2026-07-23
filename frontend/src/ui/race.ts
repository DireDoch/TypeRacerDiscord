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
import {
  RaceSocket,
  WORDS_LENGTHS,
  type ClientEvent,
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
  /** Message affiché en phase "failed" (code inconnu, Room pleine). */
  private failure = "";

  private clock = new RunClock();
  private controller = new FreeInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;

  /** charsDone diffusé par joueur (barres, non autoritaire). */
  private progress = new Map<string, number>();
  /** WPM autoritaire par joueur ayant fini (signal LIVE, pour la piste). */
  private finished = new Map<string, number>();
  /** Joueurs ayant ABANDONNÉ — la piste affiche « abandon », jamais leur « 0 wpm ». */
  private forfeited = new Set<string>();
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
        if (this.phase === "running") this.renderBars();
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
    this.countdownN = RACE_COUNTDOWN_S;
    this.progress.clear();
    this.finished.clear();
    this.forfeited.clear();
    this.playOfTheGame = null;
    // Contrôleur neuf dès le décompte : le texte ENTIER s'affiche vierge (le joueur lit
    // le début pendant l'attente) — indispensable après une revanche (état stale).
    this.doneLocal = false;
    this.controller = new FreeInput(this.targetWords);
    this.countdown = new Countdown(
      RACE_COUNTDOWN_S,
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
    this.socket?.send({ type: "Progress", charsDone: this.charsDone() });

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
          this.sourceHtml() +
          this.cardsHtml() +
          this.startBtnHtml() +
          this.exitBtnHtml()
        );
      case "countdown":
        return `<div class="countdown">${this.countdownN}</div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>`;
      case "running":
        return `<div class="live-bar" id="liveBar"></div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>
          <div class="bars" id="bars">${this.barsHtml()}</div>
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
      return `<p class="hint">Texte : ${sourceLabel(src)}</p>`;
    }
    const on = (active: boolean) => (active ? ' class="on"' : "");
    const lengths =
      src.kind === "words"
        ? WORDS_LENGTHS.map(
            (n, i) =>
              `<button data-len="${n}"${on(src.count === n)}>${LENGTH_LABELS[i]} ${n}</button>`,
          ).join("")
        : "";
    return `<div class="race-settings">
      <span class="hint">Texte</span>
      <button data-src="quote"${on(src.kind === "quote")}>Citation</button>
      <button data-src="words"${on(src.kind === "words")}>Mots</button>
      ${lengths}
    </div>`;
  }

  /** Cartes de présence empilées (owner en tête, moi souligné). */
  private cardsHtml(): string {
    const cards = this.players
      .map((p) => {
        const isOwner = p.playerId === this.owner;
        const isMe = p.playerId === this.me;
        const tags = [isOwner ? "owner" : "", isMe ? "me" : ""].filter(Boolean).join(" ");
        const label = isMe ? `${p.displayName} (toi)` : p.displayName;
        return `<div class="card ${tags}">${avatarHtml(p)} ${escapeText(label)}${
          isOwner ? " 👑" : ""
        }</div>`;
      })
      .join("");
    return `<div class="cards">${cards}</div>`;
  }

  private startBtnHtml(): string {
    if (this.me === this.owner) {
      return `<button id="startRace" class="on">Démarrer la course</button>`;
    }
    return `<p class="hint">En attente que l'hôte lance la course…</p>`;
  }

  private exitBtnHtml(): string {
    return this.onExit ? `<button id="exitRace" class="on">← menu</button>` : "";
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
    if (bars) bars.innerHTML = this.barsHtml();
    const live = this.root.querySelector<HTMLElement>("#liveBar");
    if (live) {
      const wpm = this.doneLocal ? 0 : liveWpm(this.targetWords, this.controller.view(), this.clock.elapsed());
      live.innerHTML = `<span class="live-wpm">${wpm} wpm</span>`;
    }
  }

  /**
   * La piste : une ligne par joueur, la voiture en tête de sa progression, le WPM à la
   * ligne d'arrivée. Même donnée que les anciennes barres (`charsDone`), autre costume.
   */
  private barsHtml(): string {
    const total = Math.max(1, this.targetText.length);
    const elapsed = this.clock.elapsed();
    return this.players
      .map((p) => {
        const isMe = p.playerId === this.me;
        const done = isMe ? this.charsDone() : this.progress.get(p.playerId) ?? 0;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const final = this.finished.get(p.playerId);
        const label = trackLabel(this.forfeited.has(p.playerId), final, liveWpmOf(done, elapsed));
        return `<div class="bar ${isMe ? "me" : ""} ${final !== undefined ? "done" : ""}">
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
      };
    this.potgStop = runPlayOfTheGame(this.root, {
      racedWords: this.racedWords,
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
 * Étiquette de la ligne d'arrivée sur la piste. Un abandon affiche « abandon » et JAMAIS
 * « 0 wpm » — le flag est explicite, on ne le déduit pas d'un WPM nul. Sinon : le WPM
 * autoritaire (✓) une fois fini, le WPM live dérivé tant qu'on court. Pure.
 */
export function trackLabel(forfeited: boolean, finalWpm: number | undefined, liveWpm: number): string {
  if (forfeited) return "abandon";
  if (finalWpm !== undefined) return `${finalWpm} wpm ✓`;
  return `${liveWpm} wpm`;
}

/** Libellés des trois longueurs, dans l'ordre de `WORDS_LENGTHS`. */
const LENGTH_LABELS = ["Court", "Normal", "Long"] as const;

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
