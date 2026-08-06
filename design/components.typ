// Bibliothèque de composants Typst/cetz pour les assets visuels du projet.
// Style : géométrique/vectoriel, formes pleines, pas d'illustration peinte.
//
// Palette reprise de frontend/src/style.css (--bg, --panel, --text, --sub,
// --main, --error) pour que tous les assets générés restent cohérents avec
// l'identité déjà en place dans l'app.
#import "@preview/cetz:0.3.4": canvas, draw

#let palette = (
  bg: rgb("#12161f"),
  panel: rgb("#1b2230"),
  text: rgb("#e8ecf4"),
  sub: rgb("#96a0b5"),
  main: rgb("#ff7a59"),
  error: rgb("#ff4d6d"),
)

// Composant logo() : wordmark "Typpe|Racer" — la faute de frappe (2e "p" en
// erreur) et le curseur (accent) portent la marque, plutôt qu'une icône à
// côté du nom. `size` = taille de texte Typst (ex: 1.5cm). Retourne du
// contenu Typst (pas un dessin cetz) : à placer directement dans la mise en
// page, à côté ou au-dessus d'un canevas cetz.
#let logo(size: 1.5cm) = {
  set text(font: "JetBrainsMono NF", weight: "bold", size: size)
  stack(
    dir: ltr,
    spacing: size * 0.12,
    stack(
      dir: ltr,
      spacing: 0pt,
      text(fill: palette.text)[Typ],
      text(fill: palette.error)[p],
      text(fill: palette.text)[e],
    ),
    box(width: size * 0.16, height: size * 0.87, fill: palette.main, radius: size * 0.025),
    text(fill: palette.text)[Racer],
  )
}

// Une seule touche de clavier, en keycap stylisé : base (embase, légèrement
// plus grande) + capuchon (décalé vers le haut) pour suggérer le relief d'une
// vraie touche mécanique, toujours en formes pleines (pas de dégradé, pas
// d'ombre portée — la charte reste plate). `large` étire la touche en largeur
// (barre d'espace).
#let cle(pos, taille: 1, couleur: palette.main, fonce: palette.bg, large: 1) = {
  import draw: *
  let (x, y) = pos
  let w = taille * large
  // Embase : légèrement plus large/basse que le capuchon, seule sur les
  // bords pour suggérer l'épaisseur du switch sans ombre portée.
  rect(
    (x - taille * 0.05, y - taille * 0.08), (x + w + taille * 0.05, y + taille * 0.86),
    radius: taille * 0.16,
    fill: fonce,
    stroke: none,
  )
  // Capuchon : occupe l'essentiel de la touche, remonté vers le haut.
  rect(
    (x, y + taille * 0.02), (x + w, y + taille),
    radius: taille * 0.16,
    fill: couleur,
    stroke: none,
  )
  // Creux central du capuchon (léger, ne descend pas jusqu'à l'embase).
  rect(
    (x + w * 0.12, y + taille * 0.22), (x + w - w * 0.12, y + taille * 0.66),
    radius: taille * 0.1,
    fill: fonce,
    stroke: none,
  )
}

// Composant voiture() : profil GT bas et agressif, vu de côté, toujours
// orienté vers la droite (le nez pointu = l'avant). `taille` = hauteur totale
// approximative en unités cetz. Silhouette en un seul polygone plein (style
// arcade/retro-racing, cf. OutRun/Ridge Racer) plutôt qu'un empilement de
// rectangles — capot plongeant, pavillon fluide, aileron arrière discret.
#let voiture(pos, taille: 4, couleur: palette.main, roue: palette.bg, jante: palette.text) = {
  import draw: *
  let (x, y) = pos
  let w = taille * 2.6
  let h = taille * 0.62
  let r-roue = taille * 0.27

  // Silhouette de la carrosserie : parcours unique du bas de caisse arrière
  // jusqu'au nez, en passant par le toit, sans auto-intersection.
  let carrosserie = (
    (0.00, 0.30), (0.00, 0.50), (0.14, 0.68), (0.26, 0.86), (0.42, 0.92),
    (0.56, 0.80), (0.66, 0.60), (0.87, 0.35), (0.92, 0.22), (0.86, 0.11),
    (0.66, 0.06), (0.20, 0.06), (0.10, 0.12),
  ).map(p => (x + w * p.at(0), y + h * p.at(1)))

  // Habitacle (vitre) : quadrilatère suivant la pente du pare-brise, incrusté
  // dans le pavillon.
  let vitre = (
    (0.28, 0.68), (0.34, 0.82), (0.52, 0.76), (0.58, 0.58),
  ).map(p => (x + w * p.at(0), y + h * p.at(1)))

  group({
    line(..carrosserie, close: true, fill: couleur, stroke: none)
    line(..vitre, close: true, fill: roue, stroke: none)
    // Aileron arrière : montant + becquet, en plat (pas de dégradé).
    rect(
      (x + w * 0.05, y + h * 0.66), (x + w * 0.09, y + h * 0.86),
      fill: couleur, stroke: none,
    )
    rect(
      (x - w * 0.01, y + h * 0.84), (x + w * 0.19, y + h * 0.94),
      radius: h * 0.04,
      fill: couleur, stroke: none,
    )
    // Roues
    for cx in (x + w * 0.22, x + w * 0.74) {
      circle((cx, y), radius: r-roue, fill: roue, stroke: none)
      circle((cx, y), radius: r-roue * 0.42, fill: jante, stroke: none)
    }
    // Phare avant — en retrait de la pointe du nez (pas une simple
    // "extension" de la carrosserie), assez large pour que rien ne dépasse.
    circle((x + w * 0.90, y + h * 0.22), radius: h * 0.11, fill: jante, stroke: none)
  })
}

