# TypeRacerDiscord

A typing-test game embedded in Discord as an Activity (Embedded App SDK). Players type solo against the clock (MVP), with real-time multiplayer racing planned for a later phase.

## Language

**Run**:
A single typing attempt by one Player, from first keystroke to completion (time elapsed, word count reached, or manual stop). The generic unit everything else attaches to. Comes in two kinds: Practice and Race.
_Avoid_: Test, Game, Course, Round, Attempt.

**Practice**:
A solo Run with **free input** (Monkeytype-style): backspace allowed, errors may be left uncorrected, extra characters possible. The only kind of Run shipped in the MVP.
_Avoid_: Solo, Training, Free mode.

**Race**:
A competitive Run inside a Room with **blocking input** (TypeRacer-style): an error must be corrected before advancing. Planned for Phase 2. The blocking input controller is built and testable in solo during the MVP, then rebound exclusively to Race later.
_Avoid_: Match, Duel, Course.

**Abandon (forfeit)**:
Giving up the current Race **without leaving the Room** — the Player's car stops, they are ranked last and labelled « abandon » (never « 0 wpm »), and they stay in the lobby to play the next Race. Recorded as an arrival at 0 WPM carrying an explicit `forfeit` flag, so it unblocks the finish for everyone else instead of making them wait out the watchdog. No Run is ever persisted for an Abandon: nothing to exclude from PBs, nothing to pollute the history. A Player who simply **disconnects** produces the exact same record — one code path for both.
_Avoid_: Quit, Leave, Give up, DNF.

**Gap (écart)**:
How far a Player finished behind the winner of a Race, in seconds. It is the headline of the finish — the number that gets said out loud — while absolute WPM is secondary. Derived on the client from the durations carried by `RaceOver` (ADR 0010); the winner's own Gap is zero. Ranking by Gap and ranking by WPM are always the same order in a Race — everyone types the same text and only finishes at 100 % exact, so correct characters are identical across finishers.
_Avoid_: Delta, Difference, Lag.

**Mode**:
The rule that decides what text is presented and when a Run ends — one of `Time`, `Words`, `Quotes`, `Zen`. Exactly one Mode per Run. **Solo only**: a Race has no Mode (its end rule is always "the whole text, exactly"), it has a Source de texte instead — ADR 0009.

**Source de texte (Race)**:
Where a Race's text comes from — `Quote` (default, via the existing quote proxy) or `Mots` (generated, length `Court 15` / `Normal 30` / `Long 50`). Chosen by the party leader in the lobby, out of race only. It decides the text, never the measure: the Authoritative scoreboard recomputes every Race as `Words` over the server's text regardless. Length is a `Mots`-only control — a Quote's length belongs to the quote.
_Avoid_: Mode, Race mode, Game mode.

**Setting**:
An independent, cumulable text modifier applied on top of a Mode — currently `Punctuation` and `Numbers`. Zero or more per Run.
_Avoid_: Modifier, Option, Toggle.

**Preference**:
How a Player wants the game to look on **their own machine** — typing font, colour palette, and the Display identity override. A Preference belongs to the device, never leaves it, and is deliberately **not** a Setting: it never alters the generated text, never enters the Config bucket, and never affects a score. Two Players in the same Race may see different fonts and colours and still be racing the same text. Changing a Preference never invalidates a PB.
_Avoid_: Setting, Option, Config, Theme.

**Keystroke log**:
The recorded timeline of a Player's keystrokes during a Run (what was typed and when). The raw input from which all stats are derived; sent once to the backend for the Authoritative scoreboard and **persisted with the Run** (migration `0002`) as the raw material for the upcoming replay/analysis features.
_Avoid_: Input history, Replay.

**Replay**:
The playback of a finished Run, re-rendered from its Keystroke log against the persisted target text — the Player watches their own typing happen again in real time (errors included). Launched from the results screen or from any Run in the history. Simple playback: start to finish at real speed, no pause or seeking.
_Avoid_: Review, Playback, Ghost.

