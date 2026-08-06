// Issue #113 — image de couverture Discord (Étagère des Activités), 16:9.
// Signature : le wordmark logo() — "Typpe|Racer", la faute de frappe (2e
// "p" en erreur) et le curseur (accent) portent la marque, à côté de la
// voiture seule (clavier volontairement absent — implémentation à venir,
// voir components.typ : clavier()/compose()).
#import "@preview/cetz:0.3.4": canvas, draw
#import "components.typ": palette, voiture, logo

#set page(width: 18cm, height: 10.125cm, margin: 0cm, fill: palette.bg)

#grid(
  columns: (1.05fr, 1fr),
  align(center + horizon)[
    #pad(left: 0.4cm)[#logo(size: 1.05cm)]
  ],
  box(height: 10.125cm)[
    #align(center + horizon)[
      #canvas(length: 1cm, {
        voiture((-3.6, -1), taille: 3)
      })
    ]
  ],
)
