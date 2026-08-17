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

// Les trois couleurs de la lave (`sol-lave()`, touches martelées de « spam »).
// Seules couleurs du fichier qui ne viennent PAS de `style.css` : aucun écran du
// jeu ne les affiche. Elles existent parce que `rouge` est pris — le réemployer
// pour la lave lui ferait dire « faute » là où il dit « ça brûle ».
//
// Trois et non une : une coulée de lave n'est pas un aplat orange, c'est un
// dégradé du rouge profond au jaune, interrompu par du basalte presque noir.
// C'est ce contraste-là qui la fait reconnaître, pas la teinte moyenne.
#let lave = rgb("#ff2d00") // le rouge en fusion, la masse de la coulée
#let braise = rgb("#ffc21a") // le cœur, là où c'est le plus chaud
#let croute = rgb("#17120f") // basalte refroidi — noir, pas brun

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
  // Pile de repli, et non une seule famille : c'est celle de `--font-mono` dans
  // `style.css`. « JetBrainsMono NF » n'est installée que sur la machine qui a
  // exporté les PNG ; ailleurs Typst retombait sur la SÉRIF par défaut et le
  // wordmark cessait d'être en chasse fixe — c'est-à-dire cessait d'être celui
  // du jeu. Consolas est le repli que le CSS nomme déjà.
  set text(font: ("JetBrainsMono NF", "JetBrains Mono", "Consolas"), weight: "bold", size: taille-texte)
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
/// Occupe environ 10 × 3.7 unités cetz, posée sur `y = 0` : l'appelant place et
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

  let rayon = 0.72 // roues
  let sol = rayon * 0.62 // le bas de caisse s'arrête là, les roues débordent
  let ombre = couleur.darken(22%)
  let ceinture = 2.18 // hauteur du coffre ET du capot — voir plus bas

  // Carrosserie : UNE seule silhouette fermée plutôt qu'un assemblage de
  // rectangles. À 48 px dans l'étagère Discord, il ne reste que le contour —
  // un contour unique y survit, une pile de formes s'y brouille.
  //
  // Coffre et capot sont à la MÊME hauteur (`ceinture`) : l'arrière surélevé
  // d'avant faisait lire un hayon de break, pas un coupé de course, et cette
  // bosse ne portait rien — c'est le toit qui donne la silhouette. Une seule
  // ligne de ceinture horizontale de bout en bout laisse le pavillon être le
  // seul accident du profil.
  //
  // Le nez reste BISEAUTÉ — son bas (9.50) rentre sous son haut (9.89) : c'est
  // ce biseau qui fait lire un avant de voiture, un nez tranché à la verticale
  // se lisait comme une silhouette coupée au bord du cadre.
  line(
    (0.33, sol),
    (0.33, ceinture),
    (1.50, ceinture + 0.02),
    (2.85, 3.55),
    (5.15, 3.62),
    (6.95, 2.95),
    (8.85, ceinture),
    (9.69, 2.00),
    (9.89, 1.39),
    (9.50, sol),
    close: true,
    fill: couleur,
    stroke: none,
  )

  // Bas de caisse assombri : la seule profondeur que s'autorise un style plat.
  // Dérivé de `couleur`, donc une voiture repeinte reste cohérente. Il
  // s'arrête avant le nez (9.58) pour ne pas ressortir de son biseau.
  rect((0.33, sol), (9.58, sol + 0.38), fill: ombre, stroke: none)

  // Aileron, débordant à l'arrière — le repère « voiture de course » le moins
  // cher en formes. Bord haut calé sur la ceinture (au lieu d'un décalage) :
  // la lame se lit comme un prolongement de la silhouette, pas comme un bloc
  // posé à côté.
  rect((-0.22, ceinture - 0.24), (1.22, ceinture + 0.02), fill: ombre, stroke: none)

  // Vitre en `nuit` : elle vaut trou dans la carrosserie. Fixe et non dérivée
  // de `couleur`, elle doit rester la couleur du fond quelle que soit la teinte
  // de la voiture. Marge ~0.46 sous le toit (contre ~0.25 avant) : ce pavillon
  // épais est ce qui reste lisible à 48 px, où un liseré fin se refermait sur
  // lui-même et la vitre venait mordre le bord du toit.
  line(
    (2.15, 2.40),
    (3.15, 3.10),
    (4.95, 3.15),
    (6.30, 2.66),
    close: true,
    fill: nuit,
    stroke: none,
  )

  // Phare avant, en retrait de la pointe du nez plutôt qu'à son extrémité : une
  // simple extension de la carrosserie ne se lirait pas comme un phare.
  circle((9.11, 1.98), radius: 0.24, fill: texte, stroke: none)

  // Roues par-dessus la carrosserie, pas dessous : pas d'arche à découper, et
  // la silhouette gagne deux ancrages francs. Pneu en `sourd` et non en `nuit`,
  // sinon il disparaît dans le fond de l'icône. Le halo en `nuit` mord sur la
  // carrosserie et y creuse l'espace entre roue et aile, qu'un simple cercle
  // plaqué dessus ne peut pas donner. Trois disques et non quatre : la jante
  // intermédiaire se refermait sur le moyeu à 48 px, elle n'ajoutait qu'un
  // cerne trouble.
  for x in (2.56, 7.61) {
    circle((x, rayon), radius: rayon + 0.16, fill: nuit, stroke: none)
    circle((x, rayon), radius: rayon, fill: sourd, stroke: none)
    circle((x, rayon), radius: rayon * 0.34, fill: nuit, stroke: none)
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
/// `touches: 1` donne le capuchon unique dont une icône de mode pourrait avoir
/// besoin. Il n'y a donc pas de composant `touche()` séparé.
///
/// `accents` liste les indices des touches enfoncées, peintes en `accent` : de
/// quoi montrer la frappe elle-même (icône « spam », #115) sans dupliquer le
/// composant. Vide par défaut — un clavier au repos reste un clavier au repos.
#let clavier(couleur: sourd, touches: 5, accent: braise, accents: (), debord: 0) = {
  import cetz.draw: *

  let ecart = 0.25
  let largeur = (10 - ecart * (touches - 1)) / touches
  let hauteur = 1.4

  // UNE dalle continue, et les capuchons creusés dedans. Cinq blocs détachés se
  // lisaient comme cinq tuiles flottant dans le vide : ce que la voiture doit
  // toucher est un SOL, la même bande pleine que `sol-lave()` occupe dans les
  // modes où la piste a fondu. `debord` la prolonge de part et d'autre des 10
  // unités pour qu'elle sorte du cadre — un sol qui s'arrête net à deux doigts
  // du bord se lit comme une estrade, pas comme une route.
  rect((-debord, -hauteur), (10 + debord, 0), fill: couleur.darken(30%), stroke: none)

  for i in range(touches) {
    let x = i * (largeur + ecart)
    let frappee = accents.contains(i)
    let teinte = if frappee { accent } else { couleur }
    // Une touche enfoncée s'enfonce vraiment : son capuchon perd 0.22 en haut.
    // C'est le seul mouvement du composant, et il se lit encore à 48 px.
    rect(
      (x + 0.12, -hauteur + 0.12),
      (x + largeur - 0.12, if frappee { -0.34 } else { -0.12 }),
      fill: teinte,
      stroke: none,
    )
    // Éclats d'impact au-dessus de la touche enfoncée. Sans eux, une touche
    // colorée ne dit que « touche colorée » : c'est le jaillissement qui dit
    // qu'on vient de FRAPPER dessus, ce que le mode « spam » raconte.
    if frappee {
      // Triangles et non traits : l'épaisseur d'un `stroke` se donne en pt
      // absolus, elle ne suivrait pas le `length` du canvas — un éclat correct
      // sur l'icône 1024 disparaîtrait sur l'épreuve 48 px.
      let c = x + largeur / 2
      for (dx, h) in ((-0.42, 0.34), (0, 0.50), (0.42, 0.34)) {
        line(
          (c + dx - 0.09, 0.14),
          (c + dx + 0.09, 0.14),
          (c + dx * 1.3, 0.14 + h),
          close: true,
          fill: accent,
          stroke: none,
        )
      }
    }
  }
}