**Play of the Game**:
The post-Race highlight: the two Players whose finishes were **closest together** — wherever they landed in the ranking — replayed side by side in slow motion over their last seconds. Chosen by the server (ADR 0011), and **omitted entirely** when no pair finished within 2 s: a race with no photo finish has no Play of the Game. It reuses the Replay machinery but is not a Replay: two Keystroke logs instead of one, a window instead of the whole Run, and a **single shared clock** for both — that shared clock is what makes it a duel rather than two unrelated playbacks.
_Avoid_: Highlight, PotG, Replay, Duel.

**Live stats**:
Stats computed on the client during a Run for immediate UI feedback (the moving WPM counter, the graph filling in). Not authoritative.

**Authoritative scoreboard**:
The final stats (WPM, Raw, Accuracy, character breakdown, per-second series) recomputed by the Rust backend from the Keystroke log at the end of a Run. The numbers of record. In multiplayer this is also the anti-cheat check.
_Avoid_: Results, Score.

**Weak spot**:
A key, key-pair (bigram), or key-triple (trigram: the character before AND after a fault, not just before) where the Player is measurably slower or more error-prone than their own average, with enough occurrences to be significant. Identified by the analysis engine from one Keystroke log (a single Run) or many (a profile across recent Runs) — same definition either way. Each kind has its own noise threshold (trigrams are rarer by construction, see ADR 0005).
_Avoid_: Weakness, Problem key, Trouble key.

**Player**:
A Discord user playing the game, identified by their Discord user ID (snowflake). No separate account exists — identity comes entirely from the Discord OAuth handshake.
_Avoid_: User, Account, Profile.

**Display identity**:
The face a Player shows to the others during a session: a display name and an avatar. The name defaults to the Discord display name and **the Player may override it** with a nickname of their choosing; the override belongs to that Player's device, not to the game. The Display identity is **never stored by the game** — it is announced on joining, shown while the session lasts, and forgotten. A Player is always the snowflake (durable, owns the Runs); the Display identity is only how that Player is drawn on screen. It is never verified: two Players may show the same name. Anything persisted — history, PB, Lesson progress, leaderboards — names Players by snowflake, never by Display identity.
_Avoid_: Username, Nickname, Profile.

**Config bucket**:
The exact combination that makes two Runs comparable: Mode + its value + language + active Settings. `Time 30s English Punctuation` and `Time 30s English` are different buckets.
_Avoid_: Category, Group.

**Personal Best (PB)**:
A Player's best result (by WPM) within a single Config bucket. A Player has at most one PB per bucket. **Variable-duration Runs never produce a PB** — this excludes Zen and Time infini (their length isn't fixed, so WPM isn't comparable). They are still saved to history.
_Avoid_: Record, High score, Best.

**Time infini**:
The Time Mode with its value set to `0` — the clock is disabled, words stream endlessly, and the Run ends only when the Player presses `Shift+Enter`. There is still a target text (unlike Zen). Excluded from PBs.
_Avoid_: No-timer, Disabled time, Endless.

**Drill**:
A Practice Mode whose text targets the Player's current Weak spots, restricted to `key`/`bigram` kinds: a short warm-up of targeted key sequences, then real words (from the standard word list) chosen because they contain those Weak spots. Personalized text makes Drills incomparable, so they never produce a PB (same rule as Zen and Time infini).
_Avoid_: Practice mode, Training, Exercise mode.

**Trigram Drill**:
A separate Practice Mode from Drill (ADR 0005), not a variant of it — same mechanics (warm-up + real words) and analysis engine, but restricted to trigram-kind Weak spots only (the character before AND after a fault). Has its own noise threshold and its own empty state ("profile exists but no trigram is significant yet"), distinct from Drill's ("no profile"). Never produces a PB, same rule as Drill.
_Avoid_: Practice, Context mode, Drill.

