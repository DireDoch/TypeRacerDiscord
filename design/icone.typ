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

#import "composants.typ": cetz, clavier, feux, nuit, scene, sol-lave, sourd, texte, voiture

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

// UN seul `length` pour les six. La voiture fait 10.1 unités de large : à 3.3 cm
// elle occupe 92 % des 1024 px, contre 73 % avant (#171 — « ~28 % du carré est
// vide »). C'est du zoom gratuit, rien n'est redessiné.
//
// Partagé et non réglé état par état : six valeurs, c'était six cadrages à
// re-régler au premier composant qui bouge, et chacune tirée vers le bas par
// l'élément le plus large de SON état — c'est comme ça que `race` était le plus
// petit des six pour loger des traînées illisibles à 96 px.
#let LONGUEUR = 3.3cm

#let visuels = (
  // Menu : la scène nue, au repos, dalle neutre — c'est l'état par défaut, et
  // c'est de ne RIEN ajouter qu'il se reconnaît.
  //
  // Le wordmark n'y est plus (#171) : à 96 px il faisait 4 px de haut, une
  // bouillie grise où le rouge du 2ᵉ « p » — la faute de frappe, tout le propos
  // du logo — disparaissait entièrement. Ce fichier écrivait lui-même qu'« un
  // mot ne survit pas à la réduction de la Rich Presence » et le mettait quand
  // même. Le wordmark garde ses deux emplois où il est lu en grand :
  // `app-icon.typ` et `cover.typ`.
  menu: place(
    center + horizon,
    cetz.canvas(length: LONGUEUR, { scene(debord: DEBORD) }),
  ),

  // Practice : voiture seule, sans le clavier de la course. `scene()` la
  // recentre sur la boîte de la scène complète, donc elle se cadre comme les
  // autres au lieu de flotter plus haut.
  // Seule icône sans sol, donc seule à rester en `align` : rien n'y déborde.
  practice: align(center + horizon)[
    #cetz.canvas(length: LONGUEUR, { scene(clavier: false) })
  ],

  // Lobby : la scène au repos sous les feux de départ. Un seul feu allumé —
  // c'est l'attente qui définit un salon, pas le départ.
  // Dalle ÉTEINTE (#171) : le feu unique fait 3 px à 96 px, il ne peut pas
  // porter la distinction tout seul. La piste sombre, elle, se lit de loin.
  lobby: place(
    center + horizon,
    cetz.canvas(length: LONGUEUR, {
      scene(sol: sourd.darken(45%), debord: DEBORD)
      feux(allumes: 1)
    }),
  ),

  // Race : la même scène, lancée. Dalle ÉCLAIRÉE (#171), pendant exact du sol
  // éteint du lobby : c'est la piste qui dit « ça court ». `texte` et pas
  // `braise` — un sol jaune se confondrait avec la lave et avec les touches
  // martelées du spam à cette taille.
  //
  // `vitesse()` retiré : les traînées partent 3 unités DERRIÈRE la voiture,
  // c'est-à-dire qu'elles élargissaient la boîte d'un tiers et payaient le
  // cadrage des six (voir `LONGUEUR`) pour trois traits de 3 px que #171 a
  // justement constatés illisibles. Le composant reste, `background.typ`
  // l'affiche en grand, là où il se lit.
  race: place(
    center + horizon,
    cetz.canvas(length: LONGUEUR, { scene(sol: texte, debord: DEBORD) }),
  ),

  // Floor is lava : la piste a été remplacée par la lave, et la voiture est en
  // l'air — c'est de ne PAS toucher le sol que parle le mode. Le décollage
  // dégage aussi l'espace où les bulles se voient, sous la caisse.
  "floor-is-lava": place(
    center + horizon,
    cetz.canvas(length: LONGUEUR, {
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
    cetz.canvas(length: LONGUEUR, {
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
