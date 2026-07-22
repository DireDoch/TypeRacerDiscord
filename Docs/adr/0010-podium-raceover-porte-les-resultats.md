# Le podium : `RaceOver` porte les résultats, pas seulement l'ordre

Deux constats ont ouvert cette décision.

D'abord, le glossaire définit le **Gap (écart)** comme « the headline of the finish — the
number that gets said out loud — while absolute WPM is secondary », et **rien ne
l'implémente** : `ui/race.ts` n'affiche que du WPM. Le podium de la section D est
l'endroit où le Gap doit enfin exister.

Ensuite, `RaceOver { ranking: Vec<PlayerId> }` ne transporte qu'un ordre. Le serveur
possède pourtant le scoreboard autoritaire complet de chaque partant — il le calcule au
Finish, s'en sert pour classer, puis n'en garde que le WPM (`finishers: Vec<(PlayerId,
f64)>`). Le brief D veut « leurs temps et leurs statistiques », et un clic sur un joueur
pour voir son graphe.

## Pourquoi pas `GET /api/runs/:id`

L'endpoint existe et rendrait exactement le détail voulu — mais `store.rs` le scope au
demandeur (`WHERE id = ? AND player_id = ?`). C'est une frontière de confiance
délibérée : la relâcher ferait de l'ID de Run un oracle sur les Runs de n'importe qui.

On pourrait vouloir l'autoriser au cas particulier « tu étais partant de cette course » —
sauf que **le serveur ne peut pas le vérifier après coup** : la composition d'une course
vit dans la `Room` en mémoire et disparaît avec elle. Il faudrait persister la composition
des courses uniquement pour répondre à cette question. Rejeté.

Le WebSocket n'a pas ce problème : il n'atteint, par construction, que les sockets de la
Room. L'autorisation est la connexion elle-même.

## Décision

`RaceOver { ranking: Vec<PlayerId> }` devient `RaceOver { results: Vec<RaceResult> }` où
`RaceResult` porte `{ player_id, wpm, accuracy, duration_ms, forfeit, series }`.
**L'ordre du tableau est le classement** — il n'y a plus de champ d'ordre séparé.

- Le **Gap** est dérivé côté client : `duration_ms − duration_ms[0]`. Il s'affiche en
  gros ; WPM et ACC en dessous.
- Le **clic sur un joueur** déplie son graphe (chart.js, comme `ui/results.ts`) sans
  aucun aller-retour : la série est déjà là.
- Les **Abandons** portent `forfeit: true`, pas de série, pas de graphe (aucun recompute
  n'est fait sur un log d'abandon — voir le glossaire).

Corollaire vérifié : classer au WPM et classer au temps donnent le **même ordre** en
Race. Tout le monde tape le même texte et la course ne se termine qu'à 100 % exact, donc
le nombre de caractères corrects est identique pour tous les finisseurs — WPM et durée
sont inversement proportionnels. Aucun arbitrage à faire entre « podium au temps » et
« classement au WPM ».

## Consequences

- `RaceState::Racing.finishers` passe de `Vec<(PlayerId, f64)>` à `Vec<RaceResult>` : le
  scoreboard complet est retenu jusqu'à `end_race` au lieu d'être jeté.
- Un `RaceOver` pèse ~19 Ko à 8 joueurs (séries par seconde comprises), très en dessous
  du plafond de 256 Ko déjà appliqué aux messages. Message unique, pas de flux.
- `PlayerFinished` est inchangé : il reste le signal live « untel a fini », le podium ne
  s'en nourrit plus.
- Aucun nouvel endpoint HTTP, et **aucune modification du scope de `GET /api/runs/:id`**.
