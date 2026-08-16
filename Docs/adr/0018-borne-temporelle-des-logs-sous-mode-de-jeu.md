# La borne temporelle des logs sous Mode de jeu : tronquer, et imposer la durée

Issue #164, reliquat volontaire de #163. Celle-ci gardait **qui** a le droit d'envoyer un
`Finish` sous Floor is lava et sous Spam (`finish_allowed`) ; elle ne gardait pas **ce que
le log a le droit de dire** une fois la garde passée.

Un brûlé parfaitement légitime — le serveur l'a bien arrêté, sa garde passe — pouvait donc
livrer un log fabriqué : 200 caractères parfaits horodatés sur 2 s, recomptés à 800 WPM par
un recompute qui n'avait aucune raison d'en douter. `requires_full_text` (#160) ne s'y
applique pas, et c'est correct : ces deux modes n'ont pas de ligne d'arrivée.

Aucun classement n'en bougeait — Floor is lava classe à l'ordre des décès inversé (ADR
0015), Spam au nombre de répétitions verrouillées (ADR 0016). Restaient le **WPM affiché au
podium**, faux mais visible, et le **Play of the Game** (ADR 0011), dont le duel se choisit
sur les résultats retenus : un log gonflé le raflait. Cosmétique et PotG, pas une victoire
volée — d'où le report hors de #163, pas l'abandon.

## Le serveur connaît l'instant où il a arrêté chacun

C'est toute la différence avec Normal, et c'est ce qui rend la borne possible :

- **Floor is lava** — `burned_at_ms`, déjà retenu dans `RaceState::Racing { burned }`. Le
  dernier vivant, lui, n'a pas brûlé : ce qui l'arrête est le décès qui l'a laissé seul,
  donc le **dernier** instant de la liste. Sans ça il serait le seul non borné du mode, et
  c'est précisément son WPM que le podium met en tête.
- **Spam** — l'instant du `SpamStop`, le même pour tout le monde. `spam_stopped` était un
  simple booléen ; il devient `spam_stopped_at_ms: Option<f64>`. Le drapeau et l'instant
  sont la même information, un champ suffit donc toujours.
- **Normal** — `None`, et c'est voulu : le joueur s'y arrête lui-même en franchissant la
  ligne, il n'y a aucun instant serveur à lui opposer. C'est `requires_full_text` qui y
  garde l'arrivée.

La question vit dans la table de règles du seam (`GameModeRules::stopped_at_ms`, ADR 0017),
à côté de `finish_allowed` : un quatrième Mode de jeu en hérite en déclarant son bloc.

## Tronquer, pas rejeter

Entre l'annonce (`PlayerBurned`, `SpamStop`) et l'arrêt effectif du client il y a un
aller-retour réseau. **Une frappe au-delà de la borne est donc la norme, pas une triche** —
rejeter le log comme un abandon (le motif de #160 et #163) punirait la frappe en vol à
chaque manche. Les frappes au-delà de l'instant d'arrêt sont jetées, le reste est recompté.

## Et la durée du recompute devient cet instant

C'est le point qui n'était pas dans l'énoncé de #164, et c'est le seul qui ferme vraiment
le trou. Le log gonflé de l'exemple est **compressé** : ses 200 caractères sur 2 s tiennent
tout entiers *sous* la borne d'un joueur mort à 10 s, donc la troncature ne les touche pas.
Tronquer seul aurait laissé les 800 WPM intacts.

`resolve_duration` dérive la durée de la **dernière frappe déclarée**. Sous un Mode de jeu,
le serveur sait mieux : c'est lui qui a mis fin à la course de ce joueur. La durée du
recompute devient donc l'instant d'arrêt (`ScoreInput::duration_override_ms`, `None`
partout ailleurs, plafonné par le même `MAX_DURATION_MS` anti-DoS). Le log perd le droit de
choisir son propre dénominateur.

Ça rend enfin littérale la formule d'ADR 0015 : « un recompute autoritaire **sur la portion
qu'il a eu le temps de taper** » — le temps qu'il a eu, pas le temps qu'il déclare.

**Effet assumé sur le jeu honnête** : un brûlé qui tape 3 s puis regarde mourir les autres
jusqu'à 10 s passe de ~120 à ~36 WPM. C'est la vérité, et sous un mode où l'on meurt d'être
le moins avancé, flatter l'inactivité était exactement le mauvais sens.

## Ce que ça ne prétend pas fermer

Un log compressé reste **indétectable dans l'absolu** : le serveur ne peut pas prouver que
200 caractères en 10 s n'ont pas été tapés, il peut seulement refuser de croire qu'ils l'ont
été en 2 s. La borne ramène le mensonge au plafond de ce qui est humainement plausible sur
la durée réellement vécue ; elle ne le supprime pas. Aller plus loin voudrait dire recompter
le log à chaque mot verrouillé, pour huit joueurs, à chaque seconde — le même plafond
assumé que celui du `reps` déclaratif de `relay_progress`.
