# Assets Discord

Les visuels du projet (icône d'application, cover, overlay, icônes de mode) sont
**dessinés en code**, pas dans un éditeur d'images : des sources Typst versionnées,
compilées en PNG aux dimensions exigées par Discord.

Pourquoi du code plutôt qu'un `.png` déposé là : les cinq assets partagent la même
voiture, le même clavier et la même palette. Les redessiner à la main dans cinq
fichiers, c'est cinq occasions de diverger. Ici, changer le corail dans
`composants.typ` change tous les assets à la recompilation.

## Le dossier

| Fichier | Rôle |
| --- | --- |
| `composants.typ` | Palette + composants (`voiture()`, `clavier()`) + `scene()`. Ne rend rien seul. |
| `voiture-1024.typ` | Un asset = un fichier : sa page, ses dimensions, sa composition. |
| `composition-demo.typ` | Planche de contrôle des trois combinaisons. Pas un asset. |
| `out/` | Les PNG exportés. **Commités** — voir plus bas. |

## Le système de composants

Deux règles, et tout le reste en découle :

1. **Un composant dessine dans le repère cetz courant, il ne renvoie jamais un
   `canvas()`.** Un canvas est du contenu opaque : deux canvas s'empilent comme
   deux images au lieu de se composer dans un repère commun.
2. **Voiture et clavier partagent la ligne de sol `y = 0`.** Les roues la
   touchent par le dessus, les touches pendent dessous. Les superposer ne demande
   donc aucune translation — la voiture roule sur les touches, ce qui est
   exactement ce que le jeu raconte.

`scene(voiture: true, clavier: true)` n'existe pas pour empiler ces deux appels,
qui n'ont besoin de personne. Elle existe pour **recentrer l'élément solitaire sur
la boîte de la scène complète** : sans elle, « voiture seule » et « les deux » ne
se cadrent pas pareil, et chaque asset à venir calerait son visuel à sa façon.

Aucun paramètre de taille nulle part : `scale` chez l'appelant fait déjà ce
travail, le redéclarer réécrirait la transformation de cetz à la main.

## Exporter

```sh
cd design
typst compile --format png --ppi 72 voiture-1024.typ out/voiture-1024.png
typst compile --format png --ppi 72 composition-demo.typ out/composition-demo.png
```

Une page déclarée en `pt` exportée à **72 PPI** donne 1 pt = 1 px : `1024pt` de
page font 1024 px, sans calcul. Le défaut de `--ppi` est **144** — l'omettre livre
un fichier au double des dimensions demandées, qui passe inaperçu jusqu'à l'upload.

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

`rouge` (`#ff4d6d`) est la couleur de la **faute de frappe** dans le jeu. Elle est
listée pour être complète, pas pour décorer : l'employer comme accent sur un asset
lui ferait dire quelque chose qu'il ne veut pas dire.
