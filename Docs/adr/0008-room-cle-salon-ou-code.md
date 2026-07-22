# Une Room est identifiée par une clé — salon vocal OU Code de partie

CONTEXT.md définit la Room comme « une session multijoueur scopée à un salon vocal
(`channelId`) », et le serveur l'implémente littéralement : `HashMap<ChannelId, Room>`,
`JoinRoom { channelId }`, création à la volée au premier arrivant. La section D du brief
demande un menu « Create Game / Join Game » avec un **Code de partie** saisi à la main,
et des parties publiques rejoignables depuis un autre serveur Discord.

Le salon vocal n'est pas un détail d'implémentation à remplacer : dans une Activity, les
joueurs sont **déjà regroupés** par Discord. Obliger quatre amis d'un même vocal à se lire
un code à voix haute serait de la friction ajoutée dans le cas d'usage majoritaire.
Inversement, le salon vocal est le seul regroupement possible aujourd'hui — impossible de
jouer avec quelqu'un d'ailleurs.

## Considered Options

- **Garder `channelId` seul** (statu quo) : abandonne un pan entier du brief D.
- **Passer entièrement au code, retirer `channelId`** : le plus petit modèle mental et le
  moins de code, mais détruit le regroupement gratuit offert par Discord.
- **Clé unique, deux formes** (choisi) : la map devient `HashMap<RoomKey, Room>` où
  `RoomKey` est une `String` valant soit le `channelId`, soit un Code de partie. Un seul
  index, aucune table de correspondance.

## Le Code de partie

5 caractères tirés d'un alphabet sans ambiguïté visuelle (ni `0/O`, ni `1/I/L`) — assez
court pour être dicté à l'oral, assez large (~28 M de combinaisons) pour que la collision
soit un non-événement. Le serveur retire un code déjà pris et retire.

Un code ne peut jamais entrer en collision avec un `channelId` : un snowflake Discord fait
18–19 chiffres, un code en fait 5. Aucune désambiguïsation n'est nécessaire à la lecture
de la clé.

## Création : à la volée pour le salon, explicite pour un code

C'est la seule vraie asymétrie, et elle est justifiée par la **confiance dans la source**.

- Le `channelId` vient du SDK Discord : il est authentique, jamais fautif. La Room du
  salon peut donc continuer d'être **créée à la volée** au premier `JoinRoom`.
- Un code vient du **clavier d'un joueur**. Créer à la volée sur un code inconnu
  enfermerait quiconque fait une faute de frappe dans une Room fantôme où il attendrait
  seul, sans jamais comprendre pourquoi personne n'arrive.

D'où : `CreateRoom` devient un événement distinct (le serveur génère le code et le
renvoie), et `JoinRoom` sur une clé absente répond `RoomNotFound` au lieu de créer.

## Public / privé : différé, pas refusé

Le brief oppose « publique » (rejoignable d'un autre serveur) à « privée » (sur code),
mais ne dit nulle part **comment on trouve une partie publique**. Sans annuaire, les deux
se comportent identiquement. Et un annuaire n'a de valeur qu'avec une base de joueurs :
livré maintenant, ce serait un écran vide en permanence.

Décision : **tout Code de partie est déjà cross-serveur** (le backend ne vérifie aucune
appartenance de guilde — c'est le comportement qui remplit la promesse « quelqu'un d'un
autre serveur peut rejoindre »). Le distinguo public/privé et l'écran « parties
publiques » (`GET /api/rooms`) attendent qu'il y ait des joueurs à lister.

## Consequences

- `ws/protocol.rs` / `core/net.ts` : `JoinRoom { channelId }` → `JoinRoom { key }` ;
  ajout de `CreateRoom` (C→S) et de `RoomCreated { code }` / `RoomNotFound` (S→C).
- `ws/mod.rs` : `ChannelId` → `RoomKey` dans la signature de la map et des fonctions ;
  `await_join` accepte désormais `CreateRoom` autant que `JoinRoom`.
- La durée de vie ne change pas : une Room vide est retirée, **le code meurt avec elle**.
  Les codes ne sont donc jamais persistés ni réservés.
- CONTEXT.md : la définition de **Room** ne mentionne plus le salon vocal comme sa nature,
  mais comme l'une de ses deux clés. Nouveau terme : **Code de partie**.