// Composant clavier() : mini clavier vu de dessus, profil de vraies
// rangées décalées (les colonnes ne s'alignent jamais parfaitement d'une
// rangée à l'autre) plutôt qu'une grille générique — volontairement sans
// glyphes sur les touches, donc agnostique à toute disposition précise
// (QWERTY/AZERTY/Colemak...). `accents` : liste de (rangée, colonne) des
// touches en surbrillance — une seule par défaut (frappe), plusieurs pour
// suggérer un martèlement (voir icon-spam.typ). `espace: true` ajoute une
// barre d'espace distincte sous les rangées.
#let clavier(pos, taille: 4, couleur: palette.sub, accent: palette.main, fonce: palette.bg, cols: 5, rows: 3, accents: none, espace: false) = {
  import draw: *
  let (x, y) = pos
  let marge = taille * 0.12
  let cle-taille = (taille - 2 * marge) / cols * 0.82
  let pas-x = (taille - 2 * marge - cle-taille) / (cols - 1)
  let pas-y = pas-x
  let accents = if accents == none { ((rows - 1, int(cols / 2)),) } else { accents }
  // Motif de décalage cyclique par rangée (fractions de pas-x) — pas une
  // disposition de lettres réelle, juste le staggering physique.
  let decalages = (0, 0.55, 0.15, 0.85, 0.35)
  let decalage-max = calc.max(..decalages) * pas-x
  let ligne-largeur = (cols - 1) * pas-x + cle-taille
  let rangee-espace = if espace { pas-y + cle-taille * 0.5 } else { 0 }

  group({
    // Base du clavier — élargie à droite pour absorber le décalage max.
    rect(
      (x, y),
      (x + taille + decalage-max, y + taille * (rows / cols) + marge * 2 + rangee-espace),
      radius: taille * 0.08,
      fill: fonce,
      stroke: none,
    )
    for row in range(rows) {
      let decalage = decalages.at(calc.rem(row, decalages.len())) * pas-x
      for col in range(cols) {
        let est-accent = accents.contains((row, col))
        cle(
          (x + marge + decalage + col * pas-x, y + marge + rangee-espace + row * pas-y),
          taille: cle-taille,
          couleur: if est-accent { accent } else { couleur },
          fonce: fonce,
        )
      }
    }
    if espace {
      let espace-largeur = ligne-largeur * 0.55
      cle(
        (x + marge + (ligne-largeur - espace-largeur) / 2, y + marge),
        taille: cle-taille,
        large: espace-largeur / cle-taille,
        couleur: couleur,
        fonce: fonce,
      )
    }
  })
}

// Traînée de fumée : ronds pleins qui rapetissent et s'estompent vers
// l'arrière, utilisée pour suggérer la vitesse derrière la voiture.
#let trainee-fumee(pos, n: 4, taille: 0.6, espacement: 0.9, couleur: palette.sub) = {
  import draw: *
  let (x, y) = pos
  for i in range(n) {
    let f = 1 - i / n * 0.55
    circle(
      (x - i * espacement, y),
      radius: taille * f * 0.5,
      fill: couleur,
      stroke: none,
    )
  }
}

// Scène "course" : voiture + traînée de fumée + ombre au sol — la
// composition utilisée pour l'icône d'application (#112) et réutilisée pour
// les icônes Rich Presence qui partagent la même idée (course). `sol`
// distingue les variantes (ex: rouge d'alerte pour "floor is lava").
#let scene-course(couleur: palette.main, sol: palette.panel) = {
  import draw: *
  rect(
    (-4.85, -2.15), (4.75, -1.65),
    radius: 0.25,
    fill: sol,
    stroke: none,
  )
  trainee-fumee((-3.35, -1.0), n: 4, taille: 0.5, espacement: 0.4, couleur: palette.sub)
  voiture((-3.25, -1.0), taille: 3, couleur: couleur)
}

// Composition : assemble voiture() et/ou clavier() dans un même canevas
// selon `mode`: "voiture", "clavier", ou "both". Les modes de jeu futurs
// choisissent la combinaison qui les représente le mieux (ex: floor is lava
// → surtout voiture, spam → surtout clavier) sans dupliquer de code Typst.
#let compose(mode: "both", couleur: palette.main, accent: palette.error) = {
  import draw: *
  if mode == "voiture" {
    voiture((-4.6, -1), taille: 3.6, couleur: couleur)
  } else if mode == "clavier" {
    clavier((-2, -1.6), taille: 4, couleur: palette.sub, accent: accent)
  } else {
    clavier((-1.48, -2.3), taille: 3.4, couleur: palette.sub, accent: accent, rows: 2)
    voiture((-3.3, 0.3), taille: 3.2, couleur: couleur)
  }
}
