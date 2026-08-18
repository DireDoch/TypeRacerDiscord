#!/usr/bin/env bash
# Régénère les dix-huit gabarits de capture.
#
#   ./build.sh
#
# À ne relancer QUE tant que les vraies captures ne sont pas prises : ce script
# écraserait une vraie capture par un gabarit. Une capture prise remplace son
# fichier ici, et disparaît de la liste ci-dessous.
#
# Les dimensions ne sont pas décoratives : elles fixent la proportion que
# `documentation.typ` réserve à l'image. Prendre la vraie capture dans une autre
# proportion décale la mise en page — d'où le rappel de la taille attendue dans
# chaque gabarit.
set -euo pipefail
cd "$(dirname "$0")"

gabarit() { # nom largeur hauteur sujet
  typst compile --format png --ppi 72 --root ../.. \
    --input "nom=$1" --input "l=$2" --input "h=$3" --input "sujet=$4" \
    _gabarit.typ "$1.png"
}

# --- Dans le jeu (13) --------------------------------------------------------
gabarit menu 1280 720 \
  "Le Menu : les quatre entrées, le wordmark, l'accès au guide « Comment jouer »."
gabarit config-solo 1280 720 \
  "La barre de configuration solo dépliée, avec Mode, valeur et modificateurs."
gabarit practice 1280 720 \
  "Un Practice en cours : le mot actif sur la ligne du milieu, une faute en rouge."
gabarit resultats-solo 1280 720 \
  "L'écran de résultats solo et son graphe SVG seconde par seconde."
gabarit apprendre 1280 720 \
  "La liste des cent leçons : verrouillée, disponible, terminée."
gabarit menu-multijoueur 1280 720 \
  "Les trois portes d'entrée d'une Room, champ de code compris."
gabarit lobby 1280 720 \
  "Le salon d'attente en trois colonnes, Code de partie masqué."
gabarit piste 1280 720 \
  "La piste pendant une course classique, une voiture par joueur."
gabarit floor-is-lava 1280 720 \
  "Floor is lava en action, au moment d'un battement du métronome."
gabarit spam 1280 720 \
  "Le mode Spam et son compteur de répétitions à la ligne d'arrivée."
gabarit podium 1280 720 \
  "Le podium, avec le Gap en tête d'affiche."
gabarit play-of-the-game 1280 720 \
  "Play of the Game : deux Keystroke logs rejoués sur une horloge partagée."
gabarit parametres 1280 720 \
  "L'écran Paramètres et ses quatre types de contrôle."

# --- Hors du jeu (5) ---------------------------------------------------------
gabarit rich-presence 1280 720 \
  "La Rich Presence vue par un autre membre du salon vocal, hors Activity."
gabarit activity-salon-vocal 1280 720 \
  "L'Activity lancée depuis un salon vocal, dans le client Discord."
gabarit bandeau-erreur 1280 300 \
  "Le bandeau d'erreurs rouge en bas du jeu — le seul canal de diagnostic dans Discord."
gabarit ci-jobs 1280 430 \
  "Les trois travaux verts de la chaîne d'intégration sur une poussée."
gabarit release 1280 430 \
  "Une version publiée avec son archive et ses notes."

echo "OK — $(ls -1 ./*.png | wc -l) gabarits dans Docs/captures/"