**Quote**:
The fixed text fetched for a Quotes Run (text + author), via the Rust quote proxy. Settings and length controls do not apply — the Player types the whole Quote. The author name builds a "learn more" link to that author's Wikipedia page. Quote length varies Run to Run but the Config bucket doesn't capture it, so Quotes never produce a PB (same rule as Drill: uncaptured text variation makes Runs incomparable).
_Avoid_: Citation, Passage.

**Lesson**:
One step of the Learn curriculum (UI: « Apprendre »), one of 100 (ADR 0006): instructional content on touch-typing — illustrated with a static hand/keyboard diagram on the earliest Lessons only — plus a typed exercise on a fixed key set. Passing the exercise at the accuracy required by the current curriculum stage (a static, editable table of thresholds — early Lessons are lenient, later ones stricter) unlocks the next Lesson. Accuracy is the only gating criterion, at every stage — speed is never required to unlock a Lesson. Progress is persisted per Player. Lesson exercises are not Runs: no PB, no history entry.
_Avoid_: Level, Tutorial, Course.

**Room**:
A multiplayer session holding the set of Players racing the same text together. Identified by a **key** that is either a Discord voice channel (`channelId`) or a Code de partie — one map, two forms (ADR 0008). A Room keyed by `channelId` is created on the fly (the key comes from the SDK, it cannot be mistyped); a Room keyed by a code is only ever created explicitly. An empty Room is discarded and its code dies with it.
_Avoid_: Lobby, Session, Channel, Game.

**Code de partie (Race code)**:
The 5-character key of a Room created explicitly rather than derived from a voice channel — short enough to be read out loud, drawn from an alphabet with no visual ambiguity (no `0/O`, no `1/I/L`). It is what lets Players from **different** Discord servers race together, since the backend checks no guild membership. Never persisted, never reserved: it exists as long as the Room does.
_Avoid_: Lobby ID, Room ID, Invite code, Game code.

### Stats

A "word" is always **5 characters**, never a real word. All speeds divide characters by 5.

**WPM**:
Net speed — correct characters only, divided by 5, per minute. The Player's "pure" speed.
_Avoid_: Speed, Net WPM.

**Raw**:
Gross speed — all typed characters (correct or not) divided by 5, per minute.
_Avoid_: Raw WPM, Gross.

**Accuracy (ACC)**:
Correct keypresses ÷ total keypresses. Counts every press, including mistakes later fixed with backspace.
_Avoid_: Precision, Correctness.

**Burst**:
Peak per-word speed within a given second — the WPM of the fastest single word completed during that second, timed from the word's first keystroke (inter-word hesitation excluded). Local to the second, not cumulative; carries the last value forward when no word completes.
_Avoid_: Peak WPM, Spike.

**Character breakdown**:
The final tally `Correct / Incorrect / Extra / Missed`. Correct/Incorrect are counted per-keystroke (a fixed mistake still counts); Extra (typed past a word's length) and Missed (skipped target characters) are evaluated at the end.

## Décisions d'implémentation (session grilling)

Décisions prises au-delà du brief initial, qui font désormais autorité pour le code.
Détails de contrat dans `Docs/API.md`, frontière multijoueur dans `Docs/PHASE2.md`.

**Keystroke log (format).**
Option « événements bruts » : liste ordonnée de `{ t, k, ctrl? }`. `t` = ms depuis t=0.
`k` = caractère imprimable (espace inclus) ; `ctrl` = `"backspace"` ou `"backspace-word"`
(k vaut alors `""`). Touches capturées : imprimables + Backspace + Ctrl+Backspace
uniquement (pas de navigation au curseur). Voir `frontend/src/core/types.ts`.

**Origine du temps (t=0).**
Horloge **monotone** (`performance.now()`, jamais `Date.now()`), seul `RunClock.start()`
(`core/clock.ts`) bascule — mais l'événement qui déclenche t=0 dépend du contexte, et donc
ce que mesure le temps de réaction aussi :
- **Solo** (Practice, Apprendre) : t=0 = la **1re frappe** du Player. Pas de décompte, pas
  de délai imposé ; le temps de réaction n'est **pas** mesuré (il n'y a personne d'autre à
  attendre). Décision explicite — voir `Docs/adr/0004-solo-sans-decompte.md`.
