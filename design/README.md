# Assets Discord

Les visuels du projet (icône d'application, cover, overlay, icônes de mode) sont
**dessinés en code**, pas dans un éditeur d'images : des sources Typst versionnées,
compilées en PNG aux dimensions exigées par Discord.

Pourquoi du code plutôt qu'un `.png` déposé là : les neuf assets partagent la même
voiture, le même clavier et la même palette. Les redessiner à la main dans neuf
fichiers, c'est neuf occasions de diverger. Ici, changer le corail dans
`composants.typ` change tous les assets à la recompilation.

## Le dossier

| Fichier | Rôle |
| --- | --- |
| `composants.typ` | Palette + composants (`logo()`, `voiture()`, `clavier()`, `sol-lave()`, `vitesse()`, `feux()`) + `scene()`. Ne rend rien seul. |
| `app-icon.typ` | Icône d'application Discord (#112), 1024 × 1024. Wordmark `logo()` seul — pas de scène, illisible à la taille d'affichage de l'étagère. |
| `cover.typ` | Cover Discord (#113), 1024 × 576. `logo()` + `scene(clavier: false)`. |
| `background.typ` | Overlay de la grille Discord (#114), 1024 × 576. Art sur les bords, **centre vide** : l'UI de Discord s'y pose. |
| `icone.typ` | Les 6 grands visuels Rich Presence (#115), 1024 × 1024. Un seul fichier, l'état vient de `--input etat=…`. |
| `voiture-1024.typ` | Épreuve : la voiture seule, en grand. Pas un asset. |
| `composant.typ` | Épreuve : la voiture à **48 px**, la taille réelle de l'étagère. C'est là qu'une retouche se juge. |
| `composition-demo.typ` | Planche de contrôle des trois combinaisons. Pas un asset. |
| `build.sh` | Régénère tout `out/`. Le seul point d'entrée à connaître. |
| `out/` | Les PNG exportés. **Commités** — voir plus bas. |

### Ce qui part dans le portail développeur

| Fichier de `out/` | Où | Taille |
| --- | --- | --- |
| `app-icon.png` | Icône d'application **et** petit visuel Rich Presence (clé `app-icon`) | 1024 × 1024 |
| `cover.png` | Cover de l'étagère des Activités | 1024 × 576 |
| `background.png` | Overlay de l'affichage en grille | 1024 × 576 |
| `menu.png` `practice.png` `lobby.png` `race.png` `floor-is-lava.png` `spam.png` | Art assets Rich Presence | 1024 × 1024 |

**Le nom du fichier est la clé d'asset.** Discord nomme l'asset d'après le fichier
téléversé, et `frontend/src/discord.ts` (`ACTIVITY_PRESETS`) envoie exactement ces
six clés plus `app-icon`. Renommer un PNG casse la Rich Presence de l'état
correspondant *en silence* : Discord retombe sur l'image par défaut sans rien dire.

## Le système de composants

Deux règles, et tout le reste en découle :

1. **Un composant dessine dans le repère cetz courant, il ne renvoie jamais un
   `canvas()`.** Un canvas est du contenu opaque : deux canvas s'empilent comme
   deux images au lieu de se composer dans un repère commun.
2. **Tout ce qui est au sol partage la ligne `y = 0`.** Les roues la touchent par
   le dessus ; les touches et la lave (`sol-lave()`, même bande de 10 × 1.4)
   pendent dessous. Les superposer ne demande donc aucune translation — la voiture
   roule sur les touches, ce qui est exactement ce que le jeu raconte, et remplacer
   la piste par la lave est un seul appel échangé.

`scene(voiture: true, clavier: true)` n'existe pas pour empiler ces deux appels,
qui n'ont besoin de personne. Elle existe pour **recentrer l'élément solitaire sur
la boîte de la scène complète** : sans elle, « voiture seule » et « les deux » ne
se cadrent pas pareil, et chaque asset à venir calerait son visuel à sa façon.

Aucun paramètre de taille nulle part : `scale` chez l'appelant fait déjà ce
travail, le redéclarer réécrirait la transformation de cetz à la main.

## Exporter

```sh
./build.sh   # tout out/, en une fois
```

À relancer après **chaque** retouche de `composants.typ` : les PNG commités sont la
seule copie disponible pour qui n'a pas Typst, et un export oublié ne se voit qu'une
fois l'image dans le portail.

Une page déclarée en `pt` exportée à **72 PPI** donne 1 pt = 1 px : `1024pt` de
page font 1024 px, sans calcul. Le défaut de `--ppi` est **144** — l'omettre livre
un fichier au double des dimensions demandées, qui passe inaperçu jusqu'à l'upload.
C'est pour ça qu'aucune commande `typst` ne se tape à la main ici : `build.sh` porte
le `--ppi 72` et la correspondance nom de fichier ↔ clé d'asset.

## Sans Typst installé

Rien à installer pour valider un visuel : [typst.app](https://typst.app) compile les
paquets `@preview` dans le navigateur. Créer un projet, y coller `composants.typ`
et le `.typ` de l'asset sous **les mêmes noms de fichiers** (l'`#import` est relatif),
puis exporter en PNG en réglant le PPI à 72. Un fichier qui compile là-bas compile
à l'identique en ligne de commande.

Pour l'installer quand même :

```powershell
winget install --id Typst.Typst   # Windows
```

`brew install typst` sur macOS, ou les binaires des
[releases GitHub](https://github.com/typst/typst/releases) ailleurs. Le projet
n'en dépend pas : ni la CI ni le build ne compilent de Typst.

Si l'éditeur refuse la version de cetz épinglée dans `composants.typ`, prendre
celle affichée sur [typst.app/universe/package/cetz](https://typst.app/universe/package/cetz).

## Pourquoi les PNG sont commités

« Régénérable » suppose que quelqu'un ait Typst — ce n'est le cas de personne sur
ce projet. Le PNG dans `out/` est donc la seule copie réellement disponible, et
c'est exactement le fichier téléversé dans le portail développeur Discord. Un
1024 × 1024 géométrique pèse une centaine de kilo-octets.

## La palette

Les six couleurs de `composants.typ` sont une **recopie manuelle** de
`frontend/src/style.css` `:root` — Typst ne lit pas le CSS, aucune source unique
n'est possible entre les deux. Toucher à la palette du jeu sans reporter ici fait
diverger l'icône de l'écran qu'elle ouvre.

`rouge` (`#ff4d6d`) est la couleur de la **faute de frappe** dans le jeu. Son seul
emploi est le 2e « p » fautif de `logo()` — l'utiliser comme accent ailleurs lui
ferait dire quelque chose qu'il ne veut pas dire.

`lave` (`#ff2d00`), `braise` (`#ffc21a`) et `croute` (`#17120f`) sont les seules
couleurs qui ne viennent **pas** de `style.css` : aucun écran du jeu ne les
affiche, elles n'existent que pour `sol-lave()` et les touches martelées de
`spam`. Trois et non une, parce qu'une coulée de lave n'est pas un aplat orange :
c'est un dégradé rouge → jaune interrompu par du basalte presque noir, et c'est ce
contraste-là qui la fait reconnaître. Elles ont leur propre teinte précisément
parce que `rouge` est pris.

Le motif noir de la croûte est **tiré au sort**, par un PRNG déterministe
(`_hasard()`) et non par `random` : largeurs de plaques, dents du bord haut,
fissures et blocs détachés. Déterministe parce que deux `build.sh` doivent rendre
le même PNG — sinon chaque rebuild salit le diff des images commitées. Un motif
qui tombe mal se re-tire avec `sol-lave(graine: …)`.
