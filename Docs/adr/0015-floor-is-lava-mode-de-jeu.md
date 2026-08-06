# Floor is lava : un Mode de jeu, un axe à part, sans ligne d'arrivée

La section D veut « épicer » le multijoueur avec des modes de jeu qui changent la
**façon de gagner**. Le premier s'appelle floor is lava : à intervalle régulier, le
joueur le moins avancé est éliminé ; le dernier vivant gagne.

L'issue #104 demandait de décider où ce mécanisme vit dans le modèle. Il ne pouvait
se greffer nulle part sans mentir :

- Ce n'est pas un **Mode** (`Time`/`Words`/`Quotes`/`Zen`) : ceux-là sont solo et
  décident du texte, pas de la victoire — une Race n'a d'ailleurs pas de Mode (ADR 0009).
- Ce n'est pas une **Source de texte** : elle décide d'où vient le texte, jamais de
  qui gagne.
- Ce n'est pas une **Difficulté** : une Difficulté est une condition d'échec
  **individuelle**, évaluée sur le seul Keystroke log du joueur (ADR 0013). L'élimination
  est **comparative** — on ne meurt pas de sa propre faute, on meurt d'être dernier.

D'où un axe nouveau, le **Mode de jeu**, Réglage de salon comme les autres (owner seul,
hors course, re-diffusé à tout le lobby). Un seul à la fois : ce sont des règles de
victoire, elles ne se cumulent pas.

## La course s'arrête au dernier vivant, pas à la ligne

Le survivant gagne à l'instant où il reste seul, **sans avoir tapé tout le texte**.
C'est la seule Race qui se termine sans que personne ne franchisse la ligne.

L'alternative — faire terminer le texte au survivant — aurait coûté moins cher : la
clôture existante (`all_racers_done`), une vraie arrivée, donc un `duration_ms`, donc le
Gap et le podium inchangés. Elle a été écartée parce qu'elle fait taper le dernier vivant
tout seul contre personne pendant la fin de sa course. Le mode promet la survie ; il doit
s'arrêter quand la survie est acquise.

Conséquence assumée : **floor is lava n'a pas de Gap**. Le chiffre en tête d'affiche du
podium devient le **temps de survie**, parce que c'est la grandeur qui décide du
classement — la même règle qui fait afficher le Gap en grand dans une Race normale.

## Pas de ligne d'arrivée du tout : le mode impose un texte long

Sans cette décision le mode ne fonctionne simplement pas, et pas dans un cas rare :

| Source | ~caractères | Fini à 60 WPM |
| --- | --- | --- |
| `Mots Court 15` | 90 | 18 s |
| `Mots Normal 30` | 180 | 36 s |
| `Mots Long 50` | 300 | 60 s |
| `Quote` (défaut) | 100–250 | 20–50 s |

Huit joueurs à 10 s d'intervalle demandent **70 s**. Sur *chacune* de ces sources
quelqu'un franchit la ligne avant qu'il ne reste un vivant — et un finisseur est un état
que le mode ne sait pas représenter, puisqu'il se gagne à la survie.

Floor is lava tourne donc sur `Words { count: 200 }` : ~1 200 caractères, ~4 minutes à
60 WPM contre 70 s de course maximum. Personne ne finit, jamais. La **Source de texte est
inerte** tant que le mode est actif — deux réglages qui se contredisent ne cohabitent pas,
c'est le Mode de jeu qui gagne, et l'UI masque le sélecteur de Source.

Le coût est un nombre, pas une machinerie : `words_text(200)` au lieu de
`words_text(30)`, et `pending_source` renvoie la source du mode plutôt que celle du
lobby — donc le proxy de citations n'est même pas appelé.

## Brûlé : un troisième état terminal, et le seul qui porte un score

Abandon vient d'un choix, Failed vient d'une faute. **Brûlé** ne vient ni de l'un ni de
l'autre : il vient d'avoir été comparé aux autres. Il lui fallait son propre état.

Contrairement aux deux autres, un Brûlé **envoie son Keystroke log** et reçoit un vrai
recompute autoritaire sur la portion qu'il a eu le temps de taper. Sans ça le mode tuait
le Play of the Game : tout le monde finirait à 0 WPM sans log, il n'y aurait rien à
comparer ni rien à rejouer.

Ce log passe par l'événement `Finish` **existant** — « voici mon log, j'ai fini » est
déjà exactement ce qu'il veut dire. Le serveur sait qui il a brûlé (c'est lui qui a
décidé), il n'a pas à le demander au client. Le survivant envoie le sien de la même façon
quand il se retrouve seul.

Le classement, lui, est l'**ordre des décès inversé** — jamais le WPM. Scénario qui rend
la distinction non théorique : Alice brûle à 10 s à 40 WPM (elle a démarré tard), Bob
brûle à 20 s à 30 WPM. Classer au WPM remettrait Alice devant Bob, c'est-à-dire annulerait
l'élimination qu'on vient de jouer. Le WPM d'un Brûlé sert à l'afficher et à choisir le
duel ; il ne le classe pas.

