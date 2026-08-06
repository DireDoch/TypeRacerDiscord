# Design — pipeline Typst

Assets visuels (icônes, Rich Presence, doc onboarding) générés en Typst,
style géométrique/vectoriel via le package [cetz](https://github.com/cetz-package/cetz).

## Installation de Typst

```sh
# Arch/CachyOS
sudo pacman -S typst

# Sinon, n'importe quelle plateforme avec Rust (utilisé pour développer ce pipeline)
cargo install --locked typst-cli
```

`typst compile ...` télécharge automatiquement le package `cetz` (réseau requis au
premier compile, mis en cache ensuite).

## Structure

- `components.typ` — bibliothèque de composants réutilisables : `logo()`
  (wordmark "Typpe|Racer" — la faute de frappe et le curseur portent la
  marque), `voiture()` (silhouette GT basse, style arcade/retro-racing),
  `clavier()` (rangées décalées façon vrai clavier, sans glyphes, barre
  d'espace optionnelle via `espace: true`), `cle()` (une touche, keycap
  stylisé plat), `trainee-touches()` (traînée de touches pour suggérer la
  vitesse), `compose()` (assemble voiture/clavier/les deux). La palette
  (`palette.bg`, `.panel`, `.text`, `.sub`, `.main`, `.error`) reprend
  exactement `frontend/src/style.css` pour rester cohérente avec l'identité
  déjà en place dans l'app. Le wordmark `logo()` n'apparaît que dans
  `cover.typ` et `app-icon.typ` — les icônes Rich Presence restent icon-only
  pour rester lisibles en petit format.
- `voiture-demo.typ` — démo du composant `voiture()` seul (#106).
- `composition-demo.typ` — démo des 3 combinaisons de `compose()` (#108).
- `app-icon.typ` — icône d'application finale (#112).
- `cover.typ` — image de couverture Discord, 1024×576 (#113). Le titre reprend
  le code couleur de frappe de l'app (typed/à venir/curseur).
- `background.typ` — overlay d'arrière-plan, 1024×576, art aux bords, centre
  dégagé pour l'UI Discord (#114).
- `icon-race.typ`, `icon-floor-is-lava.typ`, `icon-spam.typ`,
  `icon-practice.typ` — icônes Rich Presence par état, 1024×1024 (#115).
  Noms de fichiers provisoires : à renommer selon les clés d'assets exactes
  une fois #111 câblé.
- `out/` — exports PNG générés (non regénérés automatiquement, voir `build.sh`).

## Régénérer les exports

```sh
./build.sh
```

## Ajouter un nouvel asset

Composer un nouveau fichier `.typ` qui importe `components.typ`, plutôt que de
redessiner des formes ad hoc — toutes les icônes de mode / Rich Presence /
cover doivent dériver de `voiture()`, `clavier()`, ou de `compose()`.
