#!/usr/bin/env bash
# Produit les deux PDF de la documentation, depuis UNE source.
#
#   ./build.sh
#
# `documentation.typ` lit `--input theme=` et en dérive toute sa palette : rien
# dans le corps du document ne connaît sa propre couleur. Deux fichiers .typ
# maintenus en parallèle divergeraient au premier paragraphe corrigé d'un seul
# côté — et une documentation fausse à moitié est une documentation fausse.
#
# `SOURCE_DATE_EPOCH` : sans lui, Typst horodate le PDF à l'instant de la
# compilation, et les fichiers committés changent à chaque build même quand pas
# une ligne n'a bougé. Avec, deux compilations de la même source donnent le même
# fichier au bit près (`cmp` le vérifie).
#
# `--root ..` : le document importe `design/composants.typ` et les PNG de
# `design/out/`, qui sont hors de `Docs/`.
set -euo pipefail
cd "$(dirname "$0")"

export SOURCE_DATE_EPOCH=0

typst compile --root .. --input theme=sombre documentation.typ documentation.pdf
typst compile --root .. --input theme=clair documentation.typ documentation-clair.pdf

echo "OK — documentation.pdf (sombre) · documentation-clair.pdf (clair)"
