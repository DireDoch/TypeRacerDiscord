// Issue #113 — image de couverture Discord (Étagère des Activités), 1024 × 576
// (16∶9).
//
// Wordmark logo() à gauche, voiture() seule à droite (via `scene(clavier:
// false)`, recentrée sur la boîte de scène standard) — pas de clavier ici,
// laissé pour un travail ultérieur.
//
// 1024 × 576 pt exportés à 72 PPI donnent exactement 1024 × 576 px.
//
//   typst compile --format png --ppi 72 cover.typ out/cover.png

#import "@preview/cetz:0.3.4"
#import "composants.typ": logo, nuit, scene

#set page(width: 1024pt, height: 576pt, margin: 0pt, fill: nuit)

#grid(
  columns: (1.05fr, 1fr),
  rows: 576pt,
  align(center + horizon)[
    #pad(left: 36pt)[#logo(taille-texte: 2.7cm)]
  ],
  align(center + horizon)[
    #cetz.canvas(length: 1.4cm, { scene(clavier: false) })
  ],
)
