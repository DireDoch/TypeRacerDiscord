// =============================================================================
//  Documentation technique de TypeRacerDiscord (issue #217).
//
//  A remplacé Docs/onboarding.typ (supprimé), dont le périmètre (« guide de
//  démarrage contributeur ») était trop étroit et le contenu avait dérivé du
//  code. Git en garde l'historique.
//
//  Les polices sont choisies parmi celles RÉELLEMENT installées — voir le bloc
//  Thème. Une police absente ne casse pas la compilation : Typst retombe en
//  silence sur sa sérif par défaut, et tout le document change de visage sans
//  que rien ne le signale. Vérifier avec `typst fonts` avant d'en changer.
//
//  Compilation — À LA MAIN, le PDF est committé. Aucun job CI ne le refait :
//  les paquets @preview exigent le réseau au premier build.
//
//    env SOURCE_DATE_EPOCH=0 \
//      typst compile --root . Docs/documentation.typ Docs/documentation.pdf
//
//  `--root .` n'est PAS décoratif : le document importe `design/composants.typ`
//  et les PNG de `design/out/`, qui sont hors du dossier `Docs/`. Sans lui,
//  Typst refuse de sortir du dossier du fichier d'entrée.
//
//  `SOURCE_DATE_EPOCH` ne l'est pas non plus. Sans lui, Typst horodate le PDF à
//  l'instant de la compilation : le fichier committé change à CHAQUE build,
//  même quand pas une ligne n'a bougé, et le diff d'un binaire de 700 Ko ne
//  s'inspecte pas. Avec, deux compilations de la même source donnent le même
//  fichier au bit près — vérifiable par `cmp`. Même raison que le `--ppi 72`
//  déterministe de `design/build.sh` : un asset committé doit être une
//  fonction de sa source, pas de l'heure qu'il est.
//  (`env VAR=… cmd` et pas `VAR=… cmd` : le shell du projet est fish.)
//
//  Ce document ne recopie AUCUN bloc de CONTEXT.md, Docs/API.md ou README.md :
//  il condense ou il renvoie, jamais les deux — deux copies d'un même
//  paragraphe divergent à la première retouche.
// =============================================================================

#import "../design/composants.typ": logo, nuit, panel, corail, texte, sourd, rouge
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
#import "@preview/chronos:0.2.1"

// -----------------------------------------------------------------------------
//  Thème
//
//  Une seule règle : les couleurs viennent de `design/composants.typ`, qui les
//  tient lui-même de `frontend/src/style.css`. Aucun hex n'est écrit ici — les
//  variantes sont DÉRIVÉES, pour qu'une retouche de la palette du jeu se
//  propage jusqu'au PDF sans qu'on ait à la retrouver.
//
//  La palette du jeu est pensée pour un écran noir. Le corps de ce document est
//  imprimable, donc inversé : encre `nuit` sur papier blanc, `corail` réservé
//  aux accents (filets, numéros, étiquettes). `corail` pur sur blanc ne passe
//  pas 3:1 — d'où `accent-encre`, sa version assombrie, partout où il porte du
//  texte à lire.
// -----------------------------------------------------------------------------

#let encre = nuit
#let gris = sourd.darken(38%) // texte secondaire, lisible sur blanc
#let filet = sourd.lighten(45%) // règles, bordures
#let accent = corail // filets et aplats seulement
#let accent-encre = corail.darken(30%) // dès que l'accent porte du texte
#let papier-doux = nuit.lighten(96%) // fonds de bloc, teintés du bleu du jeu

// Les polices du jeu (`Inter`, `JetBrains Mono`) sont auto-hébergées en .woff2,
// un format que Typst ne sait pas charger. Le critère de remplacement n'est donc
// PAS « ce que le CSS nomme en repli » — `style.css` nomme des polices Windows
// (Segoe UI, Consolas) qui n'existent pas sur la machine de compilation, et
// Typst y retombait silencieusement sur sa sérif par défaut : tout le document
// sortait dans le style Typst d'origine, celui-là même que ce travail remplace.
//
// Le critère est donc : parmi les polices RÉELLEMENT installées, celles dont le
// dessin est le plus proche du jeu. `Fira Sans` est une grotesque humaniste de
// la même famille qu'`Inter` ; `JetBrainsMono NF` est littéralement la police du
// jeu, celle qui a déjà exporté les PNG de `design/out/`. Un repli chacun, pour
// que le document reste compilable ailleurs sans changer de visage.
#let sans = ("Fira Sans", "Noto Sans")
#let mono = ("JetBrainsMono NF", "Hack")

// --- Blocs de vulgarisation --------------------------------------------------

/// Encadré « En clair » : la même idée, dite sans le vocabulaire.
///
/// Barre `corail` à gauche, retrait, corps plus petit et plus gris — il se
/// saute d'un coup d'œil. Le texte courant ne se paraphrase JAMAIS pour autant :
/// si un encadré disparaissait, la section resterait complète.
#let en-clair(titre, corps) = block(
  width: 100%,
  inset: (left: 1em, top: 0.35em, bottom: 0.35em),
  stroke: (left: 2pt + accent),
  above: 1.4em,
  below: 1.4em,
  // Insécable : ces blocs font quatre lignes, et une coupure y laissait le
  // titre seul en bas de page. Un « En clair » orphelin ne vulgarise rien.
  breakable: false,
)[
  #set text(size: 9pt, fill: gris)
  #set par(justify: true, leading: 0.62em)
  #text(size: 7pt, weight: 700, fill: accent-encre, tracking: 0.14em)[EN CLAIR]
  #h(0.7em)
  #text(size: 9.5pt, weight: 600, fill: encre)[#titre]
  #v(0.35em)
  #corps
]

/// Encadré « récit » : problème → décision → résultat.
///
/// Réservé aux problèmes qui ont RÉELLEMENT résisté. Un chantier qui s'est bien
/// passé n'en reçoit pas : un récit posé partout ne raconte plus rien.
#let recit(titre, probleme: [], decision: [], resultat: []) = block(
  width: 100%,
  fill: papier-doux,
  inset: 1em,
  radius: 2pt,
  above: 1.5em,
  below: 1.5em,
  breakable: true,
)[
  #set text(size: 9pt, fill: encre)
  #set par(justify: true, leading: 0.62em)
  #text(size: 7pt, weight: 700, fill: accent-encre, tracking: 0.14em)[RÉCIT]
  #h(0.7em)
  #text(size: 10pt, weight: 600)[#titre]
  #v(0.55em)
  #grid(
    columns: (auto, 1fr),
    row-gutter: 0.5em,
    column-gutter: 0.9em,
    text(weight: 600, fill: accent-encre)[Problème], probleme,
    text(weight: 600, fill: accent-encre)[Décision], decision,
    text(weight: 600, fill: accent-encre)[Résultat], resultat,
  )
]

// --- Illustrations -----------------------------------------------------------

/// Capture à prendre, posée en attente avec sa légende déjà rédigée.
///
/// Le cadre a la proportion d'une capture 16/9 pour que la mise en page ne
/// bouge pas quand l'image arrivera à sa place.
#let capture(nom, legende, hauteur: 4.6cm) = figure(
  block(
    width: 100%,
    height: hauteur,
    fill: papier-doux,
    radius: 2pt,
    stroke: (thickness: 0.6pt, paint: filet, dash: "dashed"),
  )[
    #align(center + horizon)[
      #text(font: mono, size: 9pt, fill: gris)[\[PLACEHOLDER-#nom\.png\]]
    ]
  ],
  caption: legende,
)

/// Visuel déjà produit et committé dans `design/out/`. Embarqué directement :
/// ces PNG SONT les assets envoyés à Discord, il n'y a rien à recapturer.
#let visuel(fichier, legende, largeur: 62%, hauteur: none) = figure(
  if hauteur == none {
    image("../design/out/" + fichier, width: largeur)
  } else {
    image("../design/out/" + fichier, height: hauteur)
  },
  caption: legende,
)

/// Schéma vectoriel (fletcher), avec sa légende.
#let schema(corps, legende) = figure(corps, caption: legende)

/// Diagramme de séquence chronos, avec sa légende.
///
/// Corps réduit, et ce n'est pas cosmétique : chronos dimensionne ses colonnes
/// d'après la LARGEUR MESURÉE des commentaires. Au corps du document, un
/// message un peu bavard pousse le dernier participant hors de la justification
/// — et Typst ne le signale pas, il déborde en silence. Réduire la mesure est
/// ce qui ramène le diagramme dans la page, pas un `scale` posé après coup.
#let sequence(corps, legende) = figure(
  {
    set text(size: 8pt)
    corps
  },
  caption: legende,
)

// Réglages communs à tous les diagrammes fletcher : un seul endroit à retoucher
// pour que les sept schémas structurels restent une même famille.
#let diag = (
  node-shape: rect,
  node-stroke: 0.7pt + encre,
  node-fill: white,
  node-inset: 7pt,
  node-corner-radius: 2pt,
  edge-stroke: 0.7pt + gris,
  label-size: 7.5pt,
  node-outset: 0pt,
)

/// Nœud mis en avant : le même cadre, teinté de l'accent du jeu.
#let cle = (fill: corail.lighten(84%), stroke: 0.8pt + accent-encre)

// -----------------------------------------------------------------------------
//  Page de garde
//
//  Le seul endroit du document qui reprend la palette du jeu telle quelle :
//  fond `nuit`, wordmark de `design/composants.typ`. C'est l'écran de lancement
//  de l'Activity, posé à plat sur du papier.
// -----------------------------------------------------------------------------

#page(fill: nuit, margin: (x: 3cm, y: 3.4cm), header: none, footer: none, numbering: none)[
  #set text(font: sans, fill: texte)
  #v(1fr)
  #logo(taille-texte: 1.9cm)
  #v(1.1cm)
  #line(length: 4.5cm, stroke: 2pt + corail)
  #v(0.8cm)
  #text(size: 19pt, weight: 300, fill: texte)[Documentation technique]
  #v(0.3cm)
  #text(size: 11pt, fill: sourd)[
    Un jeu de vitesse de frappe embarqué dans Discord comme Activity.
  ]
  #v(1fr)
  // Date ÉCRITE, pas `datetime.today()` : le PDF est committé, et une date
  // calculée à la compilation le fait diverger à chaque recompilation même
  // quand pas une ligne n'a bougé. Elle se retouche avec la version, juste
  // au-dessus — les deux vont ensemble.
  #text(size: 9pt, fill: sourd, font: mono)[
    version 0.0.4 · 17/08/2026 \
    github.com/DireDoch/TypeRacerDiscord
  ]
]

// -----------------------------------------------------------------------------
//  Corps
// -----------------------------------------------------------------------------

#set page(
  paper: "a4",
  margin: (top: 2.6cm, bottom: 2.2cm, x: 2.4cm),
  numbering: "1",
  header: context {
    // Une page qui OUVRE une section n'a pas d'en-tête : son grand titre est
    // déjà là, et `before(here())` y renverrait le titre de la section
    // précédente — l'en-tête a beau être en haut de la page, il est posé AVANT
    // le titre dans l'ordre du document.
    let ouvre = query(heading.where(level: 1)).any(h => h.location().page() == here().page())
    let vus = query(selector(heading.where(level: 1)).before(here()))
    if vus.len() > 0 and not ouvre {
      set text(font: sans, size: 8pt, fill: gris)
      grid(
        columns: (1fr, auto),
        align(left)[#vus.last().body],
        align(right)[TypeRacerDiscord],
      )
      v(-0.6em)
      line(length: 100%, stroke: 0.4pt + filet)
    }
  },
  footer: context {
    set text(font: mono, size: 8.5pt, fill: gris)
    align(right)[#counter(page).display("1")]
  },
)

#set text(font: sans, size: 10pt, lang: "fr", fill: encre)
// Sans séparateur explicite, une liste de termes rend « Terme définition » d'un
// seul trait et le terme cesse de se détacher.
#set terms(separator: [ — ], hanging-indent: 1.2em)
#set par(justify: true, leading: 0.72em, spacing: 1.05em)
#set heading(numbering: "1.1")

#show link: set text(fill: accent-encre)
#show raw: set text(font: mono, size: 8.8pt)
#show raw.where(block: true): it => block(
  width: 100%,
  fill: papier-doux,
  inset: (x: 0.9em, y: 0.75em),
  radius: 2pt,
  above: 1.2em,
  below: 1.2em,
)[#it]

#set table(
  stroke: (x, y) => (bottom: if y == 0 { 0.8pt + accent } else { 0.3pt + filet }),
  inset: (x: 0.55em, y: 0.5em),
)
#show table.cell.where(y: 0): set text(weight: 600, size: 8.5pt, fill: encre)
#show table: set text(size: 9pt)

#set figure(gap: 0.8em)
#set figure(supplement: [Figure])
// Typst compte les tableaux sur leur PROPRE compteur. Les laisser sous le
// supplément « Figure » produisait deux « Figure 3 » dans le document — un
// tableau et une illustration, sans rien pour les distinguer.
#show figure.where(kind: table): set figure(supplement: [Tableau])
#show figure: set block(above: 1.7em, below: 1.7em)
// Légende à gauche et non centrée : une légende de trois lignes centrée se lit
// comme un poème. Le fer à gauche la range sous l'illustration.
#show figure.caption: it => block(width: 100%)[
  #set text(size: 8.5pt, fill: gris)
  #set par(justify: false, leading: 0.55em)
  #align(left)[#it]
]

// Les renvois disent « section 6.3 » et non « Chapitre 6.3 » : le document a des
// sections numérotées, pas des chapitres.
#set heading(supplement: [section])

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  block(above: 0em, below: 1.3em)[
    #set text(font: sans, fill: encre)
    #grid(
      columns: (auto, 1fr),
      column-gutter: 0.55em,
      align(bottom)[#text(size: 20pt, weight: 700, fill: accent)[
          #context counter(heading).display()
        ]],
      align(bottom)[#text(size: 19pt, weight: 600)[#it.body]],
    )
    #v(-0.2em)
    #line(length: 100%, stroke: 0.9pt + accent)
  ]
}

