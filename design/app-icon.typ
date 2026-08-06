// Issue #112 — icône d'application Discord finale, 1024 × 1024.
//
// Uniquement le wordmark logo() : à 48 px dans l'étagère Discord, une scène
// voiture + clavier ne resterait qu'une tache orange illisible, quand le
// wordmark reste lisible bien plus petit qu'une icône d'app ne l'est jamais
// affichée. Changement définitif — pas de scène ici.
//
// 1024 pt de page exportés à 72 PPI donnent exactement 1024 × 1024 px (1 pt =
// 1 px à 72 PPI). Le défaut de `--ppi` est 144 : l'omettre livre un 2048 ×
// 2048.
//
//   typst compile --format png --ppi 72 app-icon.typ out/app-icon.png
//
// Fond opaque et coins carrés : Discord masque et arrondit lui-même l'icône.

#import "composants.typ": logo, nuit

#set page(width: 1024pt, height: 1024pt, margin: 0pt, fill: nuit)

#align(center + horizon)[#logo(taille-texte: 5.1cm)]
