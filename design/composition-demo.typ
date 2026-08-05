// Planche de contrôle du système de composition (issue #108).
//
// Ce n'est PAS un asset Discord : aucune de ces bandes ne part dans le portail
// développeur. C'est la preuve que les trois combinaisons demandées sortent du
// même système de composants et se cadrent à l'identique — ce que seule une
// planche montrant les trois côte à côte peut établir.
//
//   typst compile --format png --ppi 72 composition-demo.typ out/composition-demo.png
//
// 1024 × 1536 pt à 72 PPI = 1024 × 1536 px, trois bandes de 512.

#import "composants.typ": cetz, nuit, scene, sourd

#set page(width: 1024pt, height: 1536pt, margin: 0pt, fill: nuit)
#set text(fill: sourd, size: 30pt)

// `length` est identique pour les trois bandes : c'est la condition pour que la
// comparaison veuille dire quelque chose. Une échelle par bande masquerait
// justement le défaut de cadrage que cette planche doit révéler.
#let bande(titre, contenu) = block(
  width: 1024pt,
  height: 512pt,
  {
    place(top + left, dx: 48pt, dy: 40pt, titre)
    align(center + horizon, cetz.canvas(length: 2.8cm, contenu))
  },
)

#bande("voiture seule", { scene(clavier: false) })
#bande("clavier seul", { scene(voiture: false) })
#bande("les deux", { scene() })