#show heading.where(level: 2): it => block(above: 1.7em, below: 0.75em)[
  #set text(font: sans, size: 12.5pt, weight: 600, fill: encre)
  #text(fill: accent-encre)[#context counter(heading).display()]
  #h(0.45em)
  #it.body
]

#show heading.where(level: 3): it => block(above: 1.3em, below: 0.55em)[
  #set text(font: sans, size: 10.5pt, weight: 600, fill: gris)
  #it.body
]

// --- Table des matières ------------------------------------------------------

#{
  set text(font: sans)
  text(size: 15pt, weight: 600)[Table des matières]
  v(0.3em)
  line(length: 100%, stroke: 0.9pt + accent)
  v(0.9em)
  show outline.entry.where(level: 1): it => {
    v(0.7em, weak: true)
    strong(it)
  }
  // Sans points de conduite : deux niveaux pointillés sur une page entière
  // font une trame, et c'est la trame qu'on lit avant les titres.
  show outline.entry: set block(above: 0.55em)
  set outline.entry(fill: none)
  outline(title: none, indent: 1.1em, depth: 2)
}

#counter(page).update(1)

= Identification du projet

TypeRacerDiscord est un jeu de vitesse de frappe qui se joue *à l'intérieur de
Discord*, comme Activity : une iframe lancée depuis un salon vocal, sans rien à
installer et sans compte à créer. On y tape seul contre le chrono, ou à huit sur
le même texte, avec trois règles de victoire différentes et un cursus de cent
leçons pour apprendre à taper sans regarder ses doigts.

Le produit final est un binaire Linux unique, statique, qui sert à la fois
l'interface et son API, publié en archive par la chaîne d'intégration à chaque
version — plus les quelques assets déposés dans le portail développeur Discord.

Ce document décrit l'application telle qu'elle est à la version `0.0.4` : ce
qu'elle fait pour un joueur, comment chacun de ses blocs a été construit, et
comment le système tient debout une fois l'ensemble assemblé.

= Le projet en chiffres

Un instantané, mesuré sur le dépôt à la version `0.0.4`. Ces nombres ne sont pas
un palmarès : ils donnent l'ordre de grandeur qu'il faut avoir en tête pour lire
les sections suivantes — notamment le rapport entre le code de production et ce
qui l'atteste.

#figure(
  table(
    columns: (1fr, auto),
    align: (left, right),
    table.header([Grandeur], [Valeur]),

    [Lignes TypeScript (`frontend/src`, tests compris)], [11 368],
    [Lignes Rust (`backend/src`, tests compris)], [7 960],
    [Lignes de feuille de style (une seule)], [2 312],
    [Tests automatisés], [382 + 159],
    [Langages tenus à parité, prouvée par vecteurs partagés], [2],
    [Décisions d'architecture consignées (ADR)], [19],
    [Messages du protocole WebSocket], [29],
    [Leçons du cursus « Apprendre »], [100],
    [Migrations de base de données], [6],
    [Modes de jeu multijoueur], [3],
    [Issues fermées], [121],
  ),
  caption: [Le projet mesuré, version `0.0.4`. Les 382 tests sont ceux de
    `vitest` côté TypeScript, les 159 ceux de `cargo test` côté Rust.],
)

Deux chiffres méritent d'être lus ensemble. *Deux langages tenus à parité*
signifie que le même algorithme de score existe en TypeScript et en Rust, et que
des vecteurs de test communs interdisent aux deux versions de diverger — c'est
le sujet de la @parite. *29 messages* est la taille du
contrat entre le navigateur et le serveur pendant une course ; c'est aussi ce
qui dérivera en premier si le protocole bouge, et ce que @websocket
liste un par un.

= Description sommaire

== Le produit

Un joueur ouvre Discord, entre dans un salon vocal, clique sur la fusée et
lance TypeRacer. L'application s'affiche dans une iframe, à l'intérieur du
client Discord — pas dans un onglet, pas dans une fenêtre à côté. Elle reconnaît
le joueur toute seule : son nom et son avatar viennent de la session Discord
déjà ouverte, il n'y a rien à saisir.

De là, deux chemins. *Solo* : un texte apparaît, le chrono part à la première
frappe, et l'écran de résultats affiche vitesse, précision et une courbe seconde
par seconde. *Multijoueur* : les joueurs du même salon se retrouvent
automatiquement dans un salon d'attente, l'hôte règle la partie, et tout le monde
tape le même texte pendant que des voitures avancent sur une piste. Un troisième
chemin, *Apprendre*, est un cursus de cent leçons qui ne se joue pas contre les
autres mais contre ses propres doigts.

Pendant tout ce temps, les autres membres du salon vocal voient dans Discord ce
que le joueur est en train de faire — « En course », « S'entraîne », avec le
visuel du mode choisi. C'est la Rich Presence, et elle fonctionne même pour ceux
qui n'ont pas ouvert l'Activity.

== Le contexte Discord

Une Activity n'est pas un site web hébergé quelque part que Discord irait
ouvrir. C'est une page servie *à travers Discord*, dans une iframe verrouillée,
sous une politique de sécurité de contenu qui refuse toute requête réseau ne
passant pas par un préfixe imposé. Cette contrainte-là a façonné plus de code
que n'importe quel choix d'architecture — elle revient à la @csp.

Trois conséquences structurent tout le reste :

- *L'origine est unique.* Discord ne redirige qu'une seule adresse vers le
  projet. Le serveur Rust sert donc à la fois le build du frontend et l'API.
- *Il n'y a pas d'URL.* L'adresse de l'iframe est figée par Discord ; la
  navigation se fait entièrement par boutons, écran par écran.
- *Il n'y a pas de console.* Un développeur qui déboguerait dans le client
  Discord ne voit rien du tout — d'où un bandeau d'erreurs affiché dans le jeu
  lui-même (@debug).

== Le vocabulaire minimal

Le projet tient un glossaire de domaine complet — une quarantaine de termes, avec
pour chacun les mots qu'il est interdit d'employer à sa place — dans
#link("../CONTEXT.md")[`CONTEXT.md`], à la racine du dépôt. Ce document n'en
reprend pas la lettre. Voici les douze termes sans lesquels les sections
suivantes ne se lisent pas ; les autres sont introduits là où ils servent.

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([Terme], [Ce qu'il désigne]),

    [*Run*],
    [Une tentative de frappe, du premier caractère à la fin. L'unité à laquelle
      tout le reste s'accroche. Deux espèces : Practice et Race.],

    [*Practice*],
    [Un Run solo en saisie libre : le retour arrière est permis, une faute peut
      rester non corrigée, on peut taper au-delà du mot.],

    [*Race*],
    [Un Run compétitif dans une Room, sur la même saisie libre — mais qui ne se
      termine qu'une fois le texte entier tapé *exactement*.],

    [*Room*],
    [La session multijoueur qui réunit les joueurs sur un même texte. Identifiée
      par une clé unique prenant deux formes : un salon vocal, ou un Code de
      partie.],

    [*Mode*],
    [La règle solo qui décide du texte présenté et de la fin du Run :
      `Time`, `Words`, `Quotes` ou `Zen`. Exactement un par Run — et *aucun* en
      Race.],

    [*Mode de jeu*],
    [La règle qui décide comment une Race se *gagne* : `Normal`,
      `Floor is lava` ou `Spam`. Un axe à part entière, jamais cumulable.],

    [*Source de texte*],
    [D'où vient le texte d'une Race — une citation, ou des mots générés. Elle
      décide du texte, jamais de la mesure.],

    [*Réglage de salon*],
    [Une option de Room posée par l'hôte hors course et imposée à tout le monde :
      durée du décompte, taille max, Difficulté, Mode de jeu…],

    [*Preference*],
    [Ce qu'un joueur veut voir *sur sa machine à lui* : police, palette, pseudo
      affiché. Ne quitte jamais l'appareil et n'influence aucun score.],

    [*Keystroke log*],
    [La chronologie brute des frappes d'un Run : quoi, et à quel instant. La
      matière première dont tout le reste est dérivé.],

    [*Scoreboard autoritaire*],
    [Les chiffres qui font foi, recalculés par le serveur Rust depuis le
      Keystroke log à la fin d'un Run. En multijoueur, c'est aussi l'anti-triche.],

    [*Gap (écart)*],
    [De combien de secondes un joueur a fini derrière le vainqueur. C'est le
      chiffre qu'on dit à voix haute à l'arrivée, pas la vitesse absolue.],
  ),
  caption: [Les douze termes de travail. Le glossaire complet, avec ses
    interdits de vocabulaire, reste dans `CONTEXT.md`.],
)

#en-clair([Le « recompute autoritaire »])[
  Le navigateur du joueur affiche un compteur de vitesse pendant qu'il tape,
  mais ce chiffre-là n'est *jamais* celui qu'on enregistre. À la fin, le
  navigateur envoie au serveur la liste brute de ses frappes — la touche et
  l'instant, rien d'autre. Le serveur *rejoue* cette liste contre le texte
  qu'il possède, et recalcule tout lui-même. C'est un peu comme rendre sa copie
  d'examen : ce n'est pas la note que l'élève s'est donnée qui compte, c'est
  celle du correcteur. Le joueur peut mentir sur sa vitesse, il ne peut pas
  mentir sur ses frappes sans réécrire une partie entière cohérente.
]

= Fonctionnalités

Cette section décrit le produit *à l'œil du joueur* : ce qu'il voit, dans
l'ordre où il le rencontre. Aucun nom de fichier, aucun détail
d'implémentation — ceux-là viennent à la @realisation et à la @technique.

== Le Menu

Le point d'arrivée. Quatre portes : Solo, Multijoueur, Paramètres, Quitter.
« Quitter » ferme réellement l'Activity dans Discord, et disparaît quand le jeu
tourne hors Discord.

#capture(
  "menu",
  [Le Menu, écran d'arrivée. Les quatre entrées, le wordmark, et l'accès au
    guide « Comment jouer » — affiché d'office la toute première fois.],
)

== Solo : Practice

Une barre de configuration au-dessus de la zone de frappe : le Mode
(`Time` / `Words` / `Quotes` / `Zen`), sa valeur, puis les modificateurs de
texte cumulables — ponctuation, chiffres. Deux Modes particuliers escamotent
ces contrôles parce qu'ils ne s'y appliquent pas : `Quotes` (la longueur
appartient à la citation) et `Zen` (il n'y a pas de texte cible du tout).

#capture(
  "config-solo",
  [La barre de configuration solo dépliée. Chaque contrôle n'apparaît que
    lorsqu'il a un sens : choisir « citation » fait disparaître la longueur et
    les modificateurs.],
)

Le chrono ne part pas au clic mais à la *première frappe* : rien n'est masqué,
personne n'attend, il n'y a pas de décompte. Le texte défile par fenêtre de
trois lignes, le mot en cours restant toujours sur celle du milieu.

#capture(
  "practice",
  [Un Practice en cours. Le mot actif reste sur la ligne du milieu ; les
    caractères déjà tapés changent de couleur, une faute passe en rouge.],
)

À la fin, l'écran de résultats affiche le scoreboard recalculé par le serveur —
vitesse nette, vitesse brute, précision, décompte des caractères — et la courbe
seconde par seconde. Un bouton rejoue le Run à sa vitesse réelle, fautes
comprises.

#capture(
  "resultats-solo",
  [L'écran de résultats. Le graphe seconde par seconde est un SVG construit à
    la main : la dépendance à une bibliothèque de graphiques a été retirée du
    projet (@graphe).],
)

== Solo : Apprendre

Un cursus de cent leçons, débloquées une à une. Chacune enseigne un point
précis — la position des mains, la rangée de repos, les majuscules, la
ponctuation, les chiffres, puis les vrais mots — et se termine par un exercice.
Le seul critère pour passer à la suivante est la *précision*, jamais la vitesse,
et la barre monte par paliers au fil du cursus.

#capture(
  "apprendre",
  [La liste des leçons. Trois états visibles : verrouillée, disponible,
    terminée. La progression suit le joueur, pas l'appareil.],
)

== Multijoueur : entrer dans une Room

Trois portes, présentées ensemble sur le même écran :

/ Le salon : rejoindre la Room du salon vocal courant. Elle est créée à la volée
  si elle n'existe pas — la clé vient de Discord, elle ne peut pas être mal tapée.
/ Créer : ouvrir une Room neuve et recevoir un Code de partie de cinq caractères,
  lisible à voix haute.
/ Rejoindre par code : saisir un code. Celui-ci ne crée jamais rien : un code
  inconnu répond « introuvable » et laisse corriger sur place.

Le code est ce qui permet à des joueurs de *serveurs Discord différents* de
courir ensemble.

#capture(
  "menu-multijoueur",
  [Les trois portes d'entrée d'une Room, avec le champ de saisie du code au
    même endroit : un code refusé ramène le joueur là où il peut le corriger.],
)

== Multijoueur : le salon d'attente

Trois colonnes. À gauche les présents, avec avatar, pseudo et couronne pour
l'hôte. Au centre les réglages de la partie. À droite, dans un cadre, le visuel
du Mode de jeu choisi et ce qu'il implique.

Ce que l'hôte règle : le Mode de jeu, la Source du texte et sa longueur, la
durée du décompte, la taille maximale de la Room, la Difficulté, le
ready-check — et, selon le Mode de jeu, l'intervalle d'élimination ou le mot et
les seuils. Tout le monde voit ces réglages : ils s'imposent à tous, pas
seulement à celui qui les choisit.

#capture(
  "lobby",
  [Le salon en trois colonnes. Le Code de partie est masqué par défaut et se
    révèle d'un clic — on ne diffuse pas par accident l'entrée de sa partie.],
)

== Multijoueur : la course

Une ligne par joueur : l'avatar en tête de progression, le pseudo, la vitesse
en direct à hauteur de la ligne d'arrivée. Le décompte dure ce que l'hôte a
réglé, texte entier visible pendant l'attente — il n'y a rien à masquer, tout
le monde part au même instant.

#capture(
  "piste",
  [La piste pendant une course classique. La position de chaque voiture suit le
    nombre de caractères corrects, pas le temps.],
)

== Multijoueur : Floor is lava

