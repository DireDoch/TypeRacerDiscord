# Le Code de partie est masqué par défaut, sur l'écran de chacun

Le Code de partie s'affichait en clair dans le lobby, à tout le monde. Un streamer qui
crée une partie le livrait donc à son chat en même temps qu'à ses amis. Il est désormais
**masqué par défaut**, révélé au clic, et doublé d'un bouton « Copier ».

## Pourquoi c'est une Preference et pas un Réglage de salon

C'est la moitié importante de la décision, et elle n'est pas intuitive.

Un **Réglage de salon** est « applied uniformly to every Player » (glossaire) : l'hôte le
pose, tout le monde le subit. Masquer le code par ce biais l'aurait caché **aux invités**
— précisément à ceux qui doivent le lire pour rejoindre — pendant que l'écran réellement
filmé, celui du streamer, dépendrait d'un réglage qu'il ne contrôle même pas s'il n'est
pas hôte.

Ce qui passe à l'antenne est **un écran**, pas un salon. Une **Preference** est
device-local et choisie par le Player : c'est le bon axe, et le seul qui protège la
bonne personne.

## Pourquoi le défaut va contre le glossaire, et pourquoi c'est quand même le bon

Le glossaire dit du **Code de partie** qu'il est « short enough to be read out loud », et
qu'il est **le seul moyen** de faire venir un joueur depuis un autre serveur Discord. Le
masquer par défaut dégrade donc le chemin principal pour protéger une minorité — un hôte
débutant peut ne jamais comprendre qu'il existe un code à communiquer.

C'est assumé, pour une raison asymétrique : **révéler est un clic, dé-révéler est
impossible.** Un code affiché une seconde de trop sur un stream ne se rattrape pas ; un
code masqué de trop coûte un clic. Le défaut se pose du côté où l'erreur est réparable.

Le **bouton « Copier » n'est pas un confort, c'est la condition** de ce défaut : il rend
l'action découvrable — il y a visiblement quelque chose à transmettre — sans jamais
afficher le code. Sans lui, ce choix serait indéfendable.

## Consequences

- `hideRaceCode` dans le `SPEC` de `core/preferences.ts`, défaut `true`, avec sa ligne
  dans une section « Multijoueur » des Paramètres.
- Un **test** garde ce défaut (`preferences.test.ts`). Il se lit comme un bug quand on
  tombe dessus : « corriger » le `true` doit casser quelque chose de bruyant plutôt que
  de rouvrir silencieusement la fuite.
- `codeRevealed` vit dans l'instance de `Race`, pas dans la Preference : révéler vaut
  pour **ce** lobby, pas pour toujours. Quitter la Room le remet à zéro sans code en plus.
- Ne concerne que les Rooms à code : `codeHtml()` ne rend rien quand `state.code` est
  `null` (Room issue d'un salon vocal, ADR 0008).