// Générateur pseudo-aléatoire déterministe (LCG classique). Typst n'en fournit
// pas, et il en faut un ici : une croûte de basalte dessinée avec des valeurs
// régulières se lit comme un carrelage. Déterministe et non tiré à chaque
// compilation — deux `build.sh` doivent produire le MÊME PNG, sans quoi chaque
// rebuild salit le diff des images commitées.
#let _hasard(n, graine: 1) = {
  let x = graine
  let sortie = ()
  for _ in range(n) {
    x = calc.rem(x * 1103515245 + 12345, 2147483648)
    sortie.push(x / 2147483648)
  }
  sortie
}

/// Sol de lave, à la place du clavier : même bande (10 de large, `hauteur` sous
/// la ligne de sol `y = 0`). `voiture()` se pose dessus sans aucune translation,
/// exactement comme sur `clavier()` — c'est ce que le mode raconte, la piste a
/// été remplacée.
///
/// Trois couches, et c'est leur contraste qui fait lire « lave » : le bain
/// chaud, les plaques de croûte refroidie qui flottent dessus, les bulles qui
/// crèvent la surface. Un aplat orange seul se lirait « barre orange ».
/// Le `graine` change le tirage de la croûte sans toucher au reste : de quoi
/// re-tirer un motif qui tombe mal, sans rien redessiner à la main.
#let sol-lave(hauteur: 1.4, graine: 12, debord: 0) = {
  import cetz.draw: *

  // Taille indexée sur `debord` : plus la bande est large, plus elle mange de
  // tirages. Un tableau à taille fixe suffisait pour le débord d'aujourd'hui et
  // planterait au premier qui l'augmente.
  let alea = _hasard(160 + int(debord * 60), graine: graine)
  let k = 0
  let gauche = -debord
  let droite = 10 + debord

  // 1. Le bain. Dégradé vertical : jaune à la surface, rouge en dessous,
  //    presque noir au fond. Un aplat orange se lirait « barre » — c'est
  //    l'étagement des chaleurs qui fait lire une matière en fusion.
  rect(
    (gauche, -hauteur),
    (droite, 0),
    fill: gradient.linear(braise, lave, lave.darken(52%), angle: 90deg),
    stroke: none,
  )

  // 2. Les plaques de basalte : LE motif noir. Largeur, nombre de dents,
  //    hauteur de chaque dent et largeur de la fissure suivante, tout est tiré
  //    du PRNG. Un bord haut régulier se lirait « carrelage », et c'est
  //    l'irrégularité seule qui fait passer ces polygones pour de la roche.
  //    Elles s'arrêtent SOUS la surface : la lave nue qui reste au-dessus est
  //    la fissure incandescente entre deux plaques.
  let bord = gauche
  while bord < droite {
    let l = calc.min(0.85 + alea.at(k) * 1.75, droite - bord)
    k += 1
    let dents = 3 + int(alea.at(k) * 4)
    k += 1
    let sommets = ((bord, -hauteur),)
    for j in range(dents + 1) {
      // Certaines dents dépassent la surface (y > 0) : sans ça, la lave
      // laissait un liseré jaune rectiligne sur toute la largeur, en haut du
      // bain — une règle tracée, pas une coulée.
      sommets.push((bord + l * j / dents, 0.07 - alea.at(k) * 0.85))
      k += 1
    }
    sommets.push((bord + l, -hauteur))
    line(..sommets, close: true, fill: croute, stroke: none)
    bord += l + 0.18 + alea.at(k) * 0.46
    k += 1
  }

  // 3. Blocs détachés qui flottent au milieu des fissures. Ils existent pour
  //    casser l'alternance plaque/fissure : sans eux l'œil retrouve une grille
  //    sous le hasard des bords. Petits, sinon ils rebouchent la lumière.
  for _ in range(8 + int(debord * 2)) {
    let cx = gauche + 0.2 + alea.at(k) * (droite - gauche - 0.4)
    k += 1
    let cy = -0.22 - alea.at(k) * 0.8
    k += 1
    let r = 0.12 + alea.at(k) * 0.2
    k += 1
    let sommets = ()
    for j in range(6) {
      let angle = j / 6 * 360deg
      let d = r * (0.55 + alea.at(k) * 0.8)
      k += 1
      // Aplati sur y (× 0.65) : des blocs ronds se liraient comme des bulles
      // noires, alors qu'ils sont la même roche que les plaques.
      sommets.push((cx + d * calc.cos(angle), cy + d * calc.sin(angle) * 0.65))
    }
    line(..sommets, close: true, fill: croute, stroke: none)
  }

  // 4. Bulles : les grosses crèvent la surface, les petites montent. Ce
  //    mouvement vers le haut est ce qui distingue la lave d'un sol simplement
  //    chaud. Le cœur en `braise` est ce qui les fait paraître incandescentes
  //    plutôt que peintes.
  for (bx, by, r) in (
    (0.95, 0.14, 0.34),
    (4.30, 0.09, 0.25),
    (5.70, 0.60, 0.19),
    (9.20, 0.22, 0.30),
    (3.95, 0.98, 0.12),
    (6.45, 0.28, 0.15),
    (2.10, 0.72, 0.11),
  ) {
    circle((bx, by), radius: r, fill: lave, stroke: none)
    circle((bx - r * 0.24, by + r * 0.26), radius: r * 0.42, fill: braise, stroke: none)
  }
}

