// Tranche mince du pipeline (issue #106) : le composant `voiture()` exporté au
// format carré des icônes Discord.
//
// 1024 pt de page exportés à 72 PPI donnent exactement 1024 × 1024 px — à cette
// résolution 1 pt vaut 1 px, il n'y a aucun PPI à calculer. Attention, le défaut
// de `--ppi` est 144 : l'omettre livre un 2048 × 2048.
//
//   typst compile --format png --ppi 72 voiture-1024.typ out/voiture-1024.png
//
// Fond opaque et coins carrés : Discord masque et arrondit lui-même les icônes.
// Les arrondir ici les doublerait, et une transparence laisserait passer le fond
// de l'étagère sous une voiture pensée pour du bleu de nuit.

#import "composants.typ": cetz, corail, nuit, voiture

#set page(width: 1024pt, height: 1024pt, margin: 0pt, fill: nuit)

// `length` fixe l'unité cetz : 10 unités de large × 2.9 cm ≈ 29 cm sur une page
// de 36.1 cm, soit ~80 % de la largeur. La marge restante est ce qui empêche la
// voiture de toucher le bord une fois l'icône masquée en cercle par Discord.
#align(center + horizon)[
  #cetz.canvas(length: 2.9cm, {
    voiture(couleur: corail)
  })
]
