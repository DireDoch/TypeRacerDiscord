// Bibliothèque de composants vectoriels des assets Discord (issue #106).
//
// Ce fichier ne pose AUCUNE page et ne rend rien de lui-même : chaque asset a
// son propre `.typ` qui l'importe, règle sa page et appelle les composants.
// `#import` n'évalue que les noms — importer ce fichier n'entraîne jamais un
// rendu parasite chez l'importeur.
//
// La palette est recopiée À LA MAIN depuis `frontend/src/style.css` `:root` :
// Typst ne sait pas lire un CSS, il n'y a pas de source unique possible entre
// les deux. Une retouche là-bas se reporte ici, sans quoi l'icône affichée
// dans l'étagère Discord et l'écran de jeu qu'elle ouvre divergent.

#import "@preview/cetz:0.3.4"

#let nuit = rgb("#12161f") // fond
#let panel = rgb("#1b2230") // séparation, décor
#let corail = rgb("#ff7a59") // accent, l'identité visuelle du jeu
#let texte = rgb("#e8ecf4")
#let sourd = rgb("#96a0b5") // pneus, éléments secondaires
#let rouge = rgb("#ff4d6d") // réservé à la FAUTE de frappe — ne pas décorer avec

/// Voiture de profil, nez à droite.
///
/// Occupe environ 10 × 4 unités cetz, posée sur `y = 0` : l'appelant place et
/// dimensionne (`translate`, `scale`), le composant ne le fait pas pour lui.
/// D'où l'absence de paramètre `taille` — cetz sait déjà mettre à l'échelle, le
/// redéclarer ici reviendrait à réécrire sa transformation à la main.
///
/// Dessine dans le repère courant et ne renvoie PAS un `canvas()` : un canvas
/// est du contenu opaque, impossible à superposer à un autre composant dans un
/// repère commun — ce que la composition voiture + clavier (#108) exige.
///
/// Nez à droite : sur la piste de course, la progression va de gauche à droite
/// (`bar-fill` dans `frontend/src/ui/race.ts`). Une voiture tournée vers la
/// gauche raconterait l'inverse du jeu.
#let voiture(couleur: corail) = {
  import cetz.draw: *

  // Carrosserie : UNE seule silhouette fermée plutôt qu'un assemblage de
  // rectangles. À 48 px dans l'étagère Discord, il ne reste que le contour —
  // un contour unique y survit, une pile de formes s'y brouille.
  //
  // La face arrière est parfaitement verticale quand le nez, lui, est fuyant.
  // Cette asymétrie est délibérée : c'est le curseur bloc de l'écran de frappe,
  // la seule allusion au clavier que l'icône se permet à cette taille.
  line(
    (0.2, 1.0),
    (0.2, 2.6),
    (1.4, 2.6),
    (2.9, 3.9),
    (6.2, 3.9),
    (7.9, 2.5),
    (9.9, 2.0),
    (9.9, 1.0),
    close: true,
    fill: couleur,
    stroke: none,
  )

  // Bas de caisse assombri : la seule profondeur que s'autorise un style plat.
  // Dérivé de `couleur`, donc une voiture repeinte reste cohérente.
  rect((0.2, 1.0), (9.9, 1.45), fill: couleur.darken(22%), stroke: none)

  // Aileron, débordant à l'arrière — le repère « voiture de course » le moins
  // cher en formes.
  rect((-0.3, 2.55), (1.5, 2.95), fill: couleur.darken(22%), stroke: none)

  // Vitre en `nuit` : elle vaut trou dans la carrosserie. Fixe et non dérivée
  // de `couleur`, elle doit rester la couleur du fond quelle que soit la teinte
  // de la voiture.
  line(
    (1.75, 2.75),
    (3.05, 3.6),
    (5.85, 3.6),
    (6.95, 2.75),
    close: true,
    fill: nuit,
    stroke: none,
  )

  // Roues par-dessus la carrosserie, pas dessous : pas d'arche à découper, et
  // la silhouette gagne deux ancrages francs. Pneu en `sourd` et non en `nuit`,
  // sinon il disparaît dans le fond de l'icône.
  for x in (2.4, 7.5) {
    circle((x, 0.95), radius: 0.95, fill: sourd, stroke: none)
    circle((x, 0.95), radius: 0.36, fill: nuit, stroke: none)
  }
}
