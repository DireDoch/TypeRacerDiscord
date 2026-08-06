// Issue #115 — icône Rich Presence, état "Spam". Dérive surtout de
// clavier() (des touches martelées) : plusieurs touches en surbrillance au
// lieu d'une seule, pour suggérer la frappe répétée/désordonnée.
// Nom de clé provisoire (asset key exacte à aligner sur #111 une fois câblé).
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, clavier

#set page(width: 10cm, height: 10cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    clavier(
      (-2.6, -2.1),
      taille: 5.2,
      couleur: palette.sub,
      accent: palette.error,
      accents: ((0, 1), (1, 3), (2, 0), (2, 4), (1, 1)),
    )
  })
]