**Aucun Run n'est persisté** en floor is lava — le texte est imposé, partiel et comparable
à rien, et la règle existante se lit déjà « un Run est sauvegardé pour qui est arrivé ».
Ici personne n'arrive. Le recompute a bien lieu, mais en mémoire, pour le podium et le
duel.

## Le duel se mesure en WPM, parce que les décès sont sur un métronome

Porter `duel()` en remplaçant « instant d'arrivée » par « instant de sortie » ne marche
pas, deux fois :

1. Les décès tombent toutes les X secondes exactement. Tous les écarts entre décès
   consécutifs valent X — il n'existe pas de « paire la plus serrée ». L'instant du décès
   porte le classement, mais **zéro information de proximité**.
2. Le survivant sort au moment exact du dernier décès : écart nul, systématiquement. Le
   duel serait toujours « le vainqueur contre sa dernière victime ».

Le WPM est la seule grandeur du mode qui ait de la variance. Le même algorithme
(trier, prendre la paire consécutive la plus serrée) change donc de clé, pas de forme.
Seuil : **2 WPM**, dans le rôle exact des 2 s d'ADR 0011 — on ne fabrique pas un duel qui
n'a pas eu lieu.

La **fenêtre** s'inverse par contre. ADR 0011 va jusqu'à l'arrivée du *second* : on veut
voir les deux franchir. Ici elle couvre les 3 s précédant la sortie **la plus précoce des
deux**, et s'arrête là — sinon on regarde le survivant taper seul pendant trente
secondes. Elle est toujours valide (avant la première des deux sorties, les deux étaient
vivants) et elle se termine sur les flammes.

## Consequences

- **`charsDone` devient décisif alors qu'il est déclaratif.** Il ne servait qu'à dessiner
  les voitures ; il décide maintenant qui meurt. Un client modifié qui l'exagère ne brûle
  jamais. Assumé : le plafond existe déjà (un `Finish` forgé gagne déjà une Race normale),
  le mode n'ouvre pas une porte fermée, il rend le passage plus confortable. Enjeu de
  vantardise, entre amis, sans PB ni classement.
- **Une coupure réseau tue.** Un socket qui hoquette cesse d'envoyer `Progress`, le
  `charsDone` retenu gèle, le joueur brûle en tapant parfaitement. Le serveur ne peut pas
  distinguer « il rame » de « il ne tape pas ». C'est le vrai coût du point précédent, et
  il frappe un joueur honnête.
- **La comparaison est arrondie au mot.** L'issue #94 a réduit `Progress` à un envoi par
  mot verrouillé. Deux joueurs séparés de quatre caractères sont indistinguables ; ce
  n'est pas toujours le vrai dernier qui brûle. Revenir à un `Progress` par frappe
  multiplierait le trafic par cinq pour départager des cas déjà à égalité.
- **Le serveur retient la progression**, ce qu'il ne faisait pas : `relay_progress`
  rediffusait et oubliait. `RaceState::Racing` gagne une map `progress` et la liste
  ordonnée des `burned`.
- **Le watchdog passe de 30 s à 1 s** et porte le tic d'élimination. Une boucle globale
  qui scanne les Rooms sans DB ni recompute coûte moins qu'un minuteur par Room, dont il
  faudrait gérer l'annulation à `end_race` et à la destruction de la Room. L'instant de
  décès enregistré reste exact (`t=0 + n × intervalle`) ; seule l'annonce peut avoir
  jusqu'à 1 s de retard.
- **Égalité au tic : les deux brûlent.** Aucun départage n'est honnête — l'ordre d'arrivée
  des paquets serait un tirage au sort invisible.
- **Les deux derniers peuvent mourir ensemble : personne ne gagne.** La condition de fin
  est « au plus un vivant », pas « exactement un » — un cas spécial de moins, et une fin
  dont on se souvient.
- **La persistance demande un `if`.** L'affirmation « rien n'est persisté ne coûte rien »
  était vraie tant que personne n'envoyait de `Finish`. Comme le log passe par `Finish`,
  `finish_race` doit sauter l'écriture en base sous ce Mode de jeu.
- **Le mode exige 2 partants.** `StartRace` n'en vérifiait aucun : l'owner peut lancer
  seul. Seul = déjà dernier vivant = course finie à t=0.
- **Un client qui ne renvoie jamais son log gèle la course jusqu'au watchdog des
  10 minutes** — exactement le risque qui existe déjà aujourd'hui pour un finisseur dont
  le client se fige sans se déconnecter. Pas de garde supplémentaire ajoutée pour ce mode.
- **Difficulté Master reste combinable**, sans règle nouvelle : les deux axes sont
  orthogonaux par construction. Un joueur Failed sort des vivants comme un abandon.
