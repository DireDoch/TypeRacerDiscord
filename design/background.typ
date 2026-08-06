// Issue #114 — overlay d'arrière-plan pour l'affichage en grille Discord.
// L'art reste groupé sur les bords ; le centre (où l'UI Discord se pose)
// reste dégagé. Clavier volontairement absent — implémentation à venir,
// voir components.typ : clavier()/compose().
#import "@preview/cetz:0.3.4": canvas, draw
#import "components.typ": palette, voiture, trainee-fumee

#set page(width: 18cm, height: 10.125cm, margin: 0cm, fill: palette.bg)

#align(center + horizon)[
  #canvas(length: 1cm, {
    import draw: *

    // Ligne de piste : cadre bas, discret, en accent.
    rect((-9, -5.05), (9, -4.85), fill: palette.main, stroke: none)

    // Voiture, coin bas-gauche, posée sur la piste, traînée de fumée
    // derrière elle.
    trainee-fumee((-8.7, -4.6), n: 4, taille: 0.4, espacement: 0.35)
    voiture((-8.4, -4.85), taille: 2.4, couleur: palette.main)
  })
]
