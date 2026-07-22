# Play of the Game : un duel choisi par le serveur, rejoué sur une horloge commune

La section D veut, après chaque Race, un replay au ralenti du duel le plus serré à
l'arrivée — « comme dans Overwatch ». Le Replay existe déjà (`ui/replay.ts`), mais il
rejoue **un** log, du début à la fin, à vitesse réelle. Trois écarts à combler.

## Le choix du duel appartient au serveur

`fn duel(&[RaceResult]) -> Option<(usize, usize)>` : la paire de finisseurs **consécutifs**
dont l'écart de durée est le plus faible, où qu'elle soit au classement — c'est
littéralement « les deux autos qui ont terminé le plus proche ». Les Abandons sont exclus.

`None` — donc **pas de Play of the Game** — s'il y a moins de deux finisseurs, ou si même
le meilleur écart dépasse **2 s**. On ne fabrique pas un duel qui n'a pas eu lieu ; un
« Play of the Game » à 8 s d'écart détruirait la promesse de la fonctionnalité.

Cette logique n'existe **qu'en Rust**. Elle ne fait pas partie du `core/` en miroir : le
client ne la rejoue jamais, il reçoit le résultat. `RaceOver` transporte donc les **deux
logs concernés**, pas les huit.

Conséquence : le serveur doit **retenir les Keystroke logs** des partants jusqu'à
`end_race`, au lieu de les sérialiser vers la base et les oublier. ~72 Ko par Room à huit
joueurs, libérés à la fin de la course.

## Une horloge commune, pas deux

C'est le point qui fait exister le duel. Les deux logs sont rejoués sur **la même**
horloge, pas chacun aligné sur sa propre arrivée : on voit une voiture couper la ligne,
puis l'autre 0,5 s plus tard. Deux replays alignés chacun sur sa fin montreraient deux
arrivées simultanées — c'est-à-dire rien.

Fenêtre : de 3 s avant l'arrivée du **premier** des deux, jusqu'à l'arrivée du second.

## Le ralenti est gratuit

`feedUntil(controller, log, from, elapsed)` est déjà pure et reçoit l'`elapsed` en
paramètre. Le ralenti est `elapsed * 0.25` — une multiplication. La fenêtre de ~3,5 s
réelles occupe donc ~14 s d'écran.

## Consequences

- Nouvel écran client réutilisant `feedUntil` + `wordsHtml` : deux `FreeInput`, deux
  zones de frappe empilées, une seule horloge. `runReplay` n'est **pas** généralisé — il
  reste le Replay solo simple que décrit le glossaire.
- Podium et Play of the Game sont **purement client** : `end_race` a déjà remis la Room en
  `Lobby` avec un texte neuf au moment où `RaceOver` part. Aucune séquence serveur, aucun
  minuteur : le joueur avance par boutons, et un `RaceStart` reçu pendant l'après-course
  interrompt l'écran — la course prime.
- Le duel est une fonction pure sur un tableau : c'est le test qui garde cette décision
  honnête (paire la plus serrée, seuil dépassé → `None`, abandons ignorés, < 2 finisseurs).
