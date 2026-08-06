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

/// Wordmark "Typpe|Racer" : la faute de frappe porte la marque plutôt qu'une
/// icône accolée au nom. Le 2e "p" — le doublon fautif — est seul en `rouge`,
/// la couleur que ce fichier réserve à la faute ; le curseur `|` en `corail`
/// (l'accent de l'identité) ; le reste en `texte`. `taille-texte` est le seul
/// paramètre : un wordmark n'a pas de largeur propre à figer, `scale` chez
/// l'appelant fait ce travail comme pour `voiture()`/`clavier()`.
///
/// Renvoie du CONTENU Typst (`stack`), pas un dessin cetz : un wordmark est du
/// texte, pas une forme vectorielle composable dans le repère de `scene()`. Se
/// place à côté d'un `canvas()`, jamais dedans.
#let logo(taille-texte: 1.4cm) = {
  set text(font: "JetBrainsMono NF", weight: "bold", size: taille-texte)
  stack(
    dir: ltr,
    spacing: taille-texte * 0.12,
    stack(
      dir: ltr,
      spacing: 0pt,
      text(fill: texte)[Typ],
      text(fill: rouge)[p],
      text(fill: texte)[e],
    ),
    box(width: taille-texte * 0.16, height: taille-texte * 0.87, fill: corail, radius: taille-texte * 0.025),
    text(fill: texte)[Racer],
  )
}

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
  // La face arrière est parfaitement verticale quand le nez, lui, plonge
  // jusqu'à toucher la ligne de sol. Cette asymétrie est délibérée : c'est le
  // curseur bloc de l'écran de frappe, la seule allusion au clavier que
  // l'icône se permet à cette taille. Le nez bas et pointu (contre l'ancien
  // à-plat vertical, plus haut) porte seul l'agressivité du profil : bas de
  // caisse et toit restent des lignes droites, la vitesse ne s'écrit qu'au nez.
  line(
    (0.2, 1.0),
    (0.2, 2.6),
    (1.3, 2.6),
    (2.7, 3.5),
    (4.6, 3.6),
    (6.3, 3.1),
    (8.2, 1.8),
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
  rect((-0.3, 2.5), (1.4, 2.85), fill: couleur.darken(22%), stroke: none)

  // Vitre en `nuit` : elle vaut trou dans la carrosserie. Fixe et non dérivée
  // de `couleur`, elle doit rester la couleur du fond quelle que soit la teinte
  // de la voiture.
  line(
    (1.6, 2.7),
    (2.85, 3.3),
    (4.75, 3.35),
    (6.05, 2.5),
    close: true,
    fill: nuit,
    stroke: none,
  )

  // Phare avant, en retrait de la pointe du nez plutôt qu'à son extrémité : une
  // simple extension de la carrosserie ne se lirait pas comme un phare. Le
  // rayon est calé pour couvrir exactement la pointe (aucun `couleur` ne doit
  // dépasser du cercle) sans la noyer — assez grand pour se voir à 48 px, pas
  // au point de dominer la roue.
  circle((9.5, 1.15), radius: 0.5, fill: texte, stroke: none)

  // Roues par-dessus la carrosserie, pas dessous : pas d'arche à découper, et
  // la silhouette gagne deux ancrages francs. Pneu en `sourd` et non en `nuit`,
  // sinon il disparaît dans le fond de l'icône.
  for x in (2.4, 7.5) {
    circle((x, 0.95), radius: 0.95, fill: sourd, stroke: none)
    circle((x, 0.95), radius: 0.36, fill: nuit, stroke: none)
  }
}

/// Rangée de touches vue de dessus, à plat.
///
/// Occupe 10 unités de large — la largeur de `voiture()` — et pend SOUS `y = 0`,
/// pile là où ses roues touchent. Les deux composants partagent donc la même
/// ligne de sol et se superposent sans qu'aucune translation soit à écrire : la
/// voiture roule littéralement sur les touches. C'est la métaphore du jeu, où
/// taper est ce qui la fait avancer.
///
/// Vue de dessus et non de profil : un clavier de profil est une barre plate,
/// illisible à 48 px. À plat, il reste des carrés à fort contraste — et aucune
/// deuxième perspective ne vient contredire la voiture, strictement de profil.
///
/// `touches: 1` donne le capuchon unique dont l'icône « spam » (#115) aura
/// besoin. Il n'y a donc pas de composant `touche()` séparé, et pas de touche
/// mise en avant : #115 dira ce qu'elle veut quand son ADR sera écrit.
#let clavier(couleur: sourd, touches: 5) = {
  import cetz.draw: *

  let ecart = 0.25
  let largeur = (10 - ecart * (touches - 1)) / touches
  let hauteur = 1.4

  for i in range(touches) {
    let x = i * (largeur + ecart)
    // Deux rectangles emboîtés plutôt qu'un seul : le liseré sombre fait lire
    // « capuchon » là où un aplat ferait lire « tuile ». Il reste à plat, aucun
    // relief simulé.
    rect((x, -hauteur), (x + largeur, 0), fill: couleur.darken(30%), stroke: none)
    rect(
      (x + 0.12, -hauteur + 0.12),
      (x + largeur - 0.12, -0.12),
      fill: couleur,
      stroke: none,
    )
  }
}

// Boîte de la scène complète, sur l'axe vertical : du bas des touches au toit
// de la voiture. Sert de référence de cadrage — voir `scene()`.
#let _scene-bas = -1.4
#let _scene-haut = 3.6
#let _scene-centre = (_scene-bas + _scene-haut) / 2

// Alias privés : dans `scene()`, les paramètres `voiture` et `clavier` masquent
// les fonctions du même nom. Les capturer ici est ce qui permet de garder la
// signature lisible (`scene(clavier: false)`) plutôt que de renommer les
// paramètres en `avec-voiture` pour contourner l'ombrage.
#let _voiture = voiture
#let _clavier = clavier

/// Compose voiture et clavier dans un cadrage unique.
///
/// Son travail n'est pas d'empiler deux appels — les composants partagent déjà
/// leur ligne de sol, les empiler ne demanderait aucun code. Ce qu'elle fait,
/// c'est RECENTRER l'élément solitaire sur la boîte de la scène complète : sans
/// ça, « voiture seule » et « les deux » ne se cadrent pas pareil, et les quatre
/// assets à venir (#112 à #115) divergent chacun de son côté.
///
/// Renvoie des éléments de dessin comme les composants qu'elle appelle : une
/// scène reste elle-même composable.
#let scene(voiture: true, clavier: true, couleur: corail) = {
  import cetz.draw: *

  // `group` cantonne la translation : elle ne fuit pas sur ce que l'appelant
  // dessinerait ensuite.
  if voiture {
    group({
      if not clavier { translate((0, _scene-centre - _scene-haut / 2)) }
      _voiture(couleur: couleur)
    })
  }

  if clavier {
    group({
      if not voiture { translate((0, _scene-centre - _scene-bas / 2)) }
      _clavier()
    })
  }
}