/// Traînées de vitesse derrière la voiture — la course en mouvement (icône
/// « race »). Dessinées en x NÉGATIF, donc hors de la boîte 0–10 : elles
/// débordent volontairement derrière l'arrière du véhicule.
#let vitesse(couleur: corail) = {
  import cetz.draw: *

  for (y, x0, x1, e) in (
    (2.55, -3.10, -0.55, 0.20),
    (1.70, -2.35, -0.60, 0.16),
    (3.25, -2.20, -0.80, 0.14),
  ) {
    rect((x0, y), (x1, y + e), fill: couleur, stroke: none)
  }
}

/// Feux de départ, au-dessus de la scène : l'attente avant le top (icône
/// « lobby »). `allumes` compte les feux déjà passés au corail, de gauche à
/// droite — 1 sur 3 dit « ça n'a pas encore commencé », ce qu'est un salon.
#let feux(allumes: 1) = {
  import cetz.draw: *

  for i in range(3) {
    circle(
      (3.8 + i * 1.2, 4.45),
      radius: 0.34,
      // Feu éteint en `panel` éclairci : `panel` brut vaut à peine plus que
      // `nuit`, les deux feux restants disparaissaient et on ne lisait plus
      // « un sur trois » mais « un point ».
      fill: if i < allumes { corail } else { panel.lighten(45%) },
      stroke: none,
    )
  }
}

// Boîte de la scène complète, sur l'axe vertical : du bas des touches au toit
// de la voiture. Sert de référence de cadrage — voir `scene()`.
#let _scene-bas = -1.4
#let _scene-haut = 3.62
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
/// `sol` peint la dalle. C'est le SEUL contraste qui survive à 96 px, la taille
/// réelle du grand visuel dans le pop-out de profil (#171) : un petit ajout posé
/// à côté de la voiture y tient dans 3 px, une dalle qui change de couleur se
/// voit de loin. C'est ce qui sépare `lobby` (éteinte) de `race` (éclairée) —
/// les feux et les traînées ne sont plus que le second détail, lu en grand.
#let scene(voiture: true, clavier: true, couleur: corail, sol: sourd, debord: 0) = {
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
      _clavier(couleur: sol, debord: debord)
    })
  }
}