- **Multijoueur** (Race) : t=0 = la **fin du décompte** (« GO »), déclenché par `RaceStart`,
  l'événement serveur qui synchronise tous les Players. Le décompte local dure **7 s**
  (texte visible en entier pendant l'attente, jamais masqué — 7 s = le temps de voir la
  grille de départ et de lire le premier mot) ; le temps de réaction (GO → 1re frappe)
  **est** compté — il reflète la réactivité du Player face à un signal partagé, pas un
  artefact de mesure. La **durée** du décompte est un réglage produit ajustable sans ADR
  ni invalidation (ADR 0007) : elle ne change pas ce qui est mesuré, et la Race n'est
  jamais PB-eligible. Ne pas confondre avec ADR 0004 (solo), qui déplaçait t=0 lui-même.

Solo et Race ne mesurent donc pas la même chose et ne sont **jamais comparés entre eux**
pour un PB (Race est déjà exclu des PB — fin stricte, texte 100 % exact).

**Texte d'une Race : généré d'abord, citation ensuite.**
Une Room naît TOUJOURS avec un texte de mots, même quand sa Source est `Quote` (le
défaut) : aller chercher une citation demande un aller-retour réseau, et le `Mutex` std
des Rooms n'est jamais tenu à travers un `await`. `spawn_refresh_text` fait donc les
choses en trois temps — lire la Source sous verrou, relâcher, chercher le texte, reposer
le résultat sous verrou — et re-diffuse `RoomState`. Le lobby voit l'ancien texte puis le
nouveau ; une course lancée entre-temps annule la pose (le texte en vol est périmé). Même
raison à la fin d'une course : `end_race` regénère des MOTS immédiatement pour que la Room
reste jouable sans réseau, et l'appelant (hors verrou) déclenche la citation par-dessus.
Le repli après échec du proxy n'est pas un état à part : la Room bascule pour de vrai sur
`Words(30)`, et c'est ce que `RoomState` annonce.

**Party leader (Race).**
C'est l'`owner` existant, sans changement : 1er arrivé dans la Room, transféré au suivant
s'il part. Le brief « le créateur est le party leader » est déjà vrai par construction —
le créateur d'une Room à code EST forcément son 1er arrivé. Il gagne seulement le droit de
régler la Source de texte (ADR 0009), toujours hors course. **Limite de 8 joueurs** :
gardée dans `join_room`, qui répond `RoomFull` — le plafond porte sur `players`, donc un
spectateur arrivé en cours de course occupe une place comme un autre.

**Display identity en Race (piste, podium).**
La Display identity est **annoncée par le client** dans l'événement de jointure et
re-diffusée par `RoomState` — le serveur ne la résout pas via `/users/@me`, sinon
l'override de pseudo (qui appartient au device) serait écrasé. Elle n'est jamais vérifiée
ni persistée, et elle est **oubliée au départ** du joueur, comme le veut le glossaire. On
transporte `{ playerId, displayName, avatarHash }` : **jamais une URL d'avatar**, chaque
client reconstruit `cdn.discordapp.com/avatars/{id}/{hash}.png` lui-même (`discord.ts:
avatarUrl`). Un `avatarUrl` fourni par un client serait une URL arbitraire chargée dans le
navigateur des 7 autres ; avec un hash, la forme est fixe. Le serveur `sanitize` quand
même à l'entrée — non contre l'injection (le rendu échappe déjà), mais parce qu'un nom
démesuré ou un hash hors `[0-9a-f_]` dégraderait l'écran **des autres**.
Côté `Room`, les identités vivent dans une map à CÔTÉ de `players` (qui reste une liste
d'ID) : la logique de course n'a pas à connaître l'affichage, et la map ne bouge qu'aux
deux endroits où la présence bouge. La pastille d'avatar rend l'**initiale derrière
l'image** — un avatar absent ou bloqué se dégrade tout seul, sans `onerror`.

**WPM live des autres joueurs (piste).**
Dérivé, pas transporté : `charsDone` (déjà diffusé par `Progress`) compte les caractères
**corrects**, donc chaque client calcule `(charsDone / 5) / minutes` pour tout le monde.
Aucun champ ajouté au protocole. Plafond assumé : les t=0 diffèrent d'une fraction de
seconde d'un client à l'autre (le décompte est local), soit ~2 % d'écart sur une course de
30 s — acceptable pour un compteur d'ambiance, jamais pour un score (le WPM de record
reste celui du recompute autoritaire au Finish).

