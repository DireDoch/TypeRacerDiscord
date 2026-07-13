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
cd backend  && cargo run        # sert aussi le build statique sur :8080 (PORT pour changer)
```

## Dans Discord (Activity)

### Portail développeur (une fois)

L'application vit sur un **compte dev dédié, sans team** (une app en team exige la 2FA
de tous ses membres à chaque action sensible). Sur <https://discord.com/developers/applications> :

1. **General Information** : Application ID (= client id, public) ; liens Conditions/
   Confidentialité → `TERMS.md` / `PRIVACY.md` du dépôt GitHub.
2. **OAuth2** : Reset Secret (→ `backend/.env` uniquement) ; Redirect `https://127.0.0.1`.
3. **Activities** : Enable + URL Mappings (voir tunnel ci-dessous).
4. **Installation** : Guild Install → ouvrir le lien d'installation avec le compte admin
   du serveur → Autoriser.
5. **App Testers** : inviter chaque testeur (compte principal inclus !) par pseudo — ils
   doivent ACCEPTER le courriel, sinon l'activité est INVISIBLE dans le menu 🚀.

### Chaque session de test

```sh
cd frontend && npm run build                      # si le front a changé
cd backend  && cargo run                          # sans ⚠️ MODE DEV au démarrage
cloudflared tunnel --url http://localhost:8080    # 2e terminal, laisser ouvert
```

Copier l'URL du tunnel dans **Activities → URL Mappings** (Prefix `/`, Target = domaine
SANS `https://`) → Save. ⚠️ un quick tunnel change d'URL à chaque redémarrage.

Puis : salon **vocal** → 🚀 Activités → l'app → Lancer (consentement `identify` à la
première fois). Ctrl+R dans Discord si l'app vient d'être modifiée.

### Pièges connus / debug

- **CSP des Activities** : dans l'iframe, TOUTE requête doit passer par `/.proxy/…`
  (géré par `discord.ts::proxyBase()`). Symptôme si oublié : UI intacte, zéro réseau.
- Les **erreurs s'affichent dans un bandeau rouge** en bas du jeu (la console est
  invisible dans Discord). Pour une vraie console : Discord AU NAVIGATEUR
  (discord.com/app) → lancer l'activité → F12.
- Iframe blanche → URL Mapping périmé (tunnel redémarré).
- Activité absente du menu 🚀 → invitation App Tester non acceptée, ou app pas
  installée sur le serveur.
