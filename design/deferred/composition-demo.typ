// Démo #108 : les 3 combinaisons possibles de compose() — voiture seule,
// clavier seul, les deux — pour valider le système de composition.
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, compose

#set page(width: 30cm, height: 10cm, margin: 0cm, fill: palette.bg)

#grid(
  columns: (1fr, 1fr, 1fr),
  ..(
    ("voiture", "clavier", "both").map(mode => align(center + horizon)[
      #canvas(length: 1cm, {
        compose(mode: mode)
      })
    ])
  )
)
