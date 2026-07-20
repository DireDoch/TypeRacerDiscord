# Contrat d'API HTTP — TypeRacerDiscord (livrable #3)

Origine **unique** (1 seul URL Mapping Discord) : le backend Rust sert le build Vite
statique **et** expose l'API sous `/api` + `/token`. Tout est JSON (`Content-Type: application/json`)
sauf les fichiers statiques.

Termes : voir `CONTEXT.md`. Types miroir : `frontend/src/core/types.ts` ↔ `backend/src/domain/types.rs`.

## Identité & sécurité

- OAuth scope = `identify` uniquement.
- `player_id` = Discord user ID (snowflake), **toujours string** (dépasse 2^53). Jamais un `number` JSON.
- **Identité jamais fournie par le corps de requête.** Les endpoints `/api/*` qui ont besoin du
  joueur lisent le header :

  ```
  Authorization: Bearer <discord_access_token>
  ```

  Le backend résout l'identité à partir de ce token (cache court en mémoire). C'est la seule décision
  de sécurité ouverte ; recommandation retenue : **résolution serveur du player_id**, pas de
  player_id envoyé par le client → non forgeable, même en solo.
- `.env` (serveur) : `APININJAS_API_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Jamais exposés au client.

---

## `GET /token` — échange OAuth2

Échange le `code` d'autorisation (obtenu par l'Embedded App SDK) contre un `access_token`.
Le secret client reste serveur. (Nommé `GET` par convention Discord ; **implémenté en `POST /token`**
car il porte un corps JSON. Renvoie `503` si l'OAuth n'est pas configuré côté serveur — mode dev.)

**Requête**
```json
{ "code": "abc123..." }
```

**Réponse 200**
```json
{ "access_token": "xxxxxxxx" }
```

**Erreurs** : `400` code invalide · `502` Discord injoignable.

---

## `GET /api/quote` — proxy API-Ninjas

Proxy serveur vers API-Ninjas (clé `X-Api-Key` injectée côté serveur). Mode Quotes uniquement ;
ignore Settings et longueurs.

**Requête** : aucun corps. (Optionnel `?maxLength=` plus tard.)

**Réponse 200**
```json
{
  "id": "q_7f3a",
  "text": "The unexamined life is not worth living.",
  "author": "Socrates",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/Socrates"
}
```

- `id` : identifiant opaque, ré-échoié dans `POST /api/runs` (`quoteId`).
- `wikipediaUrl` : construit serveur à partir du nom d'auteur.

**Erreurs** : `502` API-Ninjas injoignable/quota.

---

## `POST /api/runs` — soumission d'un Run (recompute autoritaire)

Reçoit le **texte cible + le keystroke log brut**, **recalcule le scoreboard autoritaire** en Rust
(replay : log+texte → curseur borné au mot → WPM/Raw/ACC/breakdown/série par seconde/Burst),
le **stocke**, et renvoie le scoreboard + verdict PB. **Un seul POST par Run.** Le log brut n'est
pas persisté ; seule la série `per_second` dérivée l'est.

`Authorization: Bearer <token>` requis → résout `player_id`.

**Requête**
```json
{
  "config": {
    "mode": "time",
    "modeValue": 30,
    "language": "english",
    "punctuation": true,
    "numbers": false
  },
  "seed": 1828374651,
  "targetText": "the quick brown fox ...",
  "quoteId": null,
  "keystrokes": [
    { "t": 400, "k": "t" },
    { "t": 512, "k": "h" },
    { "t": 1003, "k": "", "ctrl": "backspace" },
    { "t": 1100, "k": "h" }
  ],
  "endedAtMs": 30000
}
```

- `targetText` : `""` pour Zen. Pour Quotes, **`quoteId` obligatoire** ; `targetText` = la Quote.
  Pour Drill, `targetText` = le texte personnalisé construit côté client (échauffement + mots ciblés).
- `keystrokes` : `t` en ms depuis t=0 (fin du décompte). Voir format dans `types.ts`.
- `endedAtMs` : instant de fin (Shift+Enter pour Zen/Time infini ; le serveur l'ignore pour Time fini
  où la durée = `modeValue`, et le recoupe avec l'instant de complétion pour Words/Quotes).

**Réponse 200**
```json
{
  "runId": "r_01HXYZ...",
  "scoreboard": {
    "wpm": 78.4,
    "raw": 82.1,
    "accuracy": 96.3,
    "characters": { "correct": 192, "incorrect": 7, "extra": 2, "missed": 0 },
    "durationMs": 30000,
    "perSecond": [
      { "t": 1, "wpm": 60.0, "raw": 66.0, "errors": 1, "burst": 90.0 },
      { "t": 2, "wpm": 72.0, "raw": 75.0, "errors": 0, "burst": 90.0 },
      { "t": 30.0, "wpm": 78.4, "raw": 82.1, "errors": 0, "burst": 88.0 }
    ],
    "pbEligible": true
  },
  "isPersonalBest": true,
  "previousPbWpm": 74.2
}
```

- `pbEligible` = `false` pour **Zen** et **Time infini** (durée variable) et pour **Drill**
  (texte personnalisé) — gardés en historique, exclus des PB.
- `isPersonalBest` = `true` seulement si éligible **et** WPM strictement supérieur au MAX du bucket.

**Erreurs** : `400` log/texte incohérent · `401` token absent/invalide.

---

## `GET /api/history` — historique du joueur

`Authorization: Bearer <token>` requis. Renvoie les Runs du joueur (le plus récent d'abord).
`perSecond` inclus pour re-tracer le graphe sans recompute.

**Requête** : query optionnelle `?limit=50&mode=time&modeValue=30` (filtre par bucket).

**Réponse 200**
```json
{
  "entries": [
    {
      "runId": "r_01HXYZ...",
      "createdAt": 1750000000000,
      "config": { "mode": "time", "modeValue": 30, "language": "english", "punctuation": true, "numbers": false },
      "wpm": 78.4,
      "raw": 82.1,
      "accuracy": 96.3,
      "characters": { "correct": 192, "incorrect": 7, "extra": 2, "missed": 0 },
      "durationMs": 30000,
      "perSecond": [ { "t": 1, "wpm": 60.0, "raw": 66.0, "errors": 1, "burst": 90.0 } ],
      "pbEligible": true
    }
  ]
}
```

Le **PB n'a pas de table** : il se dérive par `MAX(wpm) … GROUP BY bucket WHERE pb_eligible = 1`
(index `idx_runs_pb`).

---

## `GET | POST /api/learn/progress` — progression « Apprendre »

`Authorization: Bearer <token>` requis. Une valeur par Player : `completed` = nombre de
leçons complétées (la leçon d'index N, 0-based, est débloquée si `N <= completed`).
Les exercices de leçon ne sont **pas des Runs** : rien dans `runs`, ni PB ni historique
(table dédiée `learn_progress`, migration `0004`).

**GET — Réponse 200** (0 si jamais joué)
```json
{ "completed": 2 }
```

**POST — Requête** (après une leçon réussie ; le serveur garde le **MAX**, jamais de recul)
```json
{ "completed": 3 }
```

**POST — Réponse 200** : la valeur stockée (utile si un autre appareil était plus avancé)
```json
{ "completed": 3 }
```

Le seuil d'accuracy est vérifié côté client (barème statique dans `core/learn.ts`) —
pas d'anti-triche : une leçon n'apporte que du contenu pédagogique.