À intervalle régulier, le joueur le moins avancé brûle. La course s'arrête à
l'instant où il ne reste qu'un vivant : le survivant gagne *sans avoir terminé
le texte*. C'est la seule course qui se finit sans que personne ne franchisse
de ligne d'arrivée — le mode impose d'ailleurs un texte trop long pour être
achevé. On ne gagne pas en tapant vite, on gagne en n'étant jamais dernier.

#capture(
  "floor-is-lava",
  [Floor is lava en action. Ce qui compte n'est pas la position absolue mais la
    position *relative* : le dernier au moment du tic disparaît.],
)

== Multijoueur : Spam

Un seul mot, répété indéfiniment. L'hôte choisit le mot — dans la liste
existante ou en le tapant lui-même — un seuil de répétitions, et un plafond de
temps. La course s'arrête dès que l'un des deux tombe : soit quelqu'un verrouille
le seuil, soit le temps expire et c'est le plus grand nombre de répétitions
correctes qui l'emporte.

#capture(
  "spam",
  [Le mode Spam et son compteur de répétitions, qui remplace la vitesse à la
    ligne d'arrivée : c'est la grandeur qui décide de la victoire.],
)

== Multijoueur : le podium

Trois marches, les autres joueurs visibles à côté, et le *Gap* en gros
caractères — l'écart au vainqueur en secondes. Cliquer sur un joueur déplie sa
courbe seconde par seconde, sans aucune requête réseau : tout est arrivé avec
le message de fin de course.

Les deux Modes de jeu n'ont pas de Gap, puisque personne ne franchit de ligne.
Chacun affiche à sa place ce qui décide vraiment de son classement : le temps
de survie pour Floor is lava, le nombre de répétitions pour Spam.

#capture(
  "podium",
  [Le podium, Gap en tête d'affiche. Les abandons et les échecs figurent derrière
    tous les finisseurs, jamais mêlés à eux.],
)

== Multijoueur : Play of the Game

Quand deux joueurs ont fini à moins de deux secondes l'un de l'autre — où qu'ils
soient au classement — leurs dernières secondes sont rejouées côte à côte, au
ralenti, sur une *horloge partagée*. C'est cette horloge unique qui en fait un
duel plutôt que deux relectures posées l'une à côté de l'autre. Sans photo-finish,
il n'y a pas de Play of the Game du tout : le bouton n'apparaît pas.

#capture(
  "play-of-the-game",
  [Play of the Game : deux Keystroke logs rejoués sur la même horloge, sur les
    dernières secondes avant la première des deux arrivées.],
)

== Paramètres

Une ligne par réglage : libellé et explication à gauche, contrôle à droite,
groupés en sections — Apparence, Solo, Son, et une zone à risque pour exporter,
importer ou effacer ses données. Le choix de la police de frappe s'affiche
directement dans la police concernée : l'aperçu *est* le contrôle.

Ces réglages ne quittent jamais l'appareil. Deux joueurs de la même course
peuvent voir des polices et des couleurs différentes tout en tapant exactement
le même texte, et changer un réglage n'invalide jamais un record.

#capture(
  "parametres",
  [L'écran Paramètres. Chaque type de contrôle — segmenté, curseur, bascule,
    nombre — est né avec le premier réglage qui en avait besoin.],
)

== Hors du jeu : ce que Discord montre

#capture(
  "rich-presence",
  [La Rich Presence telle qu'un autre membre du salon la voit, sans avoir ouvert
    l'Activity : l'état courant, le visuel du Mode de jeu, le compte des
    présents et un chrono. C'est la seule preuve visible que le câblage
    fonctionne de bout en bout.],
)

#capture(
  "activity-salon-vocal",
  [L'Activity lancée depuis un salon vocal, dans le client Discord. L'iframe
    occupe la zone de conversation ; le jeu s'échelonne à la fenêtre plutôt que
    de faire défiler.],
)

= Réalisation du projet <realisation>

Cette section change de point de vue : on ne regarde plus l'écran, on regarde le
chantier. Un paragraphe descriptif par bloc construit, dans l'ordre où ils
s'empilent. Les encadrés « récit » n'interrompent le catalogue que pour les
problèmes qui ont *réellement* résisté — un chantier qui s'est bien passé n'a
pas d'histoire à raconter, et un récit posé partout ne raconterait plus rien.

Les trois derniers chantiers ne produisent aucune fonctionnalité : ce sont des
chantiers de *méthode*, et ils expliquent pourquoi les précédents ont pu être
menés sans se marcher dessus.

== Les trois axes d'une Race

Le concept le plus facile à confondre du domaine, et celui qu'il a fallu séparer
en premier. Trois réglages agissent sur une même course, et *aucun* n'est une
variante des deux autres.