**Borne de fin / durée.**
Time fini = `modeValue` (durée fixe). Words/Quotes = instant de complétion du dernier
caractère cible (terminer plus vite ⇒ meilleur WPM). Zen / Time infini = dernier `t` du
Keystroke log — jamais une valeur fournie par le client (`endedAtMs` est indicatif
seulement, voir `POST /api/runs`) : le serveur ne lui fait pas confiance pour la durée.

**Modèle de curseur (saisie libre).**
Curseur **libre** : le backspace peut revenir dans les mots précédents, **qu'ils contiennent
une erreur ou non**. L'espace verrouille le mot et avance ; le backspace en début de buffer
**rouvre le dernier mot verrouillé** (son contenu redevient éditable) ; Ctrl+Backspace en début
de buffer **supprime le mot précédent entier**. Le retour se fait mot par mot, de la droite
vers la gauche (modèle de pile). Extra (frappes au-delà de la longueur) plafonnées au buffer
(~longueur du mot) ; au-delà, la frappe est journalisée et compte comme incorrecte mais n'entre
pas dans le buffer. **Extra/Missed sont évalués à l'ÉTAT FINAL** sur tous les mots atteints :
un mot rouvert puis corrigé voit son décompte recalculé (sa pénalité disparaît du WPM net), mais
la **frappe fautive reste comptée dans l'ACC** (par frappe, historique).

**Règles de comptage.**
WPM (net) = caractères corrects à l'**état final** ÷ 5 ÷ minutes (espaces séparateurs
comptés comme corrects). Raw (gross) = toutes les frappes imprimables ÷ 5 ÷ minutes.
ACC = frappes correctes ÷ total frappes, **par frappe** ; le **Backspace est neutre**
(ni numérateur ni dénominateur) ; une frappe **Extra compte comme incorrecte**.
Breakdown : Correct/Incorrect par frappe ; Extra/Missed à l'état final.

**Série par seconde.**
Un point par seconde entière + un point final à la durée exacte. WPM/Raw = cumulatifs
depuis t=0, exactitude évaluée à l'instant N. Le curseur **libre** autorise le retour en
arrière : la courbe WPM peut donc localement **re-baisser** quand on corrige un mot antérieur
(le dernier point ≈ WPM headline). Errors = locales à la fenêtre `[N-1, N)`. Burst = max des
WPM des mots **complétés** dans la seconde (chrono depuis la 1re frappe du mot,
hésitation inter-mot exclue) ; report de la valeur précédente si aucun mot complété.

**Génération de texte.**
Fonction pure et **seedée** (déterministe, portable Rust en Phase 2). En MVP le client
envoie `seed` + `targetText` complet (et `quoteId` pour Quotes) ; le backend recompute
sur le texte reçu. En Phase 2 le serveur possède le seed/texte (vérité non forgeable).
Règles par défaut (paramétrables) : Punctuation = phrases de 4–10 jetons, majuscule en
tête, fin `.`/`?`/`!` (70/15/15 %), virgule 12 %, guillemets 5 %, parenthèses 4 % ;
Numbers = ~17 % de jetons-nombres autonomes de 1–4 chiffres.

