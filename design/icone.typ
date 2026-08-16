// Issue #115 — les six grands visuels Rich Presence, dans UN fichier.
//
// Un fichier par asset ailleurs dans ce dossier, mais pas ici : ces six-là ne
// diffèrent que par une ligne de composition chacun. Six `.typ` de neuf lignes
// répétant la même page et le même `align` seraient six endroits où corriger le
// jour où le cadrage change. L'état voulu arrive par `--input` :
//
//   typst compile --format png --ppi 72 --input etat=race icone.typ out/race.png
//
// Le NOM DU FICHIER DE SORTIE est la clé d'asset côté Discord : le portail
// nomme l'asset d'après le fichier téléversé, et `frontend/src/discord.ts`
// (`ACTIVITY_PRESETS`) envoie exactement ces clés — `menu`, `practice`,
// `lobby`, `race`, `floor-is-lava`, `spam`. Renommer un PNG casse la Rich
// Presence de l'état correspondant, en silence : Discord retombe sur l'image
// par défaut sans rien signaler. `build.sh` tient la correspondance.
//
// 1024 pt à 72 PPI = 1024 px. Le petit visuel de la Rich Presence est
// `app-icon` (voir `app-icon.typ`), il n'est pas dans cette liste.

#import "composants.typ": cetz, clavier, corail, feux, logo, nuit, scene, sol-lave, vitesse, voiture

#let etat = sys.inputs.at("etat", default: "race")

#set page(width: 1024pt, height: 1024pt, margin: 0pt, fill: nuit)

// Chaque état : le même système de composants, un seul ajout qui dit l'état.
// C'est cet ajout unique — feux, traînées, lave, touches enfoncées — qui les
// distingue à la taille où Discord les affiche ; deux ajouts par icône et il
// n'en reste qu'une bouillie.
// Le sol traverse le cadre de bord à bord : `debord` prolonge la dalle (ou le
// bain de lave) au-delà des 10 unités de la scène, `place` laisse ce
// dépassement sortir de la page — que Typst rogne — au lieu de le compter dans
// la mise en page et de rétrécir la voiture pour le faire rentrer. Un `align`
// ferait exactement l'inverse. La valeur est large exprès : elle doit dépasser
// pour tous les `length` ci-dessous, et ce qui dépasse ne coûte rien.
#let DEBORD = 2.6

#let visuels = (
  // Menu : le seul à porter le wordmark. Les cinq autres sont icon-only (#115),
  // un mot ne survit pas à la réduction de la Rich Presence quand il partage la
  // place avec une scène — ici il l'a pour lui.
  menu: place(
    center + horizon,
    stack(
      dir: ttb,
      spacing: 1.5cm,
      align(center)[#logo(taille-texte: 2.4cm)],
      cetz.canvas(length: 2.5cm, { scene(debord: DEBORD) }),
    ),
  ),

  // Practice : voiture seule, sans le clavier de la course. `scene()` la
  // recentre sur la boîte de la scène complète, donc elle se cadre comme les
  // autres au lieu de flotter plus haut.
  // Seule icône sans sol, donc seule à rester en `align` : rien n'y déborde.
  practice: align(center + horizon)[
    #cetz.canvas(length: 2.9cm, { scene(clavier: false) })
  ],

  // Lobby : la scène au repos sous les feux de départ. Un seul feu allumé —
  // c'est l'attente qui définit un salon, pas le départ.
  lobby: place(
    center + horizon,
    cetz.canvas(length: 2.6cm, {
      scene(debord: DEBORD)
      feux(allumes: 1)
    }),
  ),

  // Race : la même scène, lancée. Les traînées débordent derrière l'arrière du
  // véhicule (x négatif), d'où un `length` plus court : la boîte est plus large.
  race: place(
    center + horizon,
    cetz.canvas(length: 2.5cm, {
      scene(debord: DEBORD)
      vitesse()
    }),
  ),

  // Floor is lava : la piste a été remplacée par la lave, et la voiture est en
  // l'air — c'est de ne PAS toucher le sol que parle le mode. Le décollage
  // dégage aussi l'espace où les bulles se voient, sous la caisse.
  "floor-is-lava": place(
    center + horizon,
    cetz.canvas(length: 2.7cm, {
      import cetz.draw: *
      sol-lave(debord: DEBORD)
      group({
        translate((0, 1.05))
        voiture()
      })
    }),
  ),

  // Spam : le clavier martelé. Trois touches enfoncées et brûlantes, en quinconce
  // — trois d'affilée se liraient comme une seule barre. La voiture décolle de
  // sa ligne de sol : posée dessus, elle écrasait les éclats d'impact contre son
  // bas de caisse, et c'est justement ce jaillissement qui dit « spam ».
  spam: place(
    center + horizon,
    cetz.canvas(length: 2.7cm, {
      import cetz.draw: *
      clavier(accents: (0, 2, 4), debord: DEBORD)
      group({
        translate((0, 0.95))
        voiture()
      })
    }),
  ),
)

#if etat not in visuels {
  panic("état inconnu : " + etat + " — attendus : " + visuels.keys().join(", "))
}

#visuels.at(etat)
