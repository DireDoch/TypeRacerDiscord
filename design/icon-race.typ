// Issue #115 — icône Rich Presence, état "Race". Même scène que l'icône
// d'application (#112) : c'est le mode central du jeu.
// Nom de clé provisoire (asset key exacte à aligner sur #111 une fois câblé).
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, scene-course

#set page(width: 10cm, height: 10cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    scene-course()
  })
]
