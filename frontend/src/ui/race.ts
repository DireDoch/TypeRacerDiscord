// =============================================================================
//  ui/race.ts — écran de Race multijoueur (Phase 2).
//
//  Machine d'état pilotée par le SERVEUR : connecting → lobby → countdown(3s) →
//  running → over. Le serveur possède seed/texte (RoomState) et t=0 (RaceStart).
//   - RaceStart = signal « go » : décompte local de 3 s (texte visible pour lire le
//     1er mot) puis RunClock.start() — SEUL point de bascule du temps côté client.
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
import { RaceSocket, type ServerEvent } from "../core/net";
import { liveWpm } from "../live-stats";
import { wordsHtml, placeCaret, escapeText } from "./typing-zone";
import { getIdentity, proxyBase } from "../discord";

type Phase = "connecting" | "lobby" | "countdown" | "running" | "over";

export class Race {
  private me = "";
  private channelId = "";
  private socket: RaceSocket | null = null;

  private phase: Phase = "connecting";
  private players: string[] = [];
  private owner = "";
  private targetText = "";
  private targetWords: string[] = [];

  private clock = new RunClock();
  private controller = new FreeInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;

  /** charsDone diffusé par joueur (barres, non autoritaire). */
  private progress = new Map<string, number>();
  /** WPM autoritaire par joueur ayant fini. */
  private finished = new Map<string, number>();
  private ranking: string[] = [];
  private countdownN = 3;
  private countdown: Countdown | null = null;
  private rafId = 0;

  /** `onExit` : navigation retour vers le menu (lobby et écran RaceOver). */
  constructor(
    private readonly root: HTMLElement,
    private readonly onExit?: () => void,
  ) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  /** Démontage propre : coupe écouteur, rAF et socket (→ LeaveRoom côté serveur). */
  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    cancelAnimationFrame(this.rafId);
    this.countdown?.cancel();
    this.countdown = null;
    this.socket?.close();
    this.socket = null;
  }

  async mount(): Promise<void> {
    const id = await getIdentity();
    this.me = id.playerId;
    this.channelId = id.channelId;
    this.socket = new RaceSocket(id.token, (e) => this.onEvent(e), proxyBase());
    await this.socket.ready();
    this.socket.send({ type: "JoinRoom", channelId: this.channelId });
    this.render();
  }

  // --- Événements serveur -----------------------------------------------------

  private onEvent(e: ServerEvent): void {
    switch (e.type) {
      case "RoomState":
        this.players = e.players;
        this.owner = e.owner;
        this.targetText = e.targetText;
        this.targetWords = e.targetText.split(" ").filter((w) => w.length > 0);
        if (this.phase === "connecting") this.phase = "lobby";
        this.render();
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
        if (this.phase === "running") this.renderBars();
        break;
      case "RaceOver":
        this.ranking = e.ranking;
        this.phase = "over";
        cancelAnimationFrame(this.rafId);
        this.render();
        break;
    }
  }

  // --- Cycle de course --------------------------------------------------------

  private startCountdown(): void {
    // Un seul décompte vivant : un second RaceStart pendant le décompte/la course est ignoré.
    if (this.phase === "countdown" || this.phase === "running") return;
    this.phase = "countdown";
    this.countdownN = 3;
    this.progress.clear();
    this.finished.clear();
    // Contrôleur neuf dès le décompte : le texte ENTIER s'affiche vierge (le joueur
    // lit le début pendant les 3 s) — indispensable après une revanche (état stale).
    this.doneLocal = false;
    this.controller = new FreeInput(this.targetWords);
    this.countdown = new Countdown(
      3,
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
    let n = v.lockedWords.reduce((a, w) => a + w.length, 0) + v.lockedWords.length;
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

  // --- Rendu ------------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = `<section class="race">${this.bodyHtml()}</section>`;
    const btn = this.root.querySelector<HTMLButtonElement>("#startRace");
    if (btn) btn.addEventListener("click", () => this.socket?.send({ type: "StartRace" }));
    this.root
      .querySelector<HTMLButtonElement>("#exitRace")
      ?.addEventListener("click", () => this.onExit?.());
    // Décompte et début de course passent par render() : le bloc doit être placé
    // là aussi, sinon le 1er caractère (inversé sous lui) reste invisible.
    const wordsEl = this.root.querySelector<HTMLElement>("#words");
    if (wordsEl) placeCaret(wordsEl);
  }

  private bodyHtml(): string {
    switch (this.phase) {
      case "connecting":
        return `<p class="hint">Connexion au salon…</p>`;
      case "lobby":
        return this.cardsHtml() + this.startBtnHtml() + this.exitBtnHtml();
      case "countdown":
        return `<div class="countdown">${this.countdownN}</div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>`;
      case "running":
        return `<div class="live-bar" id="liveBar"></div>
          <div class="words-wrap"><div class="words" id="words">${this.wordsAreaHtml()}</div><div class="caret-block"></div></div>
          <div class="bars" id="bars">${this.barsHtml()}</div>
          <p class="hint">${this.doneLocal ? "Terminé — en attente des autres…" : "Tape le texte ; corrige tes fautes pour finir"}</p>`;
      case "over":
        // Revanche : le serveur a déjà re-diffusé un RoomState avec un NOUVEAU texte ;
        // le même bouton StartRace relance (owner seulement).
        return this.rankingHtml() + this.startBtnHtml() + this.exitBtnHtml();
    }
  }

  /** Cartes de présence empilées (owner en tête, moi souligné). */
  private cardsHtml(): string {
    const cards = this.players
      .map((p) => {
        const tags = [p === this.owner ? "owner" : "", p === this.me ? "me" : ""].filter(Boolean).join(" ");
        const label = p === this.me ? `${p} (toi)` : p;
        const badge = p === this.owner ? ` 👑` : "";
        return `<div class="card ${tags}">${escapeText(label)}${badge}</div>`;
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

  /** Une barre de progression par joueur (fraction du texte parcourue). */
  private barsHtml(): string {
    const total = Math.max(1, this.targetText.length);
    return this.players
      .map((p) => {
        const done = p === this.me ? this.charsDone() : this.progress.get(p) ?? 0;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const wpm = this.finished.get(p);
        const tag = wpm !== undefined ? ` — ${wpm} wpm ✓` : "";
        const label = (p === this.me ? `${p} (toi)` : p) + tag;
        return `<div class="bar"><span class="bar-label">${escapeText(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
      })
      .join("");
  }

  private rankingHtml(): string {
    const rows = this.ranking
      .map((p, i) => {
        const wpm = this.finished.get(p);
        const label = p === this.me ? `${p} (toi)` : p;
        return `<li class="${p === this.me ? "me" : ""}">${i + 1}. ${escapeText(label)}${
          wpm !== undefined ? ` — ${wpm} wpm` : ""
        }</li>`;
      })
      .join("");
    return `<ol class="ranking">${rows}</ol>`;
  }
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
