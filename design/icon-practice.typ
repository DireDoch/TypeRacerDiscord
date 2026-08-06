// Issue #115 — icône Rich Presence, état "Practice". Voiture seule
// (compose(mode: "voiture")), sans l'urgence de la traînée de vitesse
// (réservée à Race/Floor is lava). Clavier volontairement absent —
// implémentation à venir, voir components.typ : clavier()/compose().
// Nom de clé provisoire (asset key exacte à aligner sur #111 une fois câblé).
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, compose

#set page(width: 10cm, height: 10cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    compose(mode: "voiture")
  })
]
