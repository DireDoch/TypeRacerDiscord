# Cursus Apprendre étendu à 100 leçons — extension, pas un v2 séparé

Le brief FeatureSupp décrit un cursus « Apprendre » beaucoup plus ambitieux
(100 défis progressifs, visuel doigts/clavier) que les 13 Lessons livrées à
l'issue #8. Plutôt qu'un second système parallèle, on étend le cursus
existant : les 13 Lessons actuelles deviennent les 13 premières des 100,
même `Lesson[]`, même table `learn_progress` (le serveur garde le MAX),
même moteur seedé (`generateLessonExercise`). Le barème par tranches
(`STAGES`) reste une simple table statique — passer à 100 Lessons n'ajoute
que des lignes, pas de nouvelle mécanique.

## Considered Options

- **Cursus v2 séparé, coexistant avec les 13 Lessons actuelles** : rejeté —
  duplique la persistance de progression et la logique de déblocage pour
  zéro bénéfice ; les 13 Lessons actuelles sont déjà exactement le début de
  ce que demande le brief (posture, rangées, majuscules, ponctuation,
  chiffres, mots, fluidité), pas une chose différente.
- **Clavier live surlignant la touche/le doigt attendu, sur tout le cursus**
  : rejeté pour cette itération — nouveau moteur de rendu couplé à
  l'InputController, disproportionné face à la demande réelle du brief
  (montrer UNE FOIS comment se positionner). Un visuel statique dans le
  contenu pédagogique des toutes premières Lessons suffit ; le reste du
  cursus garde l'écran texte actuel.
- **Introduire un seuil WPM sur les tranches tardives** (ex : fluidité,
  mots avancés) : rejeté — l'accuracy reste le SEUL critère de déblocage, à
  toutes les tranches, comme aujourd'hui. Un gate de vitesse récompenserait
  la rapidité au détriment de la précision, contraire à l'esprit du cursus
  (« la vitesse viendra seule », leçon 2).

## Consequences

- CONTEXT.md (terme **Lesson**) ne dit plus « speed never gates early
  stages » (ambigu — sous-entendait un gate possible plus tard) mais
  explicitement : l'accuracy est le seul critère de déblocage, à toute
  tranche.
- Le contenu précis des 87 nouvelles Lessons (catégories au-delà des 13
  actuelles, ordre exact) est un détail d'auteuring, pas une décision
  d'architecture — traité lors du découpage en issues, pas ici.
- Le visuel doigts/clavier est un ajout de CONTENU (illustration statique)
  aux toutes premières Lessons, pas un nouveau champ structurel sur
  `Lesson` au-delà d'une référence d'asset.
