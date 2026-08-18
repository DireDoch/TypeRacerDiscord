// =============================================================================
//  Gabarit de capture — un PNG d'attente, aux dimensions de la vraie capture.
//
//  Les dix-huit captures du document ne sont pas encore prises. Plutôt que de
//  laisser des cadres vides dans `documentation.typ`, chaque capture a ici un
//  fichier au bon format : le document intègre de VRAIES images, la mise en
//  page est déjà celle de la version finale, et prendre une capture se réduit à
//  écraser un fichier — aucune ligne de Typst à retoucher.
//
//  Régénérer : ./build.sh
//
//  Ces images ne prétendent à rien : elles portent en toutes lettres qu'elles
//  sont des gabarits. Un placeholder qui ressemble à une capture serait pire
//  qu'un cadre vide.
// =============================================================================

#import "../../design/composants.typ": nuit, panel, corail, texte, sourd

#let nom = sys.inputs.at("nom")
#let sujet = sys.inputs.at("sujet")
#let largeur = float(sys.inputs.at("l"))
#let hauteur = float(sys.inputs.at("h"))

#set page(width: largeur * 1pt, height: hauteur * 1pt, margin: 0pt, fill: nuit)
#set text(font: ("JetBrainsMono NF", "Hack"), fill: texte)

#place(top + left, dx: 0pt, dy: 0pt, rect(
  width: 100%,
  height: 100%,
  fill: none,
  stroke: (paint: panel.lighten(12%), thickness: 2pt, dash: "dashed"),
))

#align(center + horizon)[
  #text(size: 13pt, weight: 700, fill: corail, tracking: 0.22em)[CAPTURE À PRENDRE]
  #v(1.1em)
  #text(size: 22pt, weight: 700, fill: texte)[#(nom + ".png")]
  #v(0.7em)
  #block(width: 72%)[
    #set par(justify: false, leading: 0.75em)
    #text(size: 12pt, fill: sourd)[#sujet]
  ]
  #v(1.4em)
  #text(size: 9pt, fill: sourd.darken(18%))[
    gabarit — écraser ce fichier par la vraie capture, rien d'autre à changer
  ]
]