**Identité.**
`player_id` jamais envoyé dans le corps : résolu côté serveur depuis le header
`Authorization: Bearer <discord_access_token>` (scope `identify`). Toujours en string.
Le serveur résout via `GET /users/@me` (cache court en mémoire) et expose l'échange du
code OAuth en **`POST /token`** (nommé « GET » par convention Discord, mais porte un corps
JSON). **Mode dev** : si `DISCORD_CLIENT_ID/SECRET` sont absents de l'env, le Bearer token
sert directement de `player_id` (test local au curl) et `/token` renvoie `503`. L'identité
est un extracteur Axum (`FromRequestParts`) qui s'exécute **avant** le parsing du corps →
`401` si le token est absent, même sur un corps invalide.

**Architecture.**
`core/` (domaine pur) miroir manuel entre TS et Rust (en-tête « miroir de … » dans
chaque fichier), pas de générateur de types. Pas de workspace npm racine. `live-stats`
ne duplique pas le replay complet (la vérité vient du recompute Rust en fin de Run).
`stats/scoreboard.ts` est la **référence** de l'algorithme que le port Rust reproduit.

**Réseau en Activity Discord (`/.proxy`).**
Dans l'iframe d'une Activity, la CSP de `discordsays.com` **bloque toute requête qui ne
passe pas par le préfixe `/.proxy/…`** (le document et les scripts se chargent, mais
fetch/WebSocket sont refusés — symptôme : UI intacte, aucune fonctionnalité réseau).
`discord.ts::proxyBase()` renvoie `"/.proxy"` quand `frame_id` est présent, `""` sinon ;
les 4 points d'accès (`/token`, `/api/runs`, `/api/quote`, `/ws`) le préfixent. Le proxy
Discord retire le préfixe AVANT d'appliquer les URL Mappings → backend et dev inchangés.

**Navigation par écrans (pas d'URL).**
L'URL de l'iframe est figée par le URL Mapping → toute navigation se fait PAR BOUTONS.
`main.ts` orchestre Menu (hub : Solo / Multijoueur / Options / Quitter) ↔ Practice ↔
Race, chaque écran expose `destroy()` (écouteur clavier global, rAF, socket) pour éviter
les écouteurs fantômes. La vue **Multijoueur du Menu** porte les trois portes d'entrée
d'une Room (salon / créer / rejoindre par code) ET le champ de saisie du code — c'est
délibéré : un code refusé ramène le joueur là où il peut le corriger, plutôt que dans un
écran de Race qui devrait re-héberger le même champ. `?race` reste le raccourci dev (deux
onglets au navigateur) et vise toujours la Room du salon, le seul chemin sans saisie.
« Quitter » ferme l'Activity via `sdk.close` (masqué hors Discord).

**Affichage du texte.**
Solo : fenêtre glissante de 3 lignes (Monkeytype) — clip CSS sur `.words` + défilement
programmatique par lignes entières (`slideWindow` → `scrollTop`), le mot actif reste sur
la ligne du MILIEU (`windowScrollTop`, pure : ligne n → n-1 lignes masquées). On mesure
l'`offsetTop` réel après rendu → robuste au wrap, au backspace multi-mots et au flux du
Time infini. Race : AUCUNE fenêtre — texte entier visible dès le décompte.

**Debug in-iframe.**
La console est invisible dans Discord : `main.ts` affiche un bandeau d'erreurs fixe
(`window.error` + `unhandledrejection`, clic pour fermer). Pour une vraie console :
ouvrir Discord AU NAVIGATEUR (discord.com/app) et lancer l'activité → F12.

## État d'implémentation (avancement)

Ce qui est câblé et testé, par couche. Contrat détaillé : `Docs/API.md`.

**Frontend (`frontend/`).**
- `core/` domaine pur, testé (clock, types, input `free`/`blocking`-stub, text-gen seedé,
  `stats/scoreboard`) — la **référence** de l'algo.
- UI Practice (`src/ui/`, `main.ts`, Vite) : machine d'état idle→running→finished (pas de
  décompte en solo, t=0 = 1re frappe — ADR 0004), graphe chart.js. Lancement `npm run dev`.
