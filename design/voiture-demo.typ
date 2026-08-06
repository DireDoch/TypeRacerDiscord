// Démo #106 : preuve que la chaîne Typst → composant vectoriel → PNG
// aux dimensions Discord fonctionne. Export carré, fond uni.
#import "@preview/cetz:0.3.4": canvas
#import "components.typ": palette, voiture

#set page(width: 10cm, height: 10cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    voiture((-4.94, -0.9), taille: 3.8)
  })
]
