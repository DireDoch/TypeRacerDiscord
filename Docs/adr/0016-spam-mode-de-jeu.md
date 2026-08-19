# Spam : un Mode de jeu, texte infini, deux façons de gagner

L'issue #105 demandait où « spam » vit dans le modèle : le but de la Race devient de
taper/répéter un mot en boucle, la victoire allant au Player qui atteint un certain
nombre de répétitions en premier. Grillé avec l'utilisateur (issue #110 en dépendait).

## Où ça vit

Même raisonnement que Floor is lava (ADR 0015) : ce n'est pas une Source de texte (elle
décide d'où vient le texte, jamais de qui gagne), ce n'est pas une Difficulté (condition
d'échec individuelle, pas comparative), et « spam » change précisément **comment la Race
se gagne**. C'est donc un second **Mode de jeu**, aux côtés de `Normal` et `Floor is
lava` — un Réglage de salon de plus, un seul actif à la fois, la Source de texte devient
inerte pendant qu'il tourne (le mode impose son propre mot).

## Considered Options — emplacement

- **Nouvelle Source de texte** : rejeté, ADR 0009 est explicite — la Source décide le
  texte, jamais la victoire. Un mot répété qui décide qui gagne n'est pas une variante de
  « d'où vient le texte », c'est une règle de victoire.
- **Mode de jeu** (choisi) : cohérent avec Floor is lava, aucune nouvelle machinerie de
  Room setting à inventer.

## Le mot

Choisi par l'owner : soit **par défaut** (un mot tiré au hasard de la liste de mots déjà
utilisée par la Source `Mots`, seedé pareil), soit **personnalisé** (une chaîne que
l'owner tape). Le mot personnalisé est validé côté serveur — jamais fait confiance côté
client, même principe que le reste du Run (#11, #15) : non vide, sans espace (un espace
transformerait silencieusement « un mot répété » en plusieurs mots cibles et casserait le
comptage), au plus 20 caractères. Chiffres et ponctuation à l'intérieur du mot sont
acceptés — seule la forme (pas d'espace, une chaîne) importe.

## Le texte est infini, pas un long texte fixe

Floor is lava avait résolu un problème voisin (aucune ligne d'arrivée) en imposant un
texte fixe assez long (200 mots) pour qu'on ne l'atteigne jamais en pratique. Spam
choisit un mécanisme différent et plus direct : le mot est **streamé indéfiniment**,
réutilisant tel quel le mécanisme déjà existant en solo pour Time infini (toujours
suffisamment de mots générés d'avance pour remplir les lignes visibles, régénéré au fur
et à mesure que le curseur avance). Pas de longueur à deviner à l'avance, pas de risque
qu'un joueur très rapide atteigne la fin d'un texte fixe.

## Deux façons de gagner, dans l'ordre qui arrive en premier

Deux Réglages de salon, tous deux à **paliers fixes** (comme la longueur de la Source
`Mots` — `Court`/`Normal`/`Long` — jamais un nombre libre : cohérence avec tous les
autres contrôles de lobby, aucune nouvelle validation d'entrée arbitraire à inventer) :

- **Seuil de répétitions** : un Player qui verrouille ce nombre de répétitions correctes
  gagne **immédiatement** — la Race s'arrête pour tout le monde, comme Floor is lava
  s'arrête au dernier survivant.
- **Plafond de temps** (paliers eux aussi, plafonnés à 60 s) : si personne n'a atteint le
  seuil quand le temps est écoulé, celui qui a le plus de répétitions correctes gagne.

La Race s'arrête au premier des deux qui survient. Départage à l'expiration du temps :
le nombre de répétitions verrouillées d'abord, puis les caractères corrects déjà tapés
dans la répétition en cours (même précision que le reste de Race utilise déjà pour le
Gap) — un Player en train de taper une répétition correcte au moment du clap ne doit pas
être classé à égalité avec un Player resté sur un buffer vide.

## Aucun nouveau code de saisie : le compte se lit, il ne se tient pas

Le texte cible est le mot cible répété (séparé par des espaces) — exactement la forme
qu'attendent déjà `FreeInput`/`replayTarget`/`replay_target`. Le curseur libre existant
s'applique tel quel : espace verrouille le mot courant (une répétition a lieu),
Backspace en buffer vide rouvre le dernier mot verrouillé (annule cette répétition, elle
redevient éditable), Ctrl+Backspace le supprime entièrement. Une « répétition correcte »
est un mot verrouillé qui égale le mot cible ; le nombre de répétitions se **recalcule**
depuis la pile `locked` à chaque vérification de fin de Run, ce n'est jamais un compteur
incrémenté à part qui pourrait diverger du buffer réel. Conséquence directe : Backspace
au milieu d'une répétition fonctionne sans code nouveau, il fait exactement ce qu'il fait
déjà partout ailleurs.

## Devancé : un terme, pour les deux façons de s'arrêter sans avoir gagné

Comme Brûlé (Floor is lava), ce nouvel état terminal ne vient ni d'un choix (Abandon) ni
d'une faute (Failed) : il vient d'avoir été comparé — à un autre Player qui a atteint le
seuil en premier, ou à une horloge qui a expiré. Un seul terme couvre les deux cas :
**Devancé**. Comme Brûlé, un Devancé reçoit un recompute serveur partiel (le log rejoué
contre la propre copie du mot par le serveur) pour connaître son nombre de répétitions
final — jamais un Run persisté, rien à comparer d'un Run à l'autre.

## Le podium affiche le compte de répétitions, pas Gap

Floor is lava avait dû remplacer Gap (écart en secondes, valide seulement quand tout le
monde finit le même texte à 100 %) par le temps de survie. Spam n'a pas ce problème de
la même façon : la grandeur qui décide déjà le classement (répétitions correctes) est
directement affichable telle quelle, sans conversion — le podium montre ce nombre brut,
classement 1er/2e/3e classique (ADR 0010), pas un « écart avec le gagnant ».

## Difficulté et joueur seul

Aucune règle nouvelle : la Difficulté reste orthogonale (Master échoue toujours à la 1re
frappe incorrecte, indépendamment du comptage de répétitions), et — contrairement à
Floor is lava — Spam **n'exige pas 2 partants** : courir seul contre un seuil ou une
horloge reste un jeu cohérent, il n'y a pas d'élimination qui le rendrait vide de sens à
un seul joueur.

## Consequences

- `Room` gagne un `game_mode: Normal | FloorIsLava | Spam { word_source, threshold,
  time_cap_s }`, même patron de Réglage de salon que le reste (owner seul, hors course,
  re-diffusé).
- Le générateur de texte solo (Time infini) et son mécanisme d'avance sont réutilisés
  côté Race pour le flux du mot répété — pas de nouveau générateur.
- `FreeInput`/`replayTarget`/`replay_target` ne changent pas : le mode ne fait qu'en lire
  le résultat (`locked`) pour décider fin de Race et classement.
- `finish_race`/`ws/mod.rs` gagnent la vérification du double critère d'arrêt (seuil OU
  temps) et le recompute partiel des Devancé, sur le même modèle que le Brûlé de Floor is
  lava (ADR 0015) — y compris le saut de la persistance en base sous ce Mode de jeu.
- Aucun changement au Config bucket / PB : un Mode de jeu n'y entre jamais (même règle
  que Floor is lava), la Race reste hors PB dans tous les cas (ADR 0009).
