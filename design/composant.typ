// Épreuve 48 × 48 du composant `voiture()` : la taille réelle de l'icône dans
// l'étagère Discord, celle où un détail de trop se brouille. Sert à valider une
// retouche de `composants.typ` à l'échelle où elle compte.
//
//   typst compile --format png --ppi 72 composant.typ out/composant.png
//
// 48 pt à 72 PPI donnent exactement 48 × 48 px (1 pt = 1 px). Le défaut de
// `--ppi` est 144 : l'omettre livre un 96 × 96.
//
// Fond opaque et coins carrés : Discord masque et arrondit lui-même les icônes.
//
// La géométrie et la palette viennent de `composants.typ` — elles ne sont PAS
// recopiées ici. Une épreuve qui redéclare la voiture cesse d'être une épreuve
// le jour où l'une des deux copies est retouchée.

#import "composants.typ": cetz, corail, nuit, voiture

#set page(width: 48pt, height: 48pt, margin: 0pt, fill: nuit)

// `length` est la seule mise à l'échelle : 10 unités × 4.3 pt = 43 pt sur 48,
// la marge restante est ce qui empêche la voiture de toucher le bord une fois
// l'icône masquée en cercle par Discord.
#align(center + horizon)[
  #cetz.canvas(length: 4.3pt, {
    voiture(couleur: corail)
  })
]
