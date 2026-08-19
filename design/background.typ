// Issue #114 — overlay d'arrière-plan de l'affichage en grille Discord,
// 1024 × 576 (16∶9).
//
//   typst compile --format png --ppi 72 background.typ out/background.png
//
// LE CENTRE DOIT RESTER VIDE : c'est là que Discord pose sa propre UI. Tout
// l'art est donc poussé sur les bords — bande de clavier collée au bas du
// cadre, voiture posée dessus à gauche, wordmark dans le coin haut gauche. Un
// visuel centré comme `cover.typ` passerait sous les libellés de Discord.
//
// Deux `canvas()` placés plutôt qu'un seul : la bande de touches court sur
// toute la largeur (unité 3.61 cm) quand la voiture reste petite (1.2 cm), et
// une seule échelle ne peut pas faire les deux. Leurs positions sont calées
// pour que les roues touchent le haut des touches — la même ligne de sol que
// partout ailleurs, à la main ici faute d'échelle commune.

#import "composants.typ": cetz, clavier, logo, nuit, vitesse, voiture

#set page(width: 1024pt, height: 576pt, margin: 0pt, fill: nuit)

// 10 unités × 3.61 cm = 36.1 cm = 1024 pt : la bande fait exactement la largeur
// de la page. Sa hauteur vaut 1.4 × 3.61 cm ≈ 143 pt — d'où le `dy` de la
// voiture juste en dessous.
#place(bottom + left, cetz.canvas(length: 3.61cm, { clavier() }))

#place(
  bottom + left,
  dx: 96pt,
  dy: -143pt,
  cetz.canvas(length: 1.2cm, {
    vitesse()
    voiture()
  }),
)

#place(top + left, dx: 56pt, dy: 44pt, logo(taille-texte: 1.4cm))