#schema(
  diagram(
    ..diag,
    spacing: (13mm, 9mm),
    node((0, 0), [*Source de texte*\ #text(7pt)[d'où vient le texte]], ..cle),
    node((1, 0), [*Mode de jeu*\ #text(7pt)[comment on gagne]], ..cle),
    node((2, 0), [*Difficulté*\ #text(7pt)[quand on échoue]], ..cle),

    node((0, 1), align(left)[Citation\ Mots (15 / 30 / 50)]),
    node((1, 1), align(left)[Normal\ Floor is lava\ Spam]),
    node((2, 1), align(left)[Normal\ Master]),

    edge((0, 0), (0, 1), "->"),
    edge((1, 0), (1, 1), "->"),
    edge((2, 0), (2, 1), "->"),

    node(
      (1, 2),
      align(left)[
        #text(7.5pt)[Sous *Floor is lava* et *Spam*, la Source de texte est
          INERTE :\ le Mode de jeu impose son propre texte.]
      ],
      stroke: none,
      fill: none,
    ),
    edge((1, 1), (1, 2), "-|>", dash: "dashed"),
    edge((0, 1), (1, 2), "-|>", dash: "dashed"),
  ),
  [Les trois axes d'une Race. La Source décide du texte et jamais de la mesure ;
    le Mode de jeu décide de la victoire ; la Difficulté est une condition
    d'échec *individuelle*, évaluée sur le seul journal de frappe du joueur
    concerné et jamais contre les autres.],
)

Une Race n'a délibérément *pas* de Mode : sa règle de fin est toujours « le
texte entier, exactement ». Un Mode `Time` en course impliquerait des voitures
sans ligne d'arrivée commune, et `Zen` n'a pas de fin du tout. Ce que l'hôte
choisit, c'est la provenance du texte — le recalcul autoritaire, lui, mesure
toujours la même chose.

== Les trois Modes de jeu

`Normal` est le comportement d'origine : le premier à taper tout le texte,
exactement. Les deux autres ont été ajoutés comme des *axes*, pas comme des
options, précisément pour qu'ils ne se cumulent jamais entre eux.

*Floor is lava* remplace la victoire par la survie. Un métronome serveur bat à
l'intervalle réglé ; à chaque battement, le moins avancé brûle. Le classement
est l'ordre des morts, inversé. Deux conséquences ont dû être tirées jusqu'au
bout : le mode impose son propre texte, assez long pour que personne ne
l'achève — un mode qui se gagne en survivant ne doit pas offrir de porte de
sortie par l'arrivée — et un joueur brûlé porte tout de même un *vrai score
partiel*, recalculé sur ce qu'il a eu le temps de taper. Ce score ne le classe
jamais ; il sert à l'afficher et à choisir le duel d'après-course.

*Spam* remplace le texte par un mot unique, diffusé sans fin. Deux réglages
décident de l'arrêt — un seuil de répétitions et un plafond de temps — et le
premier des deux qui tombe arrête tout le monde. Le compte de répétitions
annoncé par un client est déclaratif : il peut *arrêter* la course, il ne peut
pas la gagner. Le classement vient du recompte serveur, qui rejoue chaque
journal de frappe contre sa propre copie du mot.

#recit(
  [Floor is lava éliminait pendant le décompte],
  probleme: [Le métronome démarrait avec la course, pas avec la fin du décompte.
    Pendant les cinq secondes d'attente, personne n'a encore tapé le moindre
    caractère : tout le monde est donc à égalité au dernier rang. Le premier
    battement éliminait alors *tous* les joueurs d'un coup, et la Room se
    figeait dans un état sans vivant et sans vainqueur.],
  decision: [Faire partir le métronome au signal de départ partagé et non à la
    création de la course, et traiter l'égalité générale comme un cas nommé
    plutôt que comme un tri qui « tombe bien » la plupart du temps.],
  resultat: [Le mode a servi d'avertissement pour les suivants : toute règle
    comparative doit dire ce qu'elle fait quand *tous* les joueurs sont à
    égalité, y compris à zéro. Le cas dégénéré n'est pas un cas rare, c'est
    l'état initial de chaque course (issue #159).],
)

#en-clair([Un texte « généré à partir d'une graine »])[
  Le texte d'une course n'est pas tiré au hasard puis envoyé à tout le monde :
  on tire un *nombre*, la graine, et le texte se déduit de ce nombre par un
  calcul sans surprise. Même graine, même texte, toujours, sur n'importe quelle
  machine. C'est ce qui permet au serveur Rust et au navigateur de fabriquer le
  même texte chacun de son côté sans se le transmettre — et c'est aussi ce qui
  rend les tests possibles : une graine fixée donne un texte connu d'avance.
]

== La machine d'état d'une Race <etats>

Chaque course traverse les mêmes phases, et chaque joueur en sort par l'une de
cinq portes. Ces cinq sorties ne sont pas des nuances de la même chose : elles
se distinguent par *qui décide*.

Une précision de vocabulaire, parce que le glossaire du projet compte
différemment. `CONTEXT.md` réserve le mot « état terminal » aux quatre façons de
sortir d'une course *sans l'avoir finie* — Abandon, Échec, Brûlé, Devancé — et
traite « fini » à part, comme la sortie normale. Le code, lui, ne fait pas cette
distinction : une fois posé, `finished` ne peut pas plus être écrasé que les
quatre autres. Le diagramme ci-dessous compte donc les cinq, parce que c'est la
propriété qu'il illustre — l'irréversibilité, pas la réussite.

#schema(
  diagram(
    ..diag,
    spacing: (11mm, 8mm),
    node((0, 0), [connexion]),
    node((1, 0), [*salon*], ..cle),
    node((2, 0), [décompte]),
    node((3, 0), [*course*], ..cle),
    node((4, 0), [clôture]),

    edge((0, 0), (1, 0), "->"),
    edge((1, 0), (2, 0), "->", [départ]),
    edge((2, 0), (3, 0), "->", [top]),
    edge((3, 0), (4, 0), "->"),
    edge((4, 0), (1, 0), "->", [revanche], bend: -42deg),

    node((1.35, 1.6), align(left)[*fini*\ #text(6.5pt)[texte 100 % exact]]),
    node((2.35, 1.6), align(left)[*abandon*\ #text(6.5pt)[choix du joueur]]),
    node((3.35, 1.6), align(left)[*échec*\ #text(6.5pt)[sa propre faute]]),
    node((4.35, 1.6), align(left)[*brûlé*\ #text(6.5pt)[comparaison]]),
    node((5.35, 1.6), align(left)[*devancé*\ #text(6.5pt)[comparaison,\ horloge]]),

    edge((3, 0), (1.35, 1.6), "->"),
    edge((3, 0), (2.35, 1.6), "->"),
    edge((3, 0), (3.35, 1.6), "->"),
    edge((3, 0), (4.35, 1.6), "->"),
    edge((3, 0), (5.35, 1.6), "->"),
  ),
  [Les phases d'une Race et les cinq états terminaux d'un partant. *Fini* est la
    seule sortie par la ligne d'arrivée. *Abandon* vient du joueur lui-même — et
    une déconnexion produit exactement le même enregistrement. *Échec* vient de
    sa propre faute sous Difficulté Master. *Brûlé* et *devancé* ne viennent ni
    d'un choix ni d'une faute : ils viennent d'être comparé aux autres.],
)

Un état terminal ne se reprend pas : une fois posé, il ne peut plus être écrasé
par un message arrivé en retard. Un abandon garde par ailleurs la position
qu'avait le joueur — sa voiture s'arrête là où il s'est arrêté, elle ne retombe
pas à zéro.

== Les Réglages de salon

Six réglages généraux — Source de texte, taille maximale, durée du décompte,
ready-check, Difficulté, Mode de jeu — plus quatre propres aux Modes de jeu :
l'intervalle d'élimination de Floor is lava, et le mot, le seuil et le plafond
de temps de Spam. Ils partagent tous la
même frontière : posés par l'hôte seul, acceptés hors course seulement, et
rediffusés à tout le salon dès qu'ils sont acceptés. Un réglage refusé est
ignoré en silence côté serveur — le client n'est jamais en position d'imposer
quoi que ce soit.

Le point délicat n'était pas la liste mais la *bascule*. Passer d'un Mode de jeu
à un autre regénère le texte, puisque chaque mode impose le sien. Or les réglages
préparés pour un mode qu'on quitte doivent survivre : celui qui règle Spam, passe
voir Floor is lava, puis revient, doit retrouver son mot et ses seuils tels
qu'il les avait laissés. Les réglages vivent donc à plat sur la Room plutôt que
dans la variante du Mode de jeu — un écart assumé par rapport à la décision
d'architecture qui les décrivait, et documenté comme tel dans le code.

== Le multijoueur

Une Room est identifiée par une clé unique qui prend deux formes : un salon
vocal Discord, ou un Code de partie de cinq caractères. Une seule table, deux
formes — et trois portes d'entrée aux droits différents, décrites à la
@websocket. L'alphabet du code exclut les caractères qui se
confondent à l'oral et à l'œil : ni `0`/`O`, ni `1`/`I`/`L`. Un code n'est
jamais réservé ni persisté ; il vit tant que sa Room vit, et meurt avec elle.

Le premier arrivé est l'hôte, et le rôle passe au suivant s'il part. La Room
plafonne à huit présents. Les partants sont *figés au départ* : quelqu'un qui
rejoint pendant une course occupe une place mais n'est pas dans cette
course-là.

À l'arrivée, le message de fin porte le classement complet de tous les partants,
avec leur courbe seconde par seconde — pas seulement l'ordre. C'est ce qui
permet au podium d'afficher le Gap et de déplier le graphe de n'importe quel
joueur sans un seul aller-retour réseau. Ce choix a une raison précise : la
composition d'une course vit en mémoire et meurt avec la Room, donc le serveur
ne pourrait pas vérifier après coup qu'un demandeur en faisait partie. Sur le
WebSocket, la question ne se pose pas — l'autorisation *est* la connexion.

#recit(
  [Le verrou des Rooms et l'aller-retour réseau],
  probleme: [Une Room dont la Source est « citation » doit aller chercher son
    texte sur une API externe. Mais l'état des Rooms est protégé par un verrou
    classique, celui qui ne peut pas être tenu à travers une attente réseau : le
    tenir pendant la requête bloquerait toutes les autres Rooms du serveur
    pendant la latence de l'API, et le compilateur Rust refuse d'ailleurs la
    construction.],
  decision: [Découper en trois temps : lire la Source sous verrou, *relâcher*,
    chercher le texte sans verrou, reposer le résultat sous verrou et rediffuser
    l'état. Et faire naître toute Room avec un texte de mots déjà en place, même
    quand sa Source est « citation ».],
  resultat: [Une Room est jouable immédiatement, sans réseau. Le salon voit
    l'ancien texte puis le nouveau. Une course lancée entre-temps annule la pose
    du texte en vol, devenu périmé. Le repli après échec de l'API n'est pas un
    état à part — la Room bascule *réellement* sur des mots générés, et c'est ce
    qu'elle annonce.],
)

#en-clair([Pourquoi un verrou ne traverse pas une attente])[
  Un verrou sert à garantir qu'une seule partie du programme touche une donnée
  à la fois. Le tenir, c'est faire attendre tous les autres. Tant qu'on ne fait
  que quelques calculs, l'attente se compte en microsecondes. Mais si on garde
  le verrou pendant qu'on interroge un serveur à l'autre bout d'Internet, on
  fait attendre tout le monde pendant des centaines de millisecondes — pour une
  requête qui ne concernait qu'une seule Room. D'où le découpage en trois temps :
  on ne tient jamais la porte fermée pendant qu'on va faire les courses.
]

== Le cursus « Apprendre »

Cent leçons, du placement des mains à la fluidité, en passant par les rangées,
les majuscules, la ponctuation et les chiffres. Le contenu est une *donnée* —
un fichier de description séparé du moteur — précisément pour qu'ajouter ou
réécrire une leçon ne demande pas de toucher au code.

Deux décisions structurent le cursus. La première : le seul critère de
déverrouillage est la précision, jamais la vitesse, avec un barème par tranches
qui se durcit au fil des leçons et se modifie en un seul endroit. La seconde :
un exercice de leçon *n'est pas un Run*. Il n'entre pas dans l'historique, ne
produit jamais de record, et n'est jamais soumis au serveur pour recalcul. La
progression, elle, suit le joueur et non l'appareil — le serveur en conserve
toujours le maximum atteint, jamais la dernière valeur reçue.

== L'intégration Discord <csp>

L'identité du joueur ne vient d'aucun formulaire : elle vient de la session
Discord déjà ouverte, par un enchaînement en quatre temps entre l'iframe, le
client Discord et le serveur.

#sequence(
  chronos.diagram({
    import chronos: *
    // Les couleurs par défaut de chronos (lavande, jaune pâle) ne sont pas
    // celles du document : on les ramène sur la palette du jeu.
    _par("app", display-name: "Activity (iframe)", color: corail.lighten(70%))
    _par("dc", display-name: "Client Discord", color: corail.lighten(70%))
    _par("srv", display-name: "Backend Rust", color: corail.lighten(70%))
    _par("api", display-name: "API Discord", color: papier-doux)

    _seq("app", "dc", comment: "ready")
    _seq("dc", "app", comment: "frame_id, salon", dashed: true)
    _seq("app", "dc", comment: "authorize (scopes)")
    _seq("dc", "app", comment: "code OAuth2", dashed: true)
    _seq("app", "srv", comment: "POST /token { code }")
    _seq("srv", "api", comment: "échange code → access_token")
    _seq("api", "srv", comment: "access_token", dashed: true)
    _seq("srv", "app", comment: "access_token", dashed: true)
    _seq("app", "dc", comment: "authenticate (token)")
    _seq("app", "srv", comment: "Authorization: Bearer …")
    _seq("srv", "api", comment: "GET /oauth2/@me")
    _seq("api", "srv", comment: "utilisateur + application ÉMETTRICE", dashed: true)
    _note(
      "right",
      [Le serveur compare l'application\ émettrice à la sienne. Sinon la
        frontière\ ne serait pas « un joueur de cette\ Activity » mais « un
        utilisateur\ Discord ».],
      pos: "srv",
      color: papier-doux,
    )
    _seq("srv", "app", comment: "player_id", dashed: true)
  }),
  [Le handshake d'identité. Le secret client ne quitte jamais le serveur : c'est
    lui, et non l'iframe, qui échange le code contre un jeton. La dernière
    vérification est celle qui compte — un jeton d'accès Discord est valable sur
    l'endpoint d'identité *quelle que soit l'application qui l'a obtenu* (issue
    #150).],
)

#en-clair([OAuth2, ou « prouver son identité sans donner son mot de passe »])[
  Le jeu ne connaît jamais le mot de passe Discord de personne. Discord remet à
  l'application un *jeton* temporaire, qui dit « ce porteur est bien tel
  utilisateur, et il a accepté de partager son nom ». Le jeu montre ce jeton au
  serveur, qui va demander à Discord à qui il appartient. Le piège que le projet
  a dû traiter : un jeton obtenu par *une autre* application Discord répond
  aussi à cette question. Il faut donc demander en plus qui l'a émis, sinon
  n'importe quel utilisateur de Discord pourrait se présenter comme joueur.
]

Le reste de l'intégration tient dans deux contraintes. La première est la
politique de sécurité de l'iframe, sujet du récit ci-dessous. La seconde est
qu'une Activity non publiée reste *invisible* tant qu'un testeur n'a pas accepté
son invitation par courriel — un piège de portail qui n'a rien à voir avec le
code, et qui a coûté une session entière avant d'être identifié.

#recit(
  [La politique de sécurité de l'iframe Discord],
  probleme: [Dans l'iframe d'une Activity, *toute* requête réseau qui ne passe
    pas par un préfixe imposé est refusée. Le document et les scripts se
    chargent normalement : l'interface s'affiche, parfaitement intacte, et rien
    ne fonctionne. Aucune erreur visible, aucun message — et la console du
    navigateur n'existe pas dans le client Discord.],
  decision: [Une seule fonction décide du préfixe, en observant si l'application
    tourne dans une iframe Discord ou non, et les quatre points d'accès réseau
    du projet passent tous par elle. Aucun appel direct nulle part.],
  resultat: [Le proxy Discord retire le préfixe *avant* d'appliquer sa
    redirection : le serveur et le développement local n'ont donc rien à savoir
    de tout ça. Ce symptôme — « l'interface va bien, le réseau est mort » — est
    devenu le premier réflexe de diagnostic du projet, et il a directement
    motivé le bandeau d'erreurs de la section suivante.],
)

#en-clair([La politique de sécurité de contenu d'une iframe])[
  Une page web peut déclarer une liste de ce que le navigateur a le droit de
  charger et de contacter. Discord en impose une aux Activities, et elle est
  très serrée : rien ne sort sans passer par un chemin balisé qu'elle contrôle.
  L'intention est saine — une Activity malveillante ne peut pas discrètement
  envoyer les données de ses joueurs ailleurs. L'effet secondaire est cruel :
  une requête refusée ne casse pas la page, elle échoue silencieusement.
]

== Le mode debug dans l'iframe <debug>

Corollaire direct du récit précédent : sans console, une erreur JavaScript dans
Discord est totalement invisible. Le jeu attrape donc lui-même les erreurs non
rattrapées et les promesses rejetées, et les affiche dans un bandeau rouge en
bas de l'écran, refermable d'un clic. C'est une dizaine de lignes, et c'est ce
qui a rendu le débogage dans Discord possible.

#capture(
  "bandeau-erreur",
  [Le bandeau d'erreurs. Il n'existe que parce que la console n'existe pas :
    dans le client Discord, c'est le seul canal de diagnostic disponible.],
  hauteur: 3cm,
)

Pour une vraie console, il reste un chemin : ouvrir Discord *au navigateur* et
lancer l'activité de là. Les outils de développement sont alors ceux du
navigateur, sur l'iframe.

== La sécurité

La passe de sécurité a porté sur cinq fronts distincts, tous menés après que
l'application ait été jouable — et c'est précisément ce qui a permis de les
traiter comme des frontières plutôt que comme des rustines.

/ La frontière d'identité : le jeton doit avoir été émis pour *cette*
  application, pas seulement être un jeton Discord valide.
/ Les plafonds de requêtes : posés dans l'extracteur d'identité lui-même, donc
  un endpoint authentifié ajouté demain est couvert sans qu'on écrive une ligne.
  Le proxy de citations en a un second, plus serré, parce qu'il consomme un
  quota mensuel partagé. Un dépassement répond explicitement, il ne coupe pas
  la connexion en silence.
/ Les en-têtes de réponse : politique de sécurité de contenu, refus du
  reniflage de type, pas de référent. Avec une exception assumée et nommée —
  l'encadrement par Discord *doit* rester autorisé, l'Activity n'étant qu'une
  iframe ; durcir ce point-là rendrait le jeu invisible.
/ Les entrées venues du réseau : le pseudo est tronqué, le hash d'avatar validé
  et jeté s'il ne correspond pas au format attendu. On ne transporte jamais
  d'URL d'avatar — une URL fournie par un client serait une adresse arbitraire
  chargée dans le navigateur des sept autres.
/ La frontière de confiance de la course : le sujet du récit ci-dessous, et de
  la @confiance.

#recit(
  [Un « j'ai fini » partiel gagnait la course],
  probleme: [Le message de fin de course était cru sur parole. Trois caractères
    tapés très vite suffisaient donc à annoncer une arrivée : la durée était
    minuscule, la vitesse calculée absurde — de l'ordre de 800 mots par
    minute — et le joueur prenait la première place.],
  decision: [Rejouer le journal de frappe côté serveur contre *son* texte et
    vérifier qu'il atteint réellement la fin, avant d'enregistrer quoi que ce
    soit. Une fin non confirmée n'est pas rejetée en silence : elle est
    enregistrée comme un abandon, le seul verdict à la fois vrai et débloquant
    pour les autres.],
  resultat: [Ce n'était pas un correctif isolé mais l'entrée d'une frontière de
    confiance entière à reconstruire, poursuivie sur plusieurs issues : quels
    champs le client a-t-il le droit d'affirmer, lesquels ne font qu'*arrêter*
    quelque chose, et lesquels le serveur possède seul. La règle qui en est
    sortie tient en une phrase — une déclaration du client peut arrêter une
    course, jamais la gagner (issues #160, #163, #164, puis #186).],
)

== Le pipeline d'assets et la Rich Presence <assets>

Les assets visuels du projet ne sont pas des images dessinées dans un éditeur :
ce sont des *programmes*. Une bibliothèque de composants vectoriels — la
voiture, le clavier, le sol de lave, les feux de départ, le wordmark — est
écrite en Typst, et chaque asset est un petit fichier qui l'importe, pose sa
page et compose sa scène. Un script régénère l'ensemble d'une commande.

#schema(
  diagram(
    ..diag,
    spacing: (14mm, 9mm),
    node((0, 0), [`composants.typ`\ #text(7pt)[voiture, clavier, lave,\ feux,
      wordmark]], ..cle),
    node((0, 1), [`app-icon.typ`\ `cover.typ`\ `background.typ`\ `icone.typ`]),
    node((1, 1), [`build.sh`\ #text(7pt)[`--ppi 72`]], ..cle),
    node((2, 1), [`out/*.png`\ #text(7pt)[12 fichiers committés]]),
    node((3, 0), [portail Discord\ #text(7pt)[icône, cover, overlay]]),
    node((3, 1), [clés d'asset\ #text(7pt)[Rich Presence]], ..cle),
    node((3, 2), [épreuves\ #text(7pt)[non publiées]]),

    edge((0, 0), (0, 1), "->", [importé par]),
    edge((0, 1), (1, 1), "->"),
    edge((1, 1), (2, 1), "->"),
    edge((2, 1), (3, 0), "->"),
    edge((2, 1), (3, 1), "->"),
    edge((2, 1), (3, 2), "->"),
  ),
  [Le pipeline d'assets. Le point à retenir est à droite : *le nom du fichier
    EST la clé d'asset* que le code demande à Discord. Renommer un PNG ne casse
    rien à la compilation — l'état correspondant perd simplement son visuel,
    silencieusement.],
)

Deux règles ont été posées d'emblée, et elles se justifient l'une l'autre. La
première : la page est déclarée en points et l'export forcé à 72 pixels par
pouce, ce qui fait qu'un point vaut exactement un pixel — sans quoi le réglage
par défaut livre le double des dimensions demandées, ce qui ne se remarque
qu'au téléversement. La seconde : le générateur pseudo-aléatoire qui dessine la
croûte de basalte du sol de lave est *déterministe*. Deux exécutions du script
produisent des PNG identiques au bit près ; sans cela, chaque régénération
salirait le diff des images committées.

#visuel(
  "voiture-1024.png",
  [La voiture, composant central. Une seule silhouette fermée plutôt qu'un
    assemblage de rectangles : à 48 pixels dans l'étagère Discord, il ne reste
    que le contour, et un contour unique y survit là où une pile de formes se
    brouille.],
  largeur: 54%,
)

// Rangées d'images : normalisées en HAUTEUR, pas en largeur. Les assets n'ont
// pas la même proportion (1:1 pour l'icône, 16:9 pour la cover), et les caler
// sur une largeur commune produit une rangée en escalier.
#align(center)[
  #grid(
    columns: (auto, auto),
    column-gutter: 1.6em,
    align: top,
    visuel(
      "composant.png",
      [L'épreuve de contrôle, agrandie ici pour être lisible : elle ne fait que
        48 pixels de côté. C'est à cette taille que l'icône apparaît dans
        l'étagère Discord, et c'est elle qui a décidé de chaque détail — le
        pavillon épais, les trois disques par roue, le nez biseauté.],
      hauteur: 4.4cm,
    ),
    visuel(
      "composition-demo.png",
      [Voiture et clavier partagent leur ligne de sol : la voiture roule
        littéralement sur les touches, sans aucune translation à écrire. C'est
        la métaphore du jeu — taper est ce qui la fait avancer.],
      hauteur: 6.6cm,
    ),
  )
]

#align(center)[
  #grid(
    columns: (auto, auto, auto),
    column-gutter: 1.2em,
    align: top,
    visuel("app-icon.png", [Icône d'application.], hauteur: 2.4cm),
    visuel("cover.png", [Cover de l'étagère.], hauteur: 2.4cm),
    visuel("background.png", [Overlay de la grille.], hauteur: 2.4cm),
  )
]

Côté Rich Presence, le jeu pousse à Discord un état à chaque transition — menu,
entraînement, salon, course — et Discord l'affiche aux autres membres du salon
vocal. Le grand visuel change avec l'état, le petit reste l'icône de
l'application. Un détail a été tranché en cours de route : dans un salon
d'attente, c'est le visuel du *Mode de jeu choisi* qui s'affiche, pas une image
d'attente générique — ce qu'on est sur le point de jouer intéresse davantage le
lecteur que le fait qu'on attende. L'image « salon » reste donc dans le dossier,
sans emploi.

#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 0.8em,
  row-gutter: 0.6em,
  align: top,
  visuel("menu.png", [`menu`], largeur: 100%),
  visuel("practice.png", [`practice`], largeur: 100%),
  visuel("race.png", [`race`], largeur: 100%),
  visuel("floor-is-lava.png", [`floor-is-lava`], largeur: 100%),
  visuel("spam.png", [`spam`], largeur: 100%),
  visuel("lobby.png", [`lobby` — produit, plus envoyé], largeur: 100%),
)

== Le graphe de résultats, sans bibliothèque <graphe>

Le graphe seconde par seconde de l'écran de résultats reposait au départ sur une
bibliothèque de graphiques. Elle a été retirée du projet et remplacée par un SVG
construit à la main. Le raisonnement n'était pas la performance mais la
proportion : le projet affiche *une* courbe, avec deux séries et une échelle
fixée par le domaine. Le coût d'une dépendance qui sait tout dessiner —
son poids dans le bundle, ses avis de sécurité à surveiller, sa version
majeure à suivre — n'était pas payé par ce qu'on en utilisait.

== La chaîne d'intégration et le déploiement

Trois travaux, dont deux tournent à chaque poussée et le troisième seulement
sur la branche principale.

#schema(
  diagram(
    ..diag,
    spacing: (16mm, 8mm),
    node((0, 0.5), [poussée /\ pull request]),
    node((1, 0), [*frontend*\ #text(7pt)[audit · lint\ tests · build]], ..cle),
    node((1, 1), [*backend*\ #text(7pt)[audit RustSec\ clippy · tests]], ..cle),
    node((2, 0.5), [garde de\ publication\ #text(7pt)[version déjà\ publiée ?]]),
    node((3, 0.5), [*release*\ #text(7pt)[build musl statique\ notes du CHANGELOG\
      archive + `DEPLOY.md`]], ..cle),

    edge((0, 0.5), (1, 0), "->"),
    edge((0, 0.5), (1, 1), "->"),
    edge((1, 0), (2, 0.5), "->"),
    edge((1, 1), (2, 0.5), "->"),
    edge((2, 0.5), (3, 0.5), "->", [oui]),
    node(
      (2, 1.5),
      text(7.5pt)[sortie silencieuse\ #text(7pt)[la CI reste verte]],
      stroke: none,
      fill: none,
    ),
    edge((2, 0.5), (2, 1.5), "->", [non]),
  ),
  [La chaîne d'intégration. Le travail de publication *dépend* des deux autres,
    ce qui rend mécaniquement impossible de publier avec un test rouge — et
    c'est la raison pour laquelle il vit dans le même fichier plutôt que dans un
    workflow séparé.],
)

La garde de publication lit la version du manifeste et la compare aux versions
déjà publiées. Elle ne lit pas les étiquettes de version posées sur le dépôt :
pousser une branche et pousser une étiquette sont deux événements sans ordre
garanti entre eux, et une garde fondée là-dessus raterait une publication une
fois sur deux, silencieusement.

La branche principale bouge pour deux raisons — de vraies versions, mais aussi
des fusions de section et des poussées de documentation. Sur ces dernières, la
version n'a pas changé : le travail sort alors sans rien faire et sans échouer.
Le faire échouer en rouge apprendrait à ignorer la couleur de la CI.

#recit(
  [Les gardes du travail de publication],
  probleme: [Le premier jet demandait à l'outil GitHub si la version était déjà
    publiée, *à l'intérieur d'une condition*. Deux pièges s'y superposaient. Le
    premier : dans une condition shell, l'arrêt automatique sur erreur est
    suspendu — une panne réseau, un quota ou un souci d'authentification se
    lisait donc « pas de release », et la publication partait. Le second : le
    titre de la version venait du fichier de notes et était interpolé
    directement dans la ligne de commande, où une paire de backquotes se serait
    *exécutée*. Ce n'était pas théorique : le fichier de notes du projet donne
    lui-même en exemple un titre contenant des backquotes.],
  decision: [Sortir l'appel réseau de la condition pour qu'un échec fasse
    honnêtement échouer le travail, lister les versions publiées plutôt que
    d'interroger l'une d'elles — un code de retour non nul ne distingue pas un
    « absent » d'une panne — et faire passer le titre par l'environnement, où
    aucun shell ne le relit.],
  resultat: [Deux classes de bugs qui ne se seraient manifestées qu'en
    production : une publication de travers un jour de panne réseau, et une
    exécution de commande arbitraire déclenchée par un fichier de notes. Aucune
    des deux n'aurait été attrapée par un test.],
)

#en-clair([Un binaire « statique »])[
  Un programme compilé va normalement chercher au démarrage des bibliothèques
  déjà installées sur la machine. Si celle-ci en a une version plus ancienne
  que la machine qui a compilé, il refuse de démarrer — et on ne s'en aperçoit
  qu'au déploiement. Un binaire statique emporte tout avec lui : c'est un seul
  fichier qu'on dépose sur n'importe quel Linux et qui démarre. Le projet peut
  se le permettre parce qu'il n'utilise aucune bibliothèque système — sa base
  de données est compilée dedans, et son chiffrement est écrit en Rust.
]

L'archive publiée contient le binaire, le build du frontend, et une notice de
déploiement générée. Cette notice insiste sur un point : le serveur écoute
*volontairement* sur la boucle locale et non sur le réseau. Il est injoignable
depuis une autre machine, parce que le mode de déploiement du projet est un
tunnel qui tourne sur le même hôte. Exposer directement sur Internet demande un
proxy inverse devant, et c'est un choix à poser explicitement.

#capture(
  "ci-jobs",
  [Les trois travaux verts sur une poussée. Le troisième n'apparaît que sur la
    branche principale.],
  hauteur: 3.2cm,
)

#capture(
  "release",
  [Une version publiée avec son archive. Les notes viennent du fichier de
    changements du dépôt, pas des titres de commits : une version parle au
    joueur.],
  hauteur: 3.2cm,
)

== Méthode : le modèle de domaine fait autorité sur le nommage

Le projet tient un glossaire de domaine à la racine, et ce glossaire n'est pas
documentaire : il fait *autorité*. Chaque terme y porte non seulement sa
définition mais la liste des mots interdits à sa place — « Race » interdit
`Match`, `Duel`, `Course` ; « Abandon » interdit `Quit`, `DNF`. Le code, les
issues et les messages d'interface s'y conforment.

L'intérêt s'est révélé sur les cas limites, pas sur les cas courants. Nommer
« Brûlé », « Devancé » et « Échec » comme trois états *distincts* d'abandon —
au lieu d'un seul état « perdu » à nuancer par un drapeau — a forcé à répondre à
la question qui décide vraiment de leur comportement : *qui* a mis fin à ce
Run ? Le joueur, sa propre faute, ou la comparaison aux autres ? Les cinq
sorties du diagramme de la @etats sont sorties de là,
et le type qui les porte les rend exhaustives par construction : oublier d'en
traiter une ne compile pas.

== Méthode : la parité TypeScript ↔ Rust prouvée par vecteurs <parite>

L'algorithme de score existe deux fois : en TypeScript, où il est la
*référence*, et en Rust, où il est autoritaire. Ce n'est pas une duplication
accidentelle — le navigateur en a besoin pour le compteur en direct, le serveur
en a besoin pour le verdict. Aucun générateur de types ne relie les deux : le
miroir est *manuel*, et chaque fichier porte en en-tête le nom de son
homologue.

#recit(
  [Le miroir avait dérivé, sans filet],
  probleme: [Le décompte avant le départ était réglable, et le réglage semblait
    fonctionner : la valeur se choisissait, se rediffusait, s'affichait. Mais
    les deux côtés n'étaient plus d'accord sur la valeur par défaut — le
    décompte disait sept secondes d'un côté et cinq de l'autre. Cliquer sur le
    réglage ne faisait donc *rien* de visible, et rien ne signalait l'écart :
    ni erreur, ni test rouge, ni avertissement.],
  decision: [Extraire des *vecteurs de test partagés* — des jeux d'entrée avec
    leur résultat attendu, dans un dossier à la racine — et faire lire ces mêmes
    fichiers par les deux suites de tests, celle de TypeScript et celle de Rust.],
  resultat: [Une divergence entre les deux langages devient un test rouge dans
    l'un des deux, au lieu d'un comportement silencieusement faux. C'est le seul
    filet possible pour un miroir manuel — et le prix est modeste : les vecteurs
    sont des données, pas du code.],
)

#en-clair([Un « miroir manuel » entre deux langages])[
  La même règle de calcul doit exister dans le navigateur et sur le serveur, qui
  ne parlent pas le même langage. On peut demander à un outil de traduire
  automatiquement l'un vers l'autre — c'est lourd, et l'outil devient une pièce
  du projet à entretenir. Ou on peut écrire les deux à la main et vérifier
  qu'ils disent la même chose, en leur donnant les mêmes questions et en
  comparant leurs réponses. Le projet a choisi la seconde option ; les
  « vecteurs » sont ces questions communes.
]

== Méthode : les décisions d'architecture consignées

Dix-neuf décisions sont consignées, une par fichier, dans un dossier dédié.
Chacune répond à une question qui ne se lit pas depuis le code seul : pourquoi
une Race n'a pas de Mode, pourquoi le texte cible est persisté tel quel plutôt
que régénéré depuis sa graine, pourquoi le message de fin porte les résultats et
pas seulement l'ordre. La table complète est en annexe.

Leur valeur réelle est apparue tard. Quand un fichier de réseau a atteint trois
mille trois cent soixante-et-onze lignes — le fil réseau, le salon et le moteur
de course entassés au même endroit — la décision de le découper n'a pas eu à
être redécouverte : les frontières étaient déjà nommées dans les décisions
existantes, il ne restait qu'à les rendre visibles dans l'arborescence.

#recit(
  [Un fichier de 3 371 lignes],
  probleme: [Tout le multijoueur vivait dans un seul fichier : la gestion du
    socket, l'état du salon, les réglages, et le moteur de course avec ses trois
    Modes de jeu. Ajouter un Mode de jeu revenait à toucher au même fichier que
    corriger une déconnexion — chaque chantier multijoueur entrait en collision
    avec les autres.],
  decision: [Découper selon les frontières que les décisions d'architecture
    nommaient déjà : le Mode de jeu comme table déclarée, les Réglages de salon
    avec un contrat de retour explicite, le moteur de course séparé du transport.],
  resultat: [Le découpage n'a pas été une réécriture mais une *révélation* : les
    frontières existaient dans le vocabulaire du domaine avant d'exister dans
    les fichiers. C'est l'argument le plus concret que le projet ait produit en
    faveur des deux chantiers de méthode précédents (issue #205).],
)

// -----------------------------------------------------------------------------
//  Outils propres aux sections 6 à 8
// -----------------------------------------------------------------------------

/// Arbre commenté : le chemin en chasse fixe à gauche, sa raison d'être à
/// droite. Une grille et NON un bloc de code : dans un `raw`, les commentaires
/// s'alignent à l'espace, et le premier fichier renommé décale toute la colonne.
/// Ici la colonne se réaligne seule.
#let arbre(..lignes) = block(width: 100%, breakable: true, above: 1.1em, below: 1.2em)[
  #grid(
    columns: (auto, 1fr),
    column-gutter: 1.1em,
    row-gutter: 0.45em,
    ..lignes
      .pos()
      .map(l => (
        text(font: mono, size: 8pt, fill: encre)[#l.at(0)],
        text(size: 8.5pt, fill: gris)[#l.at(1)],
      ))
      .flatten()
  )
]

= Documentation technique <technique>

Troisième et dernier point de vue : le système *à l'état final*. Les sections
précédentes racontaient une construction ; celle-ci décrit ce qui tient debout
une fois les échafaudages retirés. Elle est faite pour être lue dans le
désordre, section par section, par quelqu'un qui cherche un point précis.

== Arborescence du projet

Voici les entrées de racine qui portent la structure — le reste sont des
fichiers de projet ordinaires. La séparation qui compte est celle des deux
premières : `backend/` et `frontend/` sont deux programmes distincts, écrits
dans deux langages, et *tout le reste du document* découle de la façon dont ils
se parlent.

#arbre(
  ([backend/], [le serveur Rust : API HTTP, WebSocket, SQLite — et le service du
    build frontend, ce qui en fait l'origine unique]),
  ([frontend/], [le jeu lui-même, en TypeScript sans cadriciel : le DOM est
    manipulé directement]),
  ([design/], [les assets visuels, écrits en Typst et exportés en PNG par
    `build.sh` (@assets)]),
  ([Docs/], [ce document, les 19 ADR, le contrat d'API détaillé, les procédures
    d'agent]),
  ([test-vectors/], [les vecteurs de parité, lus par les *deux* suites de tests
    (@parite)]),
  ([Contexte/], [les notes de cadrage d'origine, gardées telles quelles — de
    l'histoire, pas de la référence]),
  ([`CONTEXT.md`], [le glossaire de domaine. Autorité sur le nommage, pas
    documentation d'appoint]),
  ([`PONYTAIL-DEBT.md`], [le registre des raccourcis délibérés, chacun avec son
    plafond et son chemin de sortie]),
)

Trois fichiers de racine ne sont pas là par goût de la paperasse : `LICENSE`,
`TERMS.md` et `PRIVACY.md` sont *exigés* par le portail développeur Discord pour
qu'une Activity puisse être publiée. Ils sont listés en @annexes.

=== `backend/src/` — le serveur

Deux sous-dossiers portent la structure. `domain/` est le domaine pur — aucune
entrée-sortie, aucun socket, aucune base : ce sont les fonctions qui *décident*.
`ws/` est le multijoueur, découpé par l'issue #205 en modules qui portent chacun
une frontière nommée — c'est le fichier de 3 371 lignes du récit précédent.

#arbre(
  ([main.rs], [le routeur Axum, les extracteurs d'authentification, les en-têtes
    de sécurité, l'écoute sur la boucle locale]),
  ([discord.rs], [l'identité et OAuth2 : échange du code, résolution du
    `player_id`, vérification de l'application émettrice]),
  ([store.rs], [la persistance SQLite. Le PB n'y a pas de table : il se dérive]),
  ([quote.rs], [le proxy vers l'API de citations. La clé ne quitte jamais le
    serveur]),
  ([rate\_limit.rs], [les plafonds de requêtes. Une seule table pour tous les
    seaux]),
  ([domain/mod.rs], [la déclaration du miroir : quel fichier Rust reflète quel
    fichier TypeScript]),
  ([domain/types.rs], [les types de domaine partagés — miroir de
    `core/types.ts`]),
  ([domain/replay.rs], [le recompute autoritaire du Scoreboard. Le cœur de la
    frontière de confiance]),
  ([domain/difficulty.rs], [la détection d'échec Expert/Master, rejouée côté
    serveur avant d'être crue]),
  ([domain/text\_gen.rs], [la génération de texte seedée. Même graine, même
    texte que le navigateur]),
  ([domain/spam.rs], [le comptage des répétitions verrouillées du Mode de jeu
    Spam]),
  ([domain/analysis.rs], [le moteur Weak spot : quelles touches coûtent le plus
    cher au joueur]),
  ([ws/mod.rs], [le *fil* : l'état partagé des Rooms, la boucle socket, le
    dispatch des messages]),
  ([ws/protocol.rs], [les 29 messages du protocole — miroir de
    `core/net.ts`]),
  ([ws/room.rs], [la Room comme *lieu* : entrer, sortir, l'hôte, le Code de
    partie]),
  ([ws/room\_setting.rs], [le Réglage de salon comme module, avec son contrat de
    retour explicite (ADR 0017)]),
  ([ws/race\_engine.rs], [le déroulé d'une course, du `StartRace` au `RaceOver`.
    Machine d'état pure]),
  ([ws/game\_mode.rs], [le seam du Mode de jeu : une table déclarée plutôt qu'un
    `match` recopié partout]),
  ([ws/tests.rs], [les tests du fil, de la Room et du moteur — sortis de
    `mod.rs` avec le reste]),
)

=== `frontend/src/` — le jeu

Même principe, une frontière de plus. `core/` est le domaine pur du client : il
ne touche jamais au DOM et c'est ce qui le rend testable sans navigateur. `ui/`
dessine, et ne décide de rien qui compte.

#arbre(
  ([main.ts], [l'amorçage : le routage entre écrans, le bandeau d'erreurs
    in-iframe]),
  ([api.ts], [la frontière HTTP. *Toutes* les requêtes passent par ici — c'est
    ce qui rend le préfixe `/.proxy` gérable en un point]),
  ([discord.ts], [le handshake d'identité côté client, et `proxyBase()` : la
    fonction qui décide du préfixe]),
  ([live-stats.ts], [le compteur de vitesse en direct. Non autoritaire, et
    assumé comme tel]),
  ([core/types.ts], [les types de domaine. La *référence* dont Rust est le
    miroir]),
  ([core/net.ts], [le transport WebSocket et les 29 messages, côté client]),
  ([core/race-state.ts], [l'état d'une Race, piloté par le serveur : une
    transition pure sur chaque `ServerEvent`]),
  ([core/run-session.ts], [une Run tapée : l'horloge, le contrôleur de saisie,
    le journal de frappe, la Difficulté]),
  ([core/clock.ts], [l'origine du temps et l'horloge monotone. `t=0` est la
    première frappe]),
  ([core/countdown.ts], [le décompte annulable, de durée réglable]),
  ([core/difficulty.ts], [la détection d'échec Expert/Master. La *référence* de
    l'algorithme]),
  ([core/learn.ts], [le moteur du cursus : le barème par tranches, le
    déverrouillage]),
  ([core/preferences.ts], [les Preferences du joueur. Ne quittent jamais
    l'appareil]),
  ([core/stats/scoreboard.ts], [le calcul du Scoreboard. La *référence* de
    l'algorithme, portée en Rust]),
  ([core/text-gen/], [la génération de texte seedée : le PRNG, la liste de mots,
    la ponctuation, les nombres, les drills]),
  ([core/input/], [les contrôleurs de saisie, derrière une interface commune]),
  ([core/sound.ts], [les effets sonores]),
  ([core/fps.ts], [la limite d'images par seconde de l'animation]),
  ([core/speed-unit.ts], [la conversion entre unités de vitesse]),
  ([ui/chrome.ts], [l'habillage qui ne change jamais d'écran]),
  ([ui/menu.ts], [le menu principal et le hub de navigation]),
  ([ui/practice.ts], [l'écran de Practice]),
  ([ui/race.ts], [l'écran de Race : la piste, les voitures, la vitesse en
    direct]),
  ([ui/lobby-rows.ts], [les Réglages de salon du lobby, déclarés puis rendus]),
  ([ui/podium.ts], [le podium et le Gap]),
  ([ui/potg.ts], [Play of the Game : le duel au ralenti sur horloge partagée]),
  ([ui/results.ts], [l'écran de résultats solo]),
  ([ui/chart.ts], [le graphe seconde par seconde, en SVG écrit à la main
    (@graphe)]),
  ([ui/replay.ts], [la relecture d'un Run depuis son Keystroke log]),
  ([ui/typing-zone.ts], [le rendu partagé de la zone de frappe — la fenêtre de
    trois lignes]),
  ([ui/learn.ts], [l'écran « Apprendre » : la liste et l'exercice]),
  ([ui/settings.ts], [l'écran Paramètres]),
  ([ui/history.ts], [l'historique des Runs]),
  ([ui/weak-spots.ts], [le rendu d'une analyse de touches faibles]),
  ([ui/guide.ts], [le guide « Comment jouer », affiché d'office la 1#super[re]
    fois]),
  ([ui/mode-labels.ts], [les libellés français des Modes — la seule couche qui
    traduise le vocabulaire de domaine]),
  ([ui/info-bubble.ts], [l'icône « i » et sa bulle d'explication, partagées par
    tous les écrans]),
  ([content/lessons.json], [les 100 leçons. Une *donnée*, pas du code]),
  ([style.css], [la feuille de style, unique. 2 312 lignes, et la palette dont
    ce PDF hérite]),
)

== Architecture générale et frontière client/serveur

Le serveur Rust a *deux* rôles, et c'est la contrainte Discord qui l'a décidé :
une Activity ne reçoit qu'un seul URL Mapping, donc une seule origine. Un
serveur pour l'interface et un autre pour l'API auraient demandé deux adresses.
Le binaire sert donc le build Vite en fichiers statiques *et* expose l'API sur
la même origine.

#schema(
  diagram(
    ..diag,
    spacing: (15mm, 9mm),
    node((0, 1), [*iframe Discord*\ #text(7pt)[le jeu, TypeScript]], ..cle),
    node((1, 1), [proxy Discord\ #text(7pt)[préfixe `/.proxy`]]),
    node(
      (2, 1),
      [*binaire Rust*\ #text(7pt)[origine unique\ écoute `127.0.0.1`]],
      ..cle,
    ),
    node((3, 0), [`ServeDir`\ #text(7pt)[le build Vite]]),
    // Les routes sont centrées SUR leurs trois sorties (0.8 / 1.8 / 2.8) : un
    // éventail depuis le milieu ne croise rien, là où un départ en haut ou en
    // bas fait passer un trait par-dessus une boîte voisine.
    node((3, 1.8), [routes API\ #text(7pt)[`/api/…`, `/token`, `/ws`]]),
    node((4, 0.8), [SQLite\ #text(7pt)[fichier local]]),
    node((4, 1.8), [API de citations\ #text(7pt)[quota mensuel]]),
    node((4, 2.8), [API Discord\ #text(7pt)[identité]]),

    edge((0, 1), (1, 1), "->"),
    edge((1, 1), (2, 1), "->"),
    edge((2, 1), (3, 0), "->", [rôle 1]),
    edge((2, 1), (3, 1.8), "->", [rôle 2]),
    edge((3, 1.8), (4, 0.8), "->"),
    edge((3, 1.8), (4, 1.8), "->"),
    edge((3, 1.8), (4, 2.8), "->"),
  ),
  [L'architecture globale. Le binaire n'écoute *pas* sur le réseau mais sur la
    boucle locale : c'est un tunnel qui tourne sur le même hôte qui l'expose.
    Les trois flèches de droite sont les seules sorties du serveur — la base est
    un fichier, pas un service.],
)

Côté modules, la frontière qui structure tout est celle du *domaine pur*. Des
deux côtés de la ligne réseau, on trouve le même dessin : un noyau qui ne
connaît ni le DOM ni les sockets, et une couche qui l'utilise.

#schema(
  diagram(
    ..diag,
    spacing: (17mm, 8mm),
    node((0, 0), [`frontend/src/ui/`\ #text(7pt)[dessine, ne décide pas]]),
    node((0, 1), [*`frontend/src/core/`*\ #text(7pt)[domaine pur — RÉFÉRENCE]], ..cle),
    node((2, 0), [`backend/src/ws/`\ #text(7pt)[sockets, Rooms, dispatch]]),
    node((2, 1), [*`backend/src/domain/`*\ #text(7pt)[domaine pur — AUTORITAIRE]], ..cle),
    node((1, 2), [`test-vectors/`\ #text(7pt)[3 fichiers de données]], ..cle),

    edge((0, 0), (0, 1), "->"),
    edge((2, 0), (2, 1), "->"),
    edge((0, 1), (2, 1), "<->", [miroir *manuel*], dash: "dashed"),
    edge((0, 1), (1, 2), "->", dash: "dotted"),
    edge((2, 1), (1, 2), "->", dash: "dotted"),
  ),
  [La carte des modules. La ligne pointillée horizontale est le miroir manuel :
    aucun générateur ne relie les deux domaines, chaque fichier nomme son
    homologue en en-tête. Les deux pointillés du bas sont le seul filet — les
    mêmes fichiers de vecteurs, lus par `vitest` et par `cargo test`.],
)

Ce que la frontière réseau tranche, en une phrase : le client *possède* ce que
le joueur voit et règle pour lui-même ; le serveur possède tout ce qui classe,
compte ou persiste. Les deux détails qui font la différence : le client ne
reçoit jamais la graine sans le texte qui en découle, et il ne renvoie jamais le
texte au serveur.

== Le protocole WebSocket <websocket>

=== Pourquoi un WebSocket, et pas des requêtes

Le critère n'est pas la vitesse mais la *direction*. Trois messages du serveur
n'ont aucune requête client qui puisse leur correspondre : `RaceStart` tombe
quand l'hôte lance la partie, `PlayerBurned` quand le métronome de Floor is lava
bat, `SpamStop` quand un plafond de temps expire. Aucun de ces trois-là n'est la
*réponse* à quoi que ce soit. Avec des requêtes, le client devrait redemander
« du nouveau ? » en boucle, et un décompte partagé à la seconde près exigerait
de redemander plusieurs fois par seconde, à huit joueurs, pendant toute la
partie.

#en-clair([WebSocket contre requête HTTP])[
  Une requête ordinaire, c'est le client qui pose une question et le serveur qui
  répond : le serveur ne peut jamais parler le premier. Pour savoir si la course
  a démarré, le navigateur devrait redemander sans arrêt, et l'information
  arriverait toujours avec un peu de retard. Un WebSocket est une ligne qui
  reste *ouverte* dans les deux sens pendant toute la partie : le serveur envoie
  quand il a quelque chose à dire, et personne n'a besoin de redemander.
]

=== Les 29 messages

Vingt messages montent du client, neuf descendent du serveur. Ils sont
sérialisés en JSON avec une étiquette de type, et la même liste existe en
TypeScript dans `core/net.ts` — c'est encore le miroir manuel.

#figure(
  table(
    columns: (auto, 1fr, auto),
    align: (left + top, left + top, left + top),
    table.header([Message], [Rôle], [Qui peut]),

    [`JoinChannel`], [Rejoindre la Room du salon vocal, en la *créant* si besoin.
      La clé vient du SDK Discord : elle ne peut pas être mal tapée.], [tous],
    [`CreateRoom`], [Ouvrir une Room neuve. Le serveur tire le Code de partie et
      le renvoie dans le `RoomState` qui suit.], [tous],
    [`JoinCode`], [Rejoindre par Code. Ne crée *jamais* : un code vient d'un
      clavier, et créer sur une faute de frappe enfermerait le joueur seul.], [tous],
    [`SetTextSource`], [Régler d'où vient le texte. Déclenche la
      regénération.], [hôte, hors course],
    [`SetMaxPlayers`], [Taille maximale (2–8). Ne porte que sur les arrivées :
      personne n'est expulsé.], [hôte, hors course],
    [`SetCountdown`], [Durée du décompte : 3, 5, 7 ou 10 s.], [hôte, hors course],
    [`SetReadyCheck`], [Activer le ready-check. Réinitialise les prêts déjà
      marqués.], [hôte, hors course],
    [`SetReady`], [Se marquer prêt. Le seul réglage que *tout le monde* peut
      poser — il ne porte que sur soi.], [tous, hors course],
    [`SetDifficulty`], [Normal ou Master. `Expert` n'est pas un Réglage de
      salon : sa condition de déclenchement est inatteignable en Race.], [hôte, hors course],
    [`SetGameMode`], [Normal, Floor is lava ou Spam. Regénère le texte : chaque
      mode impose le sien.], [hôte, hors course],
    [`SetLavaInterval`], [Intervalle d'élimination, parmi 5/10/15/20 s. Inerte
      hors Floor is lava.], [hôte, hors course],
    [`SetSpamWord`], [Le mot répété. Validé côté serveur : non vide, sans
      espace, 20 caractères au plus — un espace ferait de « un mot répété »
      plusieurs mots cibles.], [hôte, hors course],
    [`SetSpamThreshold`], [Le seuil de répétitions qui gagne, parmi
      10/20/30/50.], [hôte, hors course],
    [`SetSpamTimeCap`], [Le plafond de temps de Spam, 60 s au plus.], [hôte, hors course],
    [`StartRace`], [Lancer la course.], [hôte],
    [`Progress`], [Position de frappe, et le compte de répétitions sous Spam.
      *Déclaratif* : sert au rendu des voitures, jamais au classement.], [partants],
    [`Finish`], [La soumission : le journal de frappe brut et l'instant de fin.
      Ni le texte ni la durée de référence — le serveur les possède.], [partants],
    [`Forfeit`], [Abandon volontaire. Le joueur reste au lobby pour la
      suivante.], [partants],
    [`Fail`], [Échec Master détecté localement. Le serveur *rejoue* le journal
      pour le confirmer avant de l'enregistrer.], [partants],
    [`LeaveRoom`], [Quitter la Room.], [tous],
  ),
  caption: [Les vingt messages `ClientEvent`. La colonne de droite n'est pas une
    convention d'interface : un message hors droits est ignoré côté serveur, en
    silence. Un client modifié ne gagne rien à l'envoyer quand même.],
)

#figure(
  table(
    columns: (auto, 1fr, auto),
    align: (left + top, left + top, left + top),
    table.header([Message], [Rôle], [À qui]),

    [`RoomState`], [L'état complet du salon : les présents avec leur identité
      d'affichage, l'hôte, la graine, le texte, le Code, et les dix réglages.
      Rediffusé à chaque changement.], [toute la Room],
    [`RaceStart`], [Le top de départ : un instant absolu partagé, qui cale les
      horloges locales de tout le monde sur le même `t=0`.], [toute la Room],
    [`PlayerProgress`], [La position d'un joueur, pour le rendu de sa voiture.],
    [toute la Room],
    [`PlayerFinished`], [Le scoreboard recalculé d'un arrivant. Distingue une
      vraie arrivée, un abandon et un échec Master.], [toute la Room],
    [`PlayerBurned`], [Ce joueur vient de brûler. C'est ce message qui lui
      demande son journal et lui dit d'arrêter de taper.], [*un seul joueur*],
    [`SpamStop`], [La course Spam s'arrête. Un seul message pour les deux
      causes, et il ne désigne *aucun* vainqueur.], [toute la Room],
    [`RaceOver`], [Le classement complet, avec les courbes de chacun et le duel
      de Play of the Game. L'ordre du tableau *est* le classement.], [toute la Room],
    [`RoomNotFound`], [Code inconnu. Le socket reste ouvert : le joueur corrige
      sans se reconnecter.], [*le socket demandeur*],
    [`RoomFull`], [Room déjà pleine. Même traitement.], [*le socket demandeur*],
  ),
  caption: [Les neuf messages `ServerEvent`. La colonne de droite est le
    fan-out, et il a trois valeurs distinctes — c'est ce qui distingue une
    diffusion d'un message privé et d'une réponse.],
)

=== La frontière de confiance

Le partage est le même à chaque fois : le serveur possède la graine, le texte et
`t=0` ; le client possède ce qu'il a tapé. Un client peut donc *décrire* sa
frappe, jamais son résultat.

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([Le client peut…], [Détail]),

    [affirmer], [son journal de frappe, son identité d'affichage, ses réglages
      s'il est l'hôte. Tout est assaini ou rejoué avant d'être utilisé.],
    [*arrêter*, jamais gagner], [`Progress.reps` peut déclencher l'arrêt d'une
      course Spam, et une fin annoncée peut débloquer les autres. Ni l'un ni
      l'autre n'attribue une place.],
    [ne jamais toucher], [la graine, le texte cible, l'instant de départ, la
      durée de référence, le classement, le verdict de record.],
  ),
  caption: [La règle tient en une phrase, et c'est celle qui est sortie de
    l'issue #160 : une déclaration du client peut arrêter une course, jamais la
    gagner.],
)

=== Les trois portes d'entrée

Elles ont l'air interchangeables et ne le sont pas. `JoinChannel` crée à la
volée, parce que sa clé est un identifiant de salon fourni par Discord : elle
est authentique par construction. `CreateRoom` fait tirer un code par le
serveur. `JoinCode` ne crée jamais, parce que sa clé vient d'un clavier humain :
créer sur une faute de frappe donnerait une Room fantôme où le joueur attendrait
seul, en croyant avoir rejoint ses amis.

=== Les garde-fous

/ Taille des messages : bornée à 256 Ko. Sans borne, la limite par défaut est de
  64 Mio, et un `Finish` géant se recompute *sous le verrou global des Rooms* —
  une seule requête suffirait à figer toutes les parties du serveur.
/ Connexions : 20 par joueur et par minute. Ce sont les connexions qui sont
  comptées, pas les messages : chacune coûte une résolution d'identité auprès de
  Discord et une place dans la Room.
/ Identité : assainie à l'entrée. Le nom perd ses caractères de contrôle et est
  tronqué ; le hash d'avatar est *jeté* s'il sort de `[0-9a-f_]`. On ne
  transporte jamais d'URL d'avatar — une URL fournie par un client serait une
  adresse arbitraire chargée dans le navigateur des sept autres.

L'assainissement de l'identité ne protège pas d'une injection : le rendu échappe
déjà le HTML. Il protège du fait qu'un nom démesuré dégrade l'écran *des
autres*.

=== L'autorisation est la connexion

Le jeton est présenté une seule fois, dans l'URL du WebSocket, avant même que la
connexion ne s'établisse — l'API WebSocket du navigateur ne permet pas d'en-tête
`Authorization`. Une fois la connexion ouverte, elle *est* la preuve d'identité :
il n'y a plus rien à vérifier message par message.

C'est ce qui permet à `RaceOver` de porter tous les résultats d'un coup, courbes
comprises, sans aucun aller-retour (ADR 0010). L'alternative — un endpoint qui
servirait le détail d'un joueur à la demande — buterait sur un mur : la
composition d'une course vit en mémoire et meurt avec la Room, donc le serveur
ne pourrait pas vérifier après coup que le demandeur en faisait partie. Sur le
socket, la question ne se pose pas.

Enfin, dans l'iframe, l'adresse du socket passe par le préfixe `/.proxy`, comme
toute autre requête. C'est la même fonction qui décide du préfixe pour les
quatre points d'accès réseau du projet.

=== Une Race normale, de bout en bout

#sequence(
  chronos.diagram({
    import chronos: *
    _par("c1", display-name: "Joueur (hôte)", color: corail.lighten(70%))
    _par("c2", display-name: "Joueur", color: corail.lighten(70%))
    _par("srv", display-name: "Backend Rust", color: corail.lighten(70%))

    _seq("c1", "srv", comment: "JoinChannel / CreateRoom")
    _seq("srv", "c1", comment: "RoomState", dashed: true)
    _seq("srv", "c2", comment: "RoomState (rediffusé)", dashed: true)
    _seq("c1", "srv", comment: "StartRace")
    _seq("srv", "c1", comment: "RaceStart (t=0 partagé)", dashed: true)
    _seq("srv", "c2", comment: "RaceStart", dashed: true)
    _loop("pendant la frappe", {
      _seq("c2", "srv", comment: "Progress { charsDone }")
      _seq("srv", "c1", comment: "PlayerProgress", dashed: true)
    })
    _seq("c2", "srv", comment: "Finish { keystrokes, endedAtMs }")
    _note(
      "right",
      [Recompute autoritaire :\ le journal est rejoué contre\ LE texte du
        serveur.],
      pos: "srv",
      color: papier-doux,
    )
    _seq("srv", "c1", comment: "PlayerFinished", dashed: true)
    _seq("c1", "srv", comment: "Finish")
    _seq("srv", "c1", comment: "RaceOver { results, playOfTheGame }", dashed: true)
    _seq("srv", "c2", comment: "RaceOver", dashed: true)
  }),
  [Une Race normale. Le `RaceOver` ne part qu'une fois le *dernier* journal
    attendu arrivé — c'est pourquoi un abandon débloque les autres au lieu de les
    faire patienter jusqu'au watchdog. Les deux `Finish` sont recomputés
    séparément ; le classement, lui, se décide en une seule fois.],
)

=== Floor is lava

#sequence(
  chronos.diagram({
    import chronos: *
    _par("j", display-name: "Joueurs", color: corail.lighten(70%))
    _par("srv", display-name: "Backend Rust", color: corail.lighten(70%))
    _par("wd", display-name: "Watchdog", color: papier-doux)

    _seq("srv", "j", comment: "RaceStart (t=0)", dashed: true)
    _loop("à chaque intervalle réglé", {
      _seq("wd", "srv", comment: "tic")
      _note(
        "left",
        [Le moins avancé brûle.\ Égalité : TOUS les ex æquo\ brûlent — départager
          sur\ l'ordre des paquets serait\ un tirage au sort invisible.],
        pos: "srv",
        color: papier-doux,
      )
      _seq("srv", "j", comment: "PlayerBurned { playerId, atMs }", dashed: true)
      _seq("j", "srv", comment: "Finish (journal du brûlé)")
    })
    _seq("srv", "j", comment: "RaceOver — classement = ordre des morts, inversé", dashed: true)
  }),
  [Floor is lava. Le métronome part au *signal de départ partagé* et non à la
    création de la course : sinon le premier battement tomberait pendant le
    décompte, où personne n'a encore tapé — tout le monde est dernier, tout le
    monde brûle (issue #159). La course s'arrête à un vivant ; à zéro vivant, une
    égalité finale a emporté les deux derniers et il n'y a pas de vainqueur.],
)

Le brûlé renvoie tout de même son journal, et le serveur le recompute : un joueur
éliminé porte un *vrai score partiel*, calculé sur ce qu'il a eu le temps de
taper. Ce score ne le classe jamais — seul l'instant de sa mort le classe — mais
il s'affiche, et il sert à choisir le duel d'après-course.

== Le contrat HTTP

Dix routes déclarées. Tout ce qui n'en atteint aucune part au service de
fichiers statiques, puis à `index.html` : c'est ce qui fait qu'un serveur unique
peut porter l'interface *et* l'API sans que le routage ait à trancher entre les
deux. Les corps de requête et de réponse ne sont pas ici — ils vivent dans
#link("API.md")[`Docs/API.md`], et les recopier garantirait que les deux
versions divergent.

#figure(
  table(
    columns: (auto, auto, 1fr, auto),
    align: (left + top, left + top, left + top, left + top),
    table.header([Méthode], [Chemin], [Rôle], [Authentification]),

    [`GET`], [`/api/health`], [Sonde de vie.], [aucune],
    [`POST`], [`/token`], [Échange le code OAuth2 contre un jeton d'accès. Le
      secret client ne quitte jamais le serveur.], [aucune, plafond global],
    [`GET`], [`/api/quote`], [Proxy vers l'API de citations. La clé est injectée
      côté serveur.], [Bearer + plafond serré],
    [`POST`], [`/api/runs`], [Soumission d'un Run solo : recompute, persistance,
      verdict de record.], [Bearer],
    [`GET`], [`/api/runs/:id`], [Un Run complet pour le Replay. 404
      indistinctement : inconnu, à un autre, ou non rejouable.], [Bearer],
    [`GET`], [`/api/runs/:id/analysis`], [Les touches faibles d'un Run.],
    [Bearer],
    [`GET`], [`/api/profile/analysis`], [Les touches faibles sur les derniers
      Runs du joueur.], [Bearer],
    [`GET`], [`/api/history`], [L'historique des Runs du joueur.], [Bearer],
    [`GET` `POST`], [`/api/learn/progress`], [Lire et avancer la progression du
      cursus. L'écriture conserve le *maximum*, jamais la dernière valeur reçue.],
    [Bearer],
    [`GET`], [`/ws`], [La Race entière. Jeton dans l'URL, faute d'en-tête
      possible.], [`?token=` + plafond],
  ),
  caption: [Le contrat HTTP. Le `404` indistinct de `/api/runs/:id` est
    délibéré : distinguer « ce Run n'existe pas » de « ce Run n'est pas à vous »
    dirait à un curieux lesquels de ses identifiants devinés sont bons.],
)

Un détail vaut d'être noté, parce qu'il se paie une fois et rapporte
indéfiniment : le plafond de requêtes n'est pas posé dans chaque handler mais
dans *l'extracteur d'identité* que tous les endpoints authentifiés traversent.
Un endpoint ajouté demain est couvert sans qu'on écrive une ligne — et surtout
sans qu'on puisse oublier de l'écrire.

== Persistance

Deux tables, et le record personnel n'en a aucune.

#schema(
  diagram(
    ..diag,
    spacing: (17mm, 10mm),
    node(
      (0, 0),
      align(left)[
        *`runs`*\
        #text(7pt)[`id`, `player_id`, `created_at`\
          `mode`, `mode_value`, `language`,\
          `punctuation`, `numbers` #text(6.5pt)[← bucket]\
          `wpm`, `raw`, `accuracy`, `chars_*`\
          `duration_ms`, `per_second`\
          `keystroke_log`, `target_text`\
          `kind`, `pb_eligible`]
      ],
      ..cle,
    ),
    node(
      (1.15, 0),
      align(left)[
        *PB*\
        #text(7pt)[`MAX(wpm)`\ `GROUP BY` bucket\
          `WHERE pb_eligible = 1`]
      ],
      stroke: (dash: "dashed", paint: accent-encre, thickness: 0.8pt),
    ),
    node(
      (0, 1),
      align(left)[
        *`learn_progress`*\
        #text(7pt)[`player_id`, `completed`, `updated_at`]
      ],
      ..cle,
    ),
    edge((0, 0), (1.15, 0), "->", [dérivé], dash: "dashed"),
  ),
  [Le schéma. Le PB est encadré en pointillés parce qu'il n'*existe* pas : c'est
    une requête, pas une ligne. Un record ne peut donc jamais désigner un Run qui
    n'est plus là, ni survivre à une règle d'éligibilité qui change.],
)

Le *Config bucket* — les cinq colonnes du milieu — est ce qui rend deux Runs
comparables. Un record de 60 s avec ponctuation n'a rien à voir avec un record de
15 mots sans : ils ne sont pas dans le même seau, et le `GROUP BY` le dit sans
qu'aucune règle ait à être écrite ailleurs.

Les six migrations racontent, dans l'ordre, ce que le projet a appris :

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([Migration], [Ce qu'elle a changé, et pourquoi]),

    [0001], [Le schéma initial : la table `runs` et ses deux index. Le PB est
      dérivé dès le premier jour.],
    [0002], [Le journal de frappe et la provenance du Run sont persistés — la
      matière première du Replay et de l'analyse.],
    [0003], [Le texte cible est persisté *verbatim* (ADR 0001) : une citation ne
      se régénère pas depuis une graine, et l'algorithme de génération peut
      changer. Un Replay doit rejouer le texte d'alors, pas celui d'aujourd'hui.],
    [0004], [La progression du cursus, une ligne par joueur. Un exercice de leçon
      n'entre jamais dans `runs`.],
    [0005], [Les Quotes cessent d'être éligibles au record (ADR 0003) : leur
      longueur varie d'un Run à l'autre sans que le bucket le capture, ce qui
      rendait les comparaisons fausses. Les Runs déjà en base sont corrigés.],
    [0006], [Le solo perd son décompte de 3 s (ADR 0004) : `t=0` passe à la
      première frappe. Ce n'est pas un changement d'interface mais *d'unité de
      mesure* — les vitesses d'avant ne sont plus comparables, donc tous les
      records existants sont remis à zéro.],
  ),
  caption: [Les six migrations. Les deux dernières ne touchent aucune colonne :
    elles corrigent des données devenues fausses. C'est le genre de correction
    qu'une table de records dédiée aurait rendue bien plus pénible.],
)

#sequence(
  chronos.diagram({
    import chronos: *
    _par("ui", display-name: "Écran de Practice", color: corail.lighten(70%))
    _par("srv", display-name: "Backend Rust", color: corail.lighten(70%))
    _par("db", display-name: "SQLite", shape: "database", color: papier-doux)

    _seq("ui", "ui", comment: "keystroke log (touche + instant)")
    _seq("ui", "srv", comment: "POST /api/runs { config, targetText, keystrokes }")
    _note(
      "right",
      [Rejeu du journal → Scoreboard\ autoritaire. La durée n'est PAS\ celle
        annoncée par le client.],
      pos: "srv",
      color: papier-doux,
    )
    _seq("srv", "db", comment: "SELECT MAX(wpm) … (PB du bucket, AVANT insertion)")
    _seq("db", "srv", comment: "PB précédent", dashed: true)
    _seq("srv", "db", comment: "INSERT INTO runs (+ log + texte verbatim)")
    _seq("srv", "ui", comment: "{ scoreboard, isPersonalBest, previousPbWpm }", dashed: true)
  }),
  [La soumission d'un Run solo. L'ordre compte : le PB précédent est lu *avant*
    l'insertion, sinon le Run qu'on vient d'écrire serait son propre record à
    battre et aucun record ne serait jamais annoncé.],
)

== Sécurité et frontière de confiance <confiance>

Le récit de la @realisation raconte comment cette frontière a été découverte.
Voici son état final, en cinq lignes.

/ L'identité : un jeton d'accès Discord valide ne suffit pas — le serveur
  redemande à Discord *quelle application* l'a émis, et refuse ceux qui ne
  viennent pas de la sienne. Sans cette vérification, la frontière ne serait pas
  « un joueur de cette Activity » mais « un utilisateur de Discord ».
/ Les plafonds : 120 requêtes API par joueur et par minute, 30 pour le proxy de
  citations parce qu'il consomme un quota mensuel partagé, 20 connexions
  WebSocket. Un dépassement répond `429` explicitement — il ne coupe pas la
  connexion en silence.
/ Les en-têtes : politique de sécurité de contenu, `nosniff`, `no-referrer`,
  posés *après* le service de statiques pour couvrir aussi le document HTML — le
  seul endroit où une politique de contenu sert vraiment. Avec une exception
  nommée et permanente : `frame-ancestors` autorise Discord, et doit continuer à
  le faire. Une politique qui interdit l'encadrement rendrait le jeu injouable.
/ Les entrées réseau : identité assainie, mot de Spam validé, réglages contraints
  à des listes de valeurs fermées plutôt qu'à des bornes. Une valeur hors liste
  est ignorée, pas ramenée dans les clous.
/ Le résultat d'une course : recomputé, toujours. Une fin annoncée est *rejouée*
  contre le texte du serveur avant d'être crue, et une fin non confirmée devient
  un abandon — le seul verdict à la fois vrai et débloquant pour les autres.

#en-clair([Pourquoi une politique de contenu, alors que Discord en applique déjà une])[
  Dans l'iframe, Discord impose la sienne, et elle est plus serrée que tout ce
  que le projet pourrait écrire. Mais l'application est aussi joignable
  *directement*, par l'adresse du tunnel, dans un navigateur ordinaire — et là,
  plus rien ne s'applique. La politique du serveur couvre cette seconde porte.
  C'est la même logique que partout ailleurs dans le projet : ce n'est pas parce
  qu'un chemin est protégé que l'autre l'est.
]

== Tests et assurance qualité

382 tests côté TypeScript, 159 côté Rust. Le chiffre intéressant n'est pas leur
somme mais leur *répartition* : l'essentiel porte sur les deux domaines purs,
c'est-à-dire sur le code qui décide. C'est ce que la frontière `core/` ↔ `ui/`
achète — un domaine sans DOM se teste sans navigateur, et un domaine sans socket
se teste sans réseau.

Trois filets se superposent, et chacun attrape ce que les autres laissent
passer.

/ Les tests unitaires : le comportement de chaque module, dans son langage.
/ Les vecteurs partagés : trois fichiers de données à la racine, lus par
  `vitest` *et* par `cargo test`. Ils couvrent le calcul du Scoreboard, la
  détection d'échec et les Réglages de salon. C'est le seul filet possible pour
  un miroir manuel : une divergence entre les deux langages devient un test rouge
  d'un côté, au lieu d'un comportement silencieusement faux.
/ La chaîne d'intégration : audit des dépendances des deux côtés, lint, tests,
  build. Le travail de publication en dépend, ce qui rend mécaniquement
  impossible de publier avec un test rouge.

Ce que la chaîne ne garantit pas, et qu'il faut dire aussi. Elle ne lance pas le
jeu : rien n'y clique, rien n'y tape. Elle ne teste rien *dans* Discord — ni la
politique de contenu de l'iframe, ni la Rich Presence, ni le handshake
d'identité réel, qui exigent tous un client Discord et un tunnel. Et elle ne
compile pas ce PDF. Ces vérifications-là sont manuelles, et le sont assumément :
les automatiser demanderait un client Discord sur un runner, ce qui n'existe pas.

= Limites connues et suites

Ce que le projet ne fait pas, ou fait avec une réserve. Aucune de ces limites
n'est une surprise : chacune est une conséquence assumée d'un choix décrit plus
haut.

/ Les en-têtes de sécurité attendent leur validation : le code est écrit et
  servi, mais les critères d'acceptation de l'issue #152 — une course complète
  dans Discord, avatars affichés, aucune violation en console — demandent une
  session de test manuelle dans le client Discord. C'est la seule issue encore
  ouverte du dépôt.
/ Le tunnel change d'adresse : un tunnel rapide `cloudflared` ne garde pas son
  URL, et l'URL Mapping du portail Discord doit être remis à jour à la main à
  chaque session de test. Un tunnel nommé, ou un vrai nom de domaine, réglerait
  ça — c'est un choix d'hébergement, pas de code.
/ Il n'y a pas de leaderboard : l'ADR 0012 dit à quelles conditions il pourrait
  exister — le recompute autoritaire suffit à lui faire confiance, sans
  anti-triche dédié. Ce qui manque est le produit, pas la sécurité.
/ Les Rooms meurent avec le processus : elles vivent en mémoire, et un
  redémarrage du serveur vide tous les salons. Les Runs solo, eux, sont en base
  et survivent. C'est ce même choix qui explique pourquoi `RaceOver` porte tous
  les résultats d'un coup (@websocket) — il n'y a rien à redemander après coup.
/ Le miroir reste manuel : les vecteurs partagés attrapent les divergences de
  *comportement* sur ce qu'ils couvrent, mais pas un champ ajouté d'un seul
  côté. La couverture des vecteurs est le vrai plafond.
/ La dette délibérée est écrite : sept raccourcis portent dans le code un
  commentaire nommant leur plafond et leur chemin de sortie, rassemblés dans
  `PONYTAIL-DEBT.md`. Deux d'entre eux ont la même cause — la vitesse en direct
  des adversaires et le duel de Play of the Game sont calculés sur l'horloge
  locale de chaque client, avec environ 2 % de dérive, assumé pour des chiffres
  d'ambiance et à réaligner sur `RaceStart` si l'exactitude devient un enjeu.

Un mot sur ce que « limite connue » veut dire ici. Une limite écrite, avec sa
cause et son chemin de sortie, coûte une ligne à quiconque la rencontre. La même
limite non écrite coûte une session de débogage — et le projet en a fait
l'expérience assez de fois pour préférer la ligne.

= Annexes <annexes>

== Les dix-neuf décisions d'architecture

Chacune répond à une question qui ne se lit pas depuis le code seul. Le texte
complet, avec son contexte et ses conséquences, vit dans `Docs/adr/`.

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([ADR], [Décision]),

    [0001], [Le texte cible est persisté verbatim, pas régénéré depuis sa graine.],
    [0002], [L'identité d'affichage n'est jamais persistée.],
    [0003], [Les Quotes ne produisent jamais de record.],
    [0004], [Le solo démarre sans décompte : `t=0` est la première frappe.],
    [0005], [Le Trigram Drill est un Mode distinct, pas une extension de Drill.],
    [0006], [Le cursus Apprendre passe à 100 leçons — une extension, pas une v2.],
    [0007], [Le décompte de Race est un réglage produit, pas une unité de mesure.],
    [0008], [Une Room est identifiée par une clé : salon vocal *ou* Code de partie.],
    [0009], [Une Race n'a pas de Mode — elle a une Source de texte.],
    [0010], [`RaceOver` porte les résultats complets, pas seulement l'ordre.],
    [0011], [Play of the Game : un duel choisi par le serveur, rejoué sur une
      horloge commune.],
    [0012], [Un leaderboard ferait confiance au recompute autoritaire, sans
      anti-triche dédié.],
    [0013], [Difficulté Normal / Expert / Master, et l'état Échec qui en découle.],
    [0014], [En plein écran, le contenu se met à l'échelle — il ne défile pas.],
    [0015], [Floor is lava : un Mode de jeu, un axe à part, sans ligne d'arrivée.],
    [0016], [Spam : un Mode de jeu, texte infini, deux façons de gagner.],
    [0017], [Le Mode de jeu est une table déclarée ; le Réglage de salon a un
      contrat de retour explicite.],
    [0018], [Les journaux sous Mode de jeu sont tronqués, et la durée imposée.],
    [0019], [Le Code de partie est masqué par défaut, sur l'écran de chacun.],
  ),
  caption: [Les dix-neuf ADR. Elles ne sont pas rangées par thème mais par ordre
    d'apparition : la numérotation est chronologique, et c'est délibéré — une ADR
    dit ce qu'on savait au moment où on a tranché.],
)

== Les documents légaux

Trois fichiers de racine, exigés par le portail développeur Discord pour qu'une
Activity puisse être publiée. Ils ne sont pas décoratifs : sans eux, la fiche
d'application reste incomplète.

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([Fichier], [Rôle]),

    [`LICENSE`], [La licence sous laquelle le code est publié.],
    [`TERMS.md`], [Les conditions d'utilisation, liées depuis la fiche
      d'application.],
    [`PRIVACY.md`], [La politique de confidentialité. Elle a un contenu réel :
      le projet stocke des identifiants Discord et des journaux de frappe, et
      n'a jamais persisté d'identité d'affichage (ADR 0002).],
  ),
  caption: [Les trois documents exigés par le portail.],
)

== Où aller ensuite

#figure(
  table(
    columns: (auto, 1fr),
    align: (left + top, left + top),
    table.header([Document], [Ce qu'il contient, et que ce PDF n'a pas]),

    [`CONTEXT.md`], [Le glossaire de domaine complet — une quarantaine de
      termes, chacun avec les mots interdits à sa place. Ce document en a
      condensé douze.],
    [`Docs/API.md`], [Le contrat HTTP détaillé : les corps de requête et de
      réponse, champ par champ. Ce document n'a listé que les routes.],
    [`Docs/adr/`], [Les dix-neuf décisions in extenso, avec leur contexte et
      leurs conséquences.],
    [`Docs/PHASE2.md`], [Le plan de la phase multijoueur, tel qu'il a été posé
      avant d'être construit.],
    [`README.md`], [La mise en place locale, et le runbook complet du portail
      Discord : tunnel, URL Mappings, App Testers, pièges.],
    [`CHANGELOG.md`], [Les notes de version. C'est ce fichier, et non les titres
      de commits, qui alimente les notes de publication.],
  ),
  caption: [Les six documents qui prolongent celui-ci. Aucun de leurs blocs n'a
    été recopié ici : ce document condense ou renvoie, jamais les deux — deux
    copies d'un même paragraphe divergent à la première retouche.],
)
