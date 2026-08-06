// Issue #115 — icône Rich Presence, état "Floor is lava". Dérive surtout de
// voiture() (survie/élimination en course, ADR mode floor-is-lava) : même
// scène que Race, sol recoloré en rouge d'alerte (palette.error) pour
// signaler le danger sans changer la silhouette de la voiture.
// Nom de clé provisoire (asset key exacte à aligner sur #111 une fois câblé).
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, scene-course

#set page(width: 10cm, height: 10cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    scene-course(sol: palette.error)
  })
]
