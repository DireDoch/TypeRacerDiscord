#!/usr/bin/env bash
# Régénère tout `design/out/`. À relancer après CHAQUE retouche de
# `composants.typ` : les PNG commités sont la seule copie disponible pour qui
# n'a pas Typst, un export oublié se voit d'abord dans le portail Discord.
#
#   ./build.sh
#
# `--ppi 72` partout : les pages sont déclarées en pt, et à 72 PPI 1 pt = 1 px.
# Le défaut de Typst est 144 — l'omettre livre le double des dimensions
# demandées, ce qui ne se remarque qu'à l'upload.
set -euo pipefail
cd "$(dirname "$0")"

png() { typst compile --format png --ppi 72 "$@"; }

# Assets téléversés dans le portail développeur Discord.
png app-icon.typ out/app-icon.png     # icône d'application, 1024 × 1024
png cover.typ out/cover.png           # cover de l'étagère, 1024 × 576
png background.typ out/background.png # overlay de la grille, 1024 × 576

# Grands visuels Rich Presence, 1024 × 1024. Le nom de fichier EST la clé
# d'asset : ces six-là sont les `largeImageKey` de `ACTIVITY_PRESETS` dans
# `frontend/src/discord.ts`. En renommer un casse silencieusement l'état
# correspondant. Le petit visuel est `app-icon`, déjà exporté plus haut.
for etat in menu practice lobby race floor-is-lava spam; do
  png --input "etat=$etat" icone.typ "out/$etat.png"
done

# Épreuves de contrôle — rien de tout ça ne part chez Discord.
png voiture-1024.typ out/voiture-1024.png       # la voiture seule, en grand
png composant.typ out/composant.png             # la voiture à 48 px, taille réelle
png composition-demo.typ out/composition-demo.png

echo "OK — $(ls out/*.png | wc -l) PNG dans design/out/"
