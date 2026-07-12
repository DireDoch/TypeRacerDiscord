# TypeRacerDiscord
A embedded game for playing with your friend in discord

## Mise en place (dev local)

Prérequis : Rust (cargo) et Node (npm).

```sh
# Backend (port 8080) — mode dev automatique si les secrets Discord sont absents
cd backend
cp .env.example .env        # optionnel : clés Discord/API-Ninjas (voir le fichier)
cargo run

# Frontend (port 5173, proxy /api /token /ws → 8080) — dans un 2e terminal
cd frontend
npm install
npm run dev
```

Sans clés dans `.env` le backend démarre en **mode dev** : le Bearer token sert
directement de `player_id` (jouable au navigateur, hors Discord). `GET /api/quote`
exige `APININJAS_API_KEY` (sinon 502 → le Mode Quotes affiche une erreur).

## Tests automatisés

```sh
cd frontend && npx vitest run   # 28 tests (domaine TS = référence de l'algo)
cd backend  && cargo test       # 13 tests (parité Rust + store SQLite)
```

## Test manuel

**Practice (solo)** : ouvrir <http://localhost:5173> — choisir Mode/Settings, taper.
Zen et Time `∞` se terminent par `Shift+Enter`. L'écran de résultats affiche le
scoreboard autoritaire recalculé par le backend.

**Race (duel)** : ouvrir DEUX onglets sur le même salon (`?token=` distingue les joueurs) :

```
http://localhost:5173/?race&token=alice
http://localhost:5173/?race&token=bob
```

Le 1er arrivé est owner (👑) et voit « Démarrer la course » ; décompte de 3 s,
barres de progression live, la course ne se termine qu'avec un texte 100 % exact.
`&channel=autre-salon` isole une autre Room.

**API au curl** (mode dev) :

```sh
curl http://localhost:8080/api/health
curl -H "Authorization: Bearer dev-player-1" "http://localhost:8080/api/history?limit=5"
```

## Build de prod (origine unique)

```sh
cd frontend && npm run build    # → frontend/dist
cd backend  && cargo run        # sert aussi le build statique sur :8080
```
