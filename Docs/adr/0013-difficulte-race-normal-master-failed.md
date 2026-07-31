# Difficulté (Normal/Expert/Master) et l'issue Failed

Le PRD #59 introduit une Difficulté cumulable au Mode : un Player peut s'imposer une
frappe plus stricte, en Practice comme en Race. Deux niveaux au-dessus de Normal :

- **Expert** : le Run échoue si un mot est soumis (espace) alors qu'il contient encore
  une erreur non corrigée.
- **Master** : le Run échoue à la toute première frappe incorrecte, avant même qu'une
  correction soit possible.

## Où la logique vit

Les deux conditions sont évaluées **directement sur le log de frappes**, en pur — jamais
en modifiant un contrôleur d'entrée. Practice et Race utilisent aujourd'hui tous les deux
FreeInput (curseur libre) : le contrôleur bloquant que le glossaire annonçait pour Race
(« error must be corrected before advancing ») n'a en réalité **jamais été câblé** — Race
tape en flux libre exactement comme Practice, la « correction obligatoire » de CONTEXT.md
décrit une intention qui n'a jamais atterri dans le code. Le mécanisme d'échec de cette
ADR ne dépend donc d'AUCUN contrôleur particulier : la Difficulté se pose PAR-DESSUS le
log de frappes, quel que soit le contrôleur qui le produit —
`core/difficulty.ts::detectDifficultyFailure` rejoue ce log au fil de l'eau (même modèle
de pile que `stats/scoreboard.ts`) et renvoie le premier point d'échec, ou `null`. Mirroré
bit pour bit en Rust (`domain/difficulty.rs`), avec des vecteurs de parité partagés
(`test-vectors/difficulty.json`) — même convention que le Scoreboard (issue #19).

## Pourquoi Expert n'existe pas en Race

Le PRD #59 justifiait l'absence d'Expert en Race par le contrôleur bloquant qui rendrait
sa condition de déclenchement inatteignable. Ce contrôleur n'existant pas (voir
ci-dessus), la vraie raison est plus simple : Expert échoue au **mot soumis**, et Race n'a
qu'un adversaire — le texte — jamais un classement à départager sur une notion de mot
« encore faux » qui viendrait s'ajouter à Master. Master seul (échec à la frappe, le
signal le plus strict et le plus immédiat) est le niveau qui a du sens comme Réglage de
salon, appliqué à tous les Players à la fois. Expert reste une nuance solo, propre à
Practice, sans qu'aucune infrastructure supplémentaire ne soit nécessaire pour l'exclure.

## Pourquoi Master doit être autoritaire en Race

Practice se fait confiance (comme le reste du Scoreboard client). Race ne se fait
confiance sur RIEN — le Finish est déjà recalculé côté serveur contre son propre texte
(seed/texte lui appartiennent). Master doit suivre la même règle : le CLIENT détecte
localement (même `detectDifficultyFailure` que Practice) sa 1re frappe incorrecte et
arrête d'y toucher, mais le SERVEUR rejoue le log contre son propre texte
(`ws/mod.rs::fail_race`) avant d'enregistrer quoi que ce soit — une déclaration non
confirmée par le recompute est rejetée, exactement comme un `Finish` mensonger le serait.

## L'issue Failed

`RaceResult` gagne une variante `Failed { percent }`, à côté de `Finished`/`Abandoned` :

- `percent` = caractères corrects / longueur du texte cible AU POINT D'ÉCHEC, affiché
  (« failed (42%) ») — **jamais utilisé pour classer**. Classer par pourcentage
  récompenserait une faute tardive plus qu'une faute précoce sous la même Difficulté,
  ce qui n'a pas de sens : un Failed n'a pas « presque fini », il a été disqualifié.
- **Classement** : `Failed` partage le rang de queue d'`Abandoned` (même tri, un
  embranchement de plus dans le comparateur existant — pas un nouveau comparateur), et
  s'ordonne pareillement entre eux (premier arrivé aux fautes = pas de critère,
  l'ordre relatif suit celui déjà utilisé pour les abandons).
- Comme un Abandon : la voiture s'arrête au point exact de la faute, la course se
  débloque immédiatement pour les autres (personne n'attend un joueur en échec), le
  joueur reste au lobby pour la prochaine course, et **aucun Run n'est persisté** — un
  Failed ne pollue jamais l'historique ni les PB.

## Conséquences

- `core/difficulty.ts` / `domain/difficulty.rs` : nouveau module partagé, aucune
  dépendance sur `FreeInput` ni sur le contrôleur bloquant à l'exécution — pur, testable
  isolément, réutilisé tel quel par Practice (#64) et Race (#71).
- Aucun champ Difficulté n'entre dans `RunConfig` / le Config bucket : la Difficulté est
  un mode qui fait échouer un Run avant la ligne d'arrivée, pas une variante de calcul de
  score — aucun PB n'est jamais comparé entre deux Difficultés.
- `ws/mod.rs` : la Difficulté d'une Room suit le même patron que les autres Room
  settings (`countdown_s`, `max_players`, `ready_check`) — réglée par l'owner, hors
  course, re-diffusée via `RoomState`.
