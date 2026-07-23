# Ponytail debt ledger

Chaque raccourci délibéré porte un commentaire `ponytail:` nommant son plafond et son
chemin de sortie. Ce registre les rassemble pour qu'un report ne devienne pas silencieusement
permanent. Régénérer avec `/ponytail:ponytail-debt` (scan `(#|//|*) ?ponytail:`, le préfixe
`*` inclus attrape aussi les marqueurs en bloc JSDoc).

## backend/src/store.rs

- **store.rs:64** — `insert_run` prend 9 arguments positionnels plutôt qu'un struct.
  ceiling: un seul appelant de prod (`main.rs`), le reste sont des tests positionnels.
  upgrade: regrouper dans un struct si un 10e argument arrive.

## backend/src/ws/mod.rs

- **ws/mod.rs:432** — `generate_code` tire un Code de partie libre par une boucle non bornée
  (pas de crate `rand`). ceiling: ne peut tourner indéfiniment que si les ~28 M de codes
  sont tous pris (~225 M de joueurs connectés). upgrade: allonger `CODE_LEN`.

## frontend/src/discord.ts

- **discord.ts:41** — le repli d'avatar est l'initiale rendue en CSS derrière l'image, pas
  un `onerror` JS. ceiling: couvre un avatar absent ET un CDN bloqué par la CSP, visuellement.
  upgrade: si la CSP de l'iframe bloque vraiment le CDN, la correction est un URL Mapping
  Discord vers `cdn.discordapp.com` + un préfixe `proxyBase()`, pas du code de repli.

## frontend/src/ui/potg.ts

- **potg.ts:45** — `duelWindow` traite les deux logs comme partageant une horloge, alors que
  chacun a son t=0 local (décompte client). ceiling: ~2 % de dérive inter-client sur la
  fenêtre, assumé pour un replay d'ambiance. upgrade: réaligner sur `RaceStart.startAtEpochMs`
  comme origine commune si l'exactitude devient un enjeu. _(même dette que race.ts:540)_

## frontend/src/ui/race.ts

- **race.ts:540** — le WPM live des autres joueurs est dérivé de `charsDone` sur l'horloge
  locale de chaque client. ceiling: ~2 % d'écart sur une course de 30 s, compteur d'ambiance
  seulement. upgrade: utiliser `RaceStart.startAtEpochMs` comme origine commune si le chiffre
  doit être exact. _(même dette que potg.ts:45)_

## frontend/src/ui/results.ts

- **results.ts:132** — la couleur de la série du graphe est un hex en dur au lieu de lire les
  variables CSS. ceiling: chart.js ne lit pas les variables CSS. upgrade: la décision 13
  remplace chart.js par un SVG maison à l'étape 5.

## frontend/src/ui/typing-zone.ts

- **typing-zone.ts:113** `no-trigger` — `placeCaret` garde les dernières mesures du curseur
  quand l'ancre est vide (0×0) en fin de mot. ceiling: repose sur une zone de frappe en
  chasse fixe (tous les glyphes ont la même boîte). upgrade: aucun déclencheur nommé — à
  revisiter si la zone de frappe cesse d'être en monospace.

---

7 markers, 1 with no trigger.
