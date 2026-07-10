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

## Deux modèles de saisie (Monkeytype vs TypeRacer)

Le `InputController` a deux implémentations, une par style de jeu :

- **Solo = Monkeytype = `FreeInput`** (MVP, déjà expédié). Curseur libre, les fautes sont
  TOLÉRÉES (rouge à l'écran mais on continue), l'espace avance même sur un mot faux. Noté après
  coup : WPM = chars corrects / 5 / min, accuracy à part. On peut laisser des erreurs.
- **Race = TypeRacer = `BlockingInput`** (Phase 2). Saisie libre DANS le mot courant (les fautes
  s'affichent en rouge), mais l'espace n'avance QUE si le mot est tapé EXACTEMENT — il faut donc
  corriger avant de continuer. Pas de retour aux mots verrouillés (curseur non libre). Le texte
  final est toujours parfait ⇒ la course est de la vitesse pure.

Le recompute autoritaire (`domain/replay.rs`) ne change pas : mêmes chiffres pour les deux, seule
la façon de produire le keystroke log diffère.

## Propriété de la partie (owner)

Discord ne fournit pas de notion d'« hôte ». Le serveur assigne donc **owner = premier joueur à
`JoinRoom`** un salon donné. **Seul l'owner peut lancer la course** (`StartRace`) — inutile que
tout le monde soit prêt. Si l'owner quitte, la propriété passe au suivant dans la pile de présence ;
un salon vide est détruit.

## Protocole (voir `backend/src/ws/protocol.rs`)

Client→Serveur : `JoinRoom`, `StartRace` (owner only), `Progress`, `Finish`, `LeaveRoom`.
Serveur→Client : `RoomState` (inclut `owner`), `RaceStart`, `PlayerProgress`, `PlayerFinished`,
`RaceOver`.

> `Ready` de l'esquisse initiale est remplacé par `StartRace` (démarrage à la main de l'owner).

Le `Finish` réutilise exactement le payload de `POST /api/runs` (log brut) → le recompute
autoritaire et l'anti-triche timing sont le MÊME code que le solo.

Diffusion : chaque Room porte un `tokio::sync::broadcast::Sender<ServerEvent>` ; join/leave/
RaceStart/progress sont poussés à tous les sockets du salon (l'étape 3 ne faisait qu'un écho au
seul joueur qui rejoint).

## Prochaines étapes (le MVP est feature-complet : 5 Modes + Zen à état visible)

Tranches verticales, la plus fine d'abord — chacune se teste avant la suivante.
Le format du keystroke log et du Scoreboard ne bouge pas : le recompute autoritaire
(`domain/replay.rs`) est déjà le même code qu'en solo.

1. ✅ **Port du générateur en Rust** (`backend/src/domain/text_gen.rs`) : port de `text-gen/`
   (mulberry32 + word-list + punctuation/numbers), parité TS↔Rust figée sur le seed 12345.
   Le serveur est propriétaire du texte.
2. ✅ **`BlockingInput`** (`core/input/blocking-input.ts`) : modèle TypeRacer (saisie libre dans le
   mot, espace exact pour avancer, pas de retour arrière). Testable en solo, même `InputController`.
3. ✅ **Route WebSocket** : `ws/` câblé au routeur Axum (`/ws`), `Rooms = Arc<Mutex<HashMap<…>>>`,
   auth via `?token=`. `JoinRoom → RoomState` (présence nue, seed+texte générés serveur).

Reste à faire (chaque tranche se teste avant la suivante) :

4. **Diffusion + owner + `RaceStart` pilote `RunClock.start()`.**
   - Backend : `broadcast::Sender` par Room ; `JoinRoom`/`LeaveRoom` re-diffusent `RoomState`
     (avec `owner`). `StartRace` (rejeté si l'émetteur n'est pas l'owner) → `RaceStart{ }` à tous.
   - Client (`core/clock.ts`) : SEUL point de bascule. En Race, `RunClock.start()` est appelé à la
     réception de `RaceStart`, plus par le décompte local. `RaceStart` = simple signal « go »
     (option A : `start()` = `performance.now()` à la réception ; on ignore l'horloge murale, pas
     de sync client↔serveur au MVP).
5. **Décompte de 3 s + course à 2, même texte.** `RaceStart` déclenche un décompte de 3 s côté
   client AVEC le texte déjà à l'écran (le joueur lit le 1er mot) ; à 0, t=0. Puis `Progress`/
   `PlayerProgress` (barres live via `live-stats.ts`) → `Finish` (payload identique à
   `POST /api/runs`) → `RaceOver`. Recompute et anti-triche timing = le code solo, inchangé.
6. **UI Room.** Rejoindre via `channelId` ; **cartes de présence en pile** (empilées à
   l'arrivée d'un joueur, retirées au départ) ; bouton « Démarrer » visible pour le seul owner ;
   barres de progression ; écran `RaceOver`.

Première tranche jouable de bout en bout : étapes 4→6 pour un duel même-texte. Le classement final
vient du recompute autoritaire.

**Hors-scope (plus tard, pas maintenant — YAGNI) :** visualiseur par joueur de la portion de texte
parcourue (jusqu'à la fin du texte) ; sync d'horloge fine pour un décompte parfaitement simultané ;
transfert d'owner déjà couvert mais reconnexion en cours de course non.

## Ce qui reste hors-scope tant que Phase 2 n'est pas lancée

Matchmaking inter-salons, reconnexion en cours de Race, spectateurs, persistance des Rooms.
Aucun de ces sujets ne doit influencer le schéma `runs` ni les 4 endpoints du MVP.