- `src/api.ts` branché sur le backend autoritaire : `submitRun` → `POST /api/runs` avec header
  `Authorization: Bearer <token>` ; `fetchQuote` → `GET /api/quote`. Le recompute local reste
  la **référence** (tests de parité), plus le chemin de prod.
- Mode **Quotes** câblé dans l'UI Practice : bouton `quotes` (longueur + Settings masqués),
  `reset()` async qui `fetchQuote()` (état chargement/erreur), `quoteId` envoyé à `POST /api/runs`,
  auteur + lien Wikipedia affichés sur l'écran de résultats.
- `src/discord.ts` : identité via Embedded App SDK (`ready`→`authorize`→`POST /token`→
  `authenticate`), import dynamique du SDK. **Mode dev** hors Discord (pas de `frame_id` ou
  `VITE_DISCORD_CLIENT_ID` absent) : token de test (`dev-player-1`) accepté tel quel par le
  backend dev comme `player_id`. Handshake amorcé tôt dans `main.ts` (non bloquant, mémoïsé).

- Écran **Race** (`ui/race.ts`) : lobby (cartes de présence avec avatar + nom, owner 👑,
  Code de partie, réglage de la Source de texte pour l'hôte), décompte de
  `RACE_COUNTDOWN_S` = **7 s** (ADR 0007) avec texte entier, **piste** (une ligne par
  joueur : avatar en tête de progression, nom, WPM live à la ligne d'arrivée — les
  anciennes barres recostumées en CSS, aucun canvas), classement, revanche. Écran **Menu** (`ui/menu.ts`) : hub
  d'arrivée + vue Options (liens légaux). Navigation par boutons avec `destroy()`.
- Écran **Apprendre** (`ui/learn.ts`, entrée au menu) : cursus complet (issues #4, #8) —
  liste des Lessons (verrouillée/disponible/complétée), 13 leçons réelles dans
  `core/learn.ts` (posture + F/J, rangées de base/haut/bas, majuscules, ponctuation,
  chiffres, mots complets, fluidité) avec le **barème statique par tranches** (70/80/90 %
  d'accuracy sur 0/5/10, modifiable en un seul endroit) et le générateur de séquences
  seedé — sur touches fixes, ou vrais mots de la word-list pour les leçons `words`
  (testé). L'exercice n'est PAS un Run (chrono à la 1re frappe, accuracy locale via la
  référence `scoreboard.ts`, jamais de POST /api/runs). Progression par Player :
  `GET/POST /api/learn/progress` (table `learn_progress`, migration `0004`, le serveur
  garde le MAX).

**Backend (`backend/`, Rust : Axum + sqlx/SQLite + reqwest).**
- `domain/types.rs` (miroir de `types.ts`) + `domain/replay.rs` (port de `scoreboard.ts`,
  recompute autoritaire) — tests de parité avec `scoreboard.test.ts`.
- `store.rs` : persistance SQLite (table unique `runs`, migrations `0001`-`0002`), PB **dérivé**
  (MAX wpm par bucket `WHERE pb_eligible = 1`, pas de table PB), historique filtrable.
  Depuis `0002` : colonne `keystroke_log` (JSON brut, NULL pour les vieux Runs) et
  colonne `kind` (`practice`/`race`) — les Races entrent dans l'historique via le
  `Finish` WS (`pb_eligible = 0` : leur fin stricte les rend incomparables aux
  buckets Practice ; un bucket « race » dédié viendra avec un éventuel leaderboard).
- `discord.rs` : OAuth (`POST /token`) + identité via `/users/@me` (cache court), mode dev.
- `quote.rs` : `GET /api/quote`, proxy API-Ninjas (clé `X-Api-Key` côté serveur, `id` opaque
  dérivé du texte, `wikipediaUrl` construit depuis l'auteur). Clé absente → `502`.
- Endpoints : `GET /api/health`, `GET /api/quote`, `POST /token`, `POST /api/runs` (recompute +
  persistance + verdict PB), `GET /api/history`.
- Origine unique : le build Vite (`STATIC_DIR`, défaut `../frontend/dist`) est servi en
  `fallback_service` (ServeDir → `index.html` pour le routage SPA). `dotenvy` charge
  `backend/.env` (sans écraser l'env du shell). Port configurable via `PORT` (défaut 8080).
- `ws/` : Phase 2 **livrée** — Rooms indexées par **clé** (salon vocal *ou* Code de partie,
  ADR 0008 : `JoinChannel` crée à la volée, `CreateRoom` tire un code de 5 caractères,
  `JoinCode` ne crée jamais et répond `RoomNotFound`), plafond de 8 présents (`RoomFull`),
  owner, partants figés au RaceStart
  (`all_racers_done`), recompute autoritaire au Finish, revanche sur texte neuf. Messages
  bornés à 256 Ko ; `GET /api/quote` authentifié (sinon quota API-Ninjas drainable).

- Mode **Drill** câblé dans l'UI Practice (bouton `drill`, longueur/Settings masqués) :
  texte personnalisé = échauffement sur les Weak spots du profil (`GET /api/profile/analysis`,
  bigramme « fjf jfj », touche « eee eee ») + mots de la word-list contenant ces Weak spots
  (`core/text-gen/drill.ts`, pur et seedé, testé). Sans profil, le Mode l'explique et propose
  de jouer d'abord. `pb_eligible = 0` (texte personnalisé — même règle que Zen/Time infini),
  le Run entre dans l'historique (filtre `drill` ajouté).
- Modes **Zen** et **Time infini** câblés dans l'UI Practice : bouton `zen` (aucun texte cible,
  affichage du texte tapé, tout compte comme correct — miroir `replay_zen`) ; valeur `∞` (0) du
  Mode `time` (horloge désactivée, flux de mots re-généré en continu avec le MÊME Rng, chrono qui
  monte). Les deux finissent sur `Shift+Enter` (`endedAtMs`) et sont exclus des PB. Longueur et
  Settings masqués pour Zen. `liveWpmZen` alimente le compteur live.

**Intégration Discord (Activity) — état et pièges connus.**
- OAuth réel actif : `DISCORD_CLIENT_ID/SECRET` (backend `.env`) + `VITE_DISCORD_CLIENT_ID`
  (frontend `.env`, cuit dans le bundle → rebuild après changement). Runbook complet dans
  le README (section « Dans Discord »).
- L'application vit sur un **compte dev séparé, SANS team** : une app dans une team exige
  la 2FA de tous ses membres à chaque action sensible (Reset Secret…) — c'est ce qui a
  motivé la séparation. Le compte principal (qui possède le serveur) sert à jouer.
- Une activité **non publiée est invisible** dans le menu 🚀 pour quiconque n'est ni
  propriétaire ni **App Tester** (portail → App Testers → inviter + ACCEPTER le courriel).
  Il faut aussi l'installer sur le serveur (portail → Installation → Guild Install).
- Un quick tunnel cloudflared **change d'URL à chaque redémarrage** → remettre à jour le
  URL Mapping à chaque session (tunnel nommé Cloudflare pour une URL stable, plus tard).
- Documents légaux exigés par le portail : `TERMS.md` / `PRIVACY.md` (racine du dépôt,
  liés en GitHub public). Tenir `PRIVACY.md` fidèle au comportement réel du code.

## Example dialogue

> **Dev:** When the player finishes, do we show them the live WPM?
> **Architect:** No — we freeze the **Live stats** but the **Authoritative scoreboard** is what we display, recomputed by Rust from the **Keystroke log**. The live number was just to keep the counter moving.
> **Dev:** In the MVP, are they doing a Practice or a Race?
> **Architect:** Always a **Practice** — free input, solo. **Race** needs a **Room** and blocking input, which is Phase 2. We can still flip on blocking input in a Practice to test that controller.
> **Dev:** And if they picked Time 30s with Punctuation on?
> **Architect:** Then the **Mode** is `Time` and `Punctuation` is one active **Setting**. The Mode ends the **Run** at 30s; the Setting only changed what text appeared.
