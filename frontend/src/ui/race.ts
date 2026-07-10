// =============================================================================
//  ui/race.ts — écran de Race multijoueur (Phase 2, TypeRacer).
//
//  Machine d'état pilotée par le SERVEUR : connecting → lobby → countdown(3s) →
//  running → over. Le serveur possède seed/texte (RoomState) et t=0 (RaceStart).
//   - RaceStart = signal « go » : décompte local de 3 s (texte visible pour lire le
//     1er mot) puis RunClock.start() — SEUL point de bascule du temps côté client.
//   - Saisie : BlockingInput (mot exact pour avancer). Progress diffusé pour les
//     barres ; Finish réutilise le log brut → recompute autoritaire → RaceOver.
//  Owner (1er arrivé) : seul à voir le bouton « Démarrer ».
// =============================================================================

import type { Keystroke } from "../core/types";
import { RunClock } from "../core/clock";
import { BlockingInput } from "../core/input/blocking-input";
import { RaceSocket, type ServerEvent } from "../core/net";
import { liveWpm } from "../live-stats";
import { getIdentity } from "../discord";

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
  private controller = new BlockingInput([]);
  private log: Keystroke[] = [];
  private doneLocal = false;

  /** charsDone diffusé par joueur (barres, non autoritaire). */
  private progress = new Map<string, number>();
  /** WPM autoritaire par joueur ayant fini. */
  private finished = new Map<string, number>();
  private ranking: string[] = [];
  private countdownN = 3;
  private rafId = 0;

  constructor(private readonly root: HTMLElement) {
    this.onKeyDown = this.onKeyDown.bind(this);
    document.addEventListener("keydown", this.onKeyDown);
  }

  async mount(): Promise<void> {
    const id = await getIdentity();
    this.me = id.playerId;
    this.channelId = id.channelId;
    this.socket = new RaceSocket(id.token, (e) => this.onEvent(e));
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
    this.phase = "countdown";
    this.countdownN = 3;
    this.progress.clear();
    this.finished.clear();
    this.render();
    const tick = (): void => {
      this.countdownN -= 1;
      if (this.countdownN <= 0) {
        this.beginRun();
        return;
      }
      this.render();
      window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
  }

  private beginRun(): void {
    this.phase = "running";
    this.doneLocal = false;
    this.log = [];
    this.controller = new BlockingInput(this.targetWords);
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

    if (this.controller.isComplete()) {
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
  }

  private bodyHtml(): string {
    switch (this.phase) {
      case "connecting":
        return `<p class="hint">Connexion au salon…</p>`;
      case "lobby":
        return this.cardsHtml() + this.startBtnHtml();
      case "countdown":
        return this.cardsHtml() + `<div class="countdown">${this.countdownN}</div>`;
      case "running":
        return `<div class="live-bar" id="liveBar"></div>
          <div class="words" id="words">${this.wordsHtml()}</div>
          <div class="bars" id="bars">${this.barsHtml()}</div>
          <p class="hint">${this.doneLocal ? "Terminé — en attente des autres…" : "Tape le texte exactement"}</p>`;
      case "over":
        return this.rankingHtml() + `<p class="hint">Course terminée.</p>`;
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

  private renderWords(): void {
    const el = this.root.querySelector<HTMLElement>("#words");
    if (el) el.innerHTML = this.wordsHtml();
  }

  private wordsHtml(): string {
    const v = this.controller.view();
    return this.targetWords
      .map((target, i) => {
        if (i < v.lockedWords.length) return raceWordHtml(target, v.lockedWords[i], false);
        if (i === v.wordIndex) return raceWordHtml(target, v.typed, !this.doneLocal);
        return raceWordHtml(target, "", false);
      })
      .join("");
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
 * Rendu d'un mot en mode Race (cascade TypeRacer) : dès la 1re divergence, TOUT ce
 * qui suit passe en rouge (`incorrect`/`extra`), même les caractères tapés juste
 * après. Fonction pure — testée isolément.
 */
export function raceWordHtml(target: string, typed: string, withCaret: boolean): string {
  const spans: string[] = [];
  const len = Math.max(target.length, typed.length);
  let broken = false;
  for (let i = 0; i < len; i++) {
    const caret = withCaret && i === typed.length ? `<span class="caret"></span>` : "";
    if (i < typed.length) {
      if (!broken && (i >= target.length || typed[i] !== target[i])) broken = true;
      const cls = !broken ? "correct" : i >= target.length ? "extra" : "incorrect";
      spans.push(`${caret}<span class="${cls}">${escapeChar(typed[i])}</span>`);
    } else {
      spans.push(`${caret}<span class="untyped">${escapeChar(target[i])}</span>`);
    }
  }
  if (withCaret && typed.length >= len) spans.push(`<span class="caret"></span>`);
  return `<span class="word">${spans.join("")}</span> `;
}

function escapeChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  return ch;
}

function escapeText(s: string): string {
  let out = "";
  for (const ch of s) out += escapeChar(ch);
  return out;
}
