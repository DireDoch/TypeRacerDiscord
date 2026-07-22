# Les Quotes ne produisent jamais de PB

Le Config bucket d'un Run Quotes est `(quotes, 0, langue, ponctuation, nombres)` —
`modeValue` vaut toujours `0`, donc **toutes** les Quotes partagent le même bucket alors
que leur longueur varie de l'une à l'autre. Une Quote de 40 caractères et une de 400 n'y
sont pas comparables : il suffisait de retomber sur une Quote courte pour poser un PB
inatteignable pour les longues. On retire l'éligibilité PB du Mode Quotes, avec la même
règle que Drill (issue #14).

## Considered Options

- **Bucketer par tranche de longueur** (courte / moyenne / longue, à la Monkeytype) :
  garde un PB significatif, mais la frontière entre tranches est un choix arbitraire —
  une Quote à 1 caractère de la limite change de bucket sans raison de fond.
- **Bucketer par Quote** (un PB par citation) : sémantiquement le plus juste (« bats ton
  record sur CETTE citation »), et moins coûteux qu'il n'y paraît — `target_text` est déjà
  persisté verbatim pour chaque Run (migration `0003`, ADR 0001), donc `AND target_text = ?`
  suffit, sans nouvelle colonne. Rejeté quand même : la plupart des buckets n'auraient
  qu'un seul Run avant qu'une Quote ne se répète (le pool API-Ninjas est grand), donc la
  plupart des « PB » ne seraient qu'un unique essai — peu de valeur pour beaucoup de
  bruit dans l'Historique/les stats.
- **Non éligible au PB** (choisi) : même règle que Zen, Time infini et Drill — un texte
  qui varie Run à Run sans que le bucket le capture rend la comparaison invalide. Le plus
  simple, cohérent avec le précédent Drill, zéro nouvelle colonne.

L'éligibilité passe d'une expression `&&` en ligne à une fonction `mode_pb_eligible(mode)`
(table par Mode), avec l'exception Time infini gardée à part (`modeValue == 0` n'est pas
une propriété du Mode mais d'UN Run donné dans ce Mode) — même miroir TS/Rust qu'avant.

## Réversibilité

Revenir en arrière (tranches ou par-Quote) reste possible côté code à tout moment. Ce qui
ne se défait pas : la migration de backfill (`UPDATE runs SET pb_eligible = 0 WHERE mode
= 'quotes'`) efface quels Runs Quotes étaient PB-eligible avant cette décision — un futur
retour en arrière repartirait d'un historique vide plutôt que de restaurer l'état
antérieur.

## Consequences

Un Run Quotes n'affiche plus jamais « ★ nouveau ! » ; il reste sauvegardé dans
l'Historique comme n'importe quel Run (`pbLabel` en Résultats gère déjà ce cas via
`pbEligible`, aucun changement d'UI nécessaire). Les Runs Quotes antérieurs à cette
décision perdent leur `pb_eligible` par le backfill — cohérent avec ce que la décision
aurait dû être depuis le début.
