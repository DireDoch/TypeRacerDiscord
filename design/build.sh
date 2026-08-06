#!/usr/bin/env bash
# Régénère tous les exports PNG du dossier design/out/.
# 1024 px à partir d'une page Typst de 10cm => ppi = 1024 / 10 * 2.54.
set -euo pipefail
cd "$(dirname "$0")"

ppi_1024=$(python3 -c "print(1024 / 10 * 2.54)")

typst compile voiture-demo.typ out/voiture-demo.png --format png --ppi "$ppi_1024"
typst compile app-icon.typ out/app-icon.png --format png --ppi "$ppi_1024"
typst compile icon-race.typ out/icon-race.png --format png --ppi "$ppi_1024"
typst compile icon-practice.typ out/icon-practice.png --format png --ppi "$ppi_1024"
# icon-spam.typ, icon-floor-is-lava.typ, composition-demo.typ : différés dans
# deferred/, en attente de l'implémentation du clavier — voir deferred/README.md

# 1024x576 (16:9) : page 18cm x 10.125cm => ppi = 1024 / 18 * 2.54
ppi_1024x576=$(python3 -c "print(1024 / 18 * 2.54)")
typst compile cover.typ out/cover.png --format png --ppi "$ppi_1024x576"
typst compile background.typ out/background.png --format png --ppi "$ppi_1024x576"

echo "Exports regénérés dans design/out/"
