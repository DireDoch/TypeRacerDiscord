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

**Mode**:
The rule that decides what text is presented and when a Run ends — one of `Time`, `Words`, `Quotes`, `Zen`. Exactly one Mode per Run.

**Setting**:
An independent, cumulable text modifier applied on top of a Mode — currently `Punctuation` and `Numbers`. Zero or more per Run.
_Avoid_: Modifier, Option, Toggle.

**Keystroke log**:
The recorded timeline of a Player's keystrokes during a Run (what was typed and when). The raw input from which all stats are derived; sent once to the backend for the Authoritative scoreboard, not persisted.
_Avoid_: Input history, Replay.

**Live stats**:
Stats computed on the client during a Run for immediate UI feedback (the moving WPM counter, the graph filling in). Not authoritative.

**Authoritative scoreboard**:
The final stats (WPM, Raw, Accuracy, character breakdown, per-second series) recomputed by the Rust backend from the Keystroke log at the end of a Run. The numbers of record. In multiplayer this is also the anti-cheat check.
_Avoid_: Results, Score.

**Player**:
A Discord user playing the game, identified by their Discord user ID (snowflake). No separate account exists — identity comes entirely from the Discord OAuth handshake.
_Avoid_: User, Account, Profile.

**Config bucket**:
The exact combination that makes two Runs comparable: Mode + its value + language + active Settings. `Time 30s English Punctuation` and `Time 30s English` are different buckets.
_Avoid_: Category, Group.

**Personal Best (PB)**:
A Player's best result (by WPM) within a single Config bucket. A Player has at most one PB per bucket. **Variable-duration Runs never produce a PB** — this excludes Zen and Time infini (their length isn't fixed, so WPM isn't comparable). They are still saved to history.
_Avoid_: Record, High score, Best.

**Time infini**:
The Time Mode with its value set to `0` — the clock is disabled, words stream endlessly, and the Run ends only when the Player presses `Shift+Enter`. There is still a target text (unlike Zen). Excluded from PBs.
_Avoid_: No-timer, Disabled time, Endless.

**Quote**:
The fixed text fetched for a Quotes Run (text + author), via the Rust quote proxy. Settings and length controls do not apply — the Player types the whole Quote. The author name builds a "learn more" link to that author's Wikipedia page.
_Avoid_: Citation, Passage.

**Room** (Phase 2, not in MVP):
A multiplayer session scoped to one Discord voice channel (`channelId`). Holds the set of Players racing the same text together.
_Avoid_: Lobby, Session, Channel.

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
t=0 = fin du compte à rebours de 3 s (PAS la 1re frappe). Horloge **monotone**
(`performance.now()`, jamais `Date.now()`). Le temps de réaction est compté. En solo
t=0 est un événement local ; en Phase 2 ce sera le `RaceStart` serveur — seul
`RunClock.start()` (`core/clock.ts`) bascule.

**Borne de fin / durée.**
Time fini = `modeValue` (durée fixe). Words/Quotes = instant de complétion du dernier
caractère cible (terminer plus vite ⇒ meilleur WPM). Zen / Time infini = instant du
`Shift+Enter`, transmis par le client via `endedAtMs` dans `POST /api/runs`.

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

## État d'implémentation (avancement)

Ce qui est câblé et testé, par couche. Contrat détaillé : `Docs/API.md`.

**Frontend (`frontend/`).**
- `core/` domaine pur, testé (clock, types, input `free`/`blocking`-stub, text-gen seedé,
  `stats/scoreboard`) — la **référence** de l'algo.
- UI Practice (`src/ui/`, `main.ts`, Vite) : machine d'état idle→countdown→running→finished,
  graphe chart.js. Lancement `npm run dev`.
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

**Backend (`backend/`, Rust : Axum + sqlx/SQLite + reqwest).**
- `domain/types.rs` (miroir de `types.ts`) + `domain/replay.rs` (port de `scoreboard.ts`,
  recompute autoritaire) — tests de parité avec `scoreboard.test.ts`.
- `store.rs` : persistance SQLite (table unique `runs`, migration `0001`), PB **dérivé**
  (MAX wpm par bucket `WHERE pb_eligible = 1`, pas de table PB), historique filtrable.
- `discord.rs` : OAuth (`POST /token`) + identité via `/users/@me` (cache court), mode dev.
- `quote.rs` : `GET /api/quote`, proxy API-Ninjas (clé `X-Api-Key` côté serveur, `id` opaque
  dérivé du texte, `wikipediaUrl` construit depuis l'auteur). Clé absente → `502`.
- Endpoints : `GET /api/health`, `GET /api/quote`, `POST /token`, `POST /api/runs` (recompute +
  persistance + verdict PB), `GET /api/history`.
- Origine unique : le build Vite (`STATIC_DIR`, défaut `../frontend/dist`) est servi en
  `fallback_service` (ServeDir → `index.html` pour le routage SPA). `dotenvy` charge `backend/.env`.
- `ws/` : esquisse Phase 2, **non câblée**.

**Reste à faire (MVP).**
- Renseigner `DISCORD_CLIENT_ID/SECRET` (backend `.env`) + `VITE_DISCORD_CLIENT_ID` (frontend)
  pour activer l'OAuth réel — la forme des endpoints ne change pas (mode dev tant qu'absents).
- UI Zen et Time infini (la barre de config propose time/words/quotes ; pas encore Zen ni la
  valeur `0` de Time infini, qui finissent sur Shift+Enter).

## Example dialogue

> **Dev:** When the player finishes, do we show them the live WPM?
> **Architect:** No — we freeze the **Live stats** but the **Authoritative scoreboard** is what we display, recomputed by Rust from the **Keystroke log**. The live number was just to keep the counter moving.
> **Dev:** In the MVP, are they doing a Practice or a Race?
> **Architect:** Always a **Practice** — free input, solo. **Race** needs a **Room** and blocking input, which is Phase 2. We can still flip on blocking input in a Practice to test that controller.
> **Dev:** And if they picked Time 30s with Punctuation on?
> **Architect:** Then the **Mode** is `Time` and `Punctuation` is one active **Setting**. The Mode ends the **Run** at 30s; the Setting only changed what text appeared.
