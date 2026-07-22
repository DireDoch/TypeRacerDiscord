# Le décompte de Race passe à 7 s — un réglage produit, pas une unité de mesure

Le brief de la Race multijoueur (`Contexte/FeatureSupp_0.0.1.md`, section D) demande un
décompte de 7 s ; CONTEXT.md fige le décompte multijoueur à 3 s depuis la Phase 2. Le
précédent immédiat (ADR 0004, décompte solo) a coûté une migration et l'invalidation de
tous les PB : la question posée d'abord était donc « est-ce la même classe de décision ? ».

**Non.** ADR 0004 changeait *ce qui est mesuré* — le temps de réaction sortait du
dénominateur du WPM, rendant les Runs d'avant et d'après incomparables. Ici, quelle que
soit la valeur du décompte, on mesure exactement la même chose : t=0 = la fin du décompte
(« GO »), le temps de réaction reste compté. Et la Race n'est **jamais** PB-eligible (fin
stricte, texte 100 % exact) : il n'y a aucun classement à corriger, aucun backfill.

## Considered Options

- **Garder 3 s** (statu quo) : suffisant pour synchroniser, mais la grille de la Race
  gagne en Phase D des voitures avec avatar + nom, et son texte devient une Quote de
  longueur variable. 3 s ne laissent pas le temps de voir qui est là ni de lire le
  premier mot. Le décompte ne sert plus seulement à synchroniser, il sert à cadrer.
- **Valeur variable** (7 s à la première course, 3 s aux revanches ; ou réglable par le
  party leader) : rejeté. Il faudrait porter la valeur dans `RaceStart` et l'expliquer
  aux joueurs, pour un réglage que personne ne touchera après le premier jour.
- **7 s fixe** (choisi) : une constante, `RACE_COUNTDOWN_S`, côté client.

## Consequences

- `ui/race.ts` : `Countdown(3)` → `Countdown(RACE_COUNTDOWN_S)`. Aucun autre changement.
- **Aucune migration, aucun backfill.** Le décompte de Race est explicitement déclaré
  ajustable à l'avenir sans ADR ni invalidation, tant que t=0 reste la fin du décompte.
  C'est ce qui le distingue du décompte solo, dont la suppression était irréversible.
- Le **solo reste sans décompte** (ADR 0004) : t=0 = 1re frappe. Solo et Race ne mesurent
  toujours pas la même chose et ne se comparent jamais.
- La règle produit « le décompte ne masque jamais le texte » est inchangée, et devient
  plus utile encore : 7 s de texte visible, c'est du temps de lecture réel.
