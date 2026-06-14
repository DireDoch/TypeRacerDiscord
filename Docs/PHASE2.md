# Esquisse de la frontière Phase 2 (livrable #4)

Phase 2 = **multijoueur** : Race (saisie bloquante) dans une Room (salon vocal Discord),
synchronisée par WebSocket. **Rien n'est implémenté en MVP** — ce document fige *où* sont les
frontières pour que la bascule soit localisée et que le MVP ne se peigne pas dans un coin.

## Principe : le serveur devient propriétaire de la vérité terrain

En solo, le client génère le texte et marque t=0 — acceptable car on ne triche que contre soi.
En Race, le serveur **possède** ces deux choses, ce qui rend le recompute non-forgeable :

| Vérité terrain | MVP solo (qui décide) | Phase 2 Race (qui décide) | Point de bascule |
|---|---|---|---|
| Texte cible / seed | Client (`text-gen/`) | **Serveur** (`domain/text_gen.rs`, même algo porté) | la fonction de génération |
| t=0 | Client (fin du décompte local) | **Serveur** (`RaceStart` diffusé) | `RunClock.start()` (`core/clock.ts`) |
| Contrôleur de saisie | `FreeInput` | `BlockingInput` | `InputController` (`core/input/`) |
| Recompute scoreboard | Rust depuis log+texte | Rust depuis log+texte (inchangé) | `domain/replay.rs` (déjà autoritaire) |

Le **format du keystroke log et la forme du Scoreboard ne changent pas** entre MVP et Phase 2.
C'est tout l'intérêt d'avoir rendu Rust autoritaire dès le solo.

## Points de bascule, fichier par fichier

- `core/clock.ts` — `RunClock.start()` appelé sur événement local (solo) vs `RaceStart` (Race).
- `core/input/blocking-input.ts` — stub à implémenter ; même `InputController` que `FreeInput`.
- `core/text-gen/index.ts` — `generateText(..., seed)` déjà pur+seedé ; le serveur tire le seed.
- `backend/src/domain/text_gen.rs` — port Rust de la génération (parité avec le TS via le seed).
- `backend/src/ws/` — `Rooms = Arc<Mutex<HashMap<ChannelId, Room>>>` + `protocol.rs` (events).

## Protocole (voir `backend/src/ws/protocol.rs`)

Client→Serveur : `JoinRoom`, `Ready`, `Progress`, `Finish`, `LeaveRoom`.
Serveur→Client : `RoomState`, `RaceStart`, `PlayerProgress`, `PlayerFinished`, `RaceOver`.

Le `Finish` réutilise exactement le payload de `POST /api/runs` (log brut) → le recompute
autoritaire et l'anti-triche timing sont le MÊME code que le solo.

## Ce qui reste hors-scope tant que Phase 2 n'est pas lancée

Matchmaking inter-salons, reconnexion en cours de Race, spectateurs, persistance des Rooms.
Aucun de ces sujets ne doit influencer le schéma `runs` ni les 4 endpoints du MVP.
