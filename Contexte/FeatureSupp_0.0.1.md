Je veux rajouter ces fonctionnalité dans le tout, veuiller discuter avec moi comment je pourrais faire le tout.
De plus j'aimerais intégrer un CI/CD avec github actions pour faire les différents test sur les feature et connection que je fait dans mon application.
Voici ce que j'aimerais rajouter pour le mode solo et multijoeur séparement:


Solo:

A)L'utilisateur peux faire un "review" de sa course de deux facon:

1. Il peux revoir comment il a fait sa course en temps réelle (peux importe le mode de jeux) pour voir en temps réelle ce qu'il sais passer (erreur inclus).

2. La personne peux cliquer sur un boutton qui va faire analyser sa course et vas sortir les principales touche ou combinaison de touche qui le fait le plus ralentir et/ou faire des erreurs.


B) Nouveau mode de jeux (solo): "Pratice", Ce mode de jeux prend les données du joueur selon les course en solo et proposer des mots, lettres et autre pour aider la personne à se pratiquer sur les 
choses qui semble le mettre en erreur. par exemple cela reste en donnée profil (user scope) de pouvoir savoir quelle type de typos que la personne semble faire le plus, veuiller dicuter avec moi de
comment allons nous faire tout cela avec la logique de programmation (garder en mémoire les erreurs, le mots et les lettre ou charactere qui vient avant et après lors d'une faute).



C) Nouveau mode de jeux (solo - principal, par exemple les trois mode de jeux serais : "Solo, Multiplayer, Option et le nouveau: "Apprendre"):
- Dans le fond cela expliquerais les détails d'un tape touche et comment apprendre et écrire sans regarder le clavier. Donc il serait de faire des instructions détailler sur comment apprendre à 
faire cela avec des exercise (100?) ou que les course son répétitive et sert a faire habituer la personne à faire une course et ne pas regarder le clavier. Il y aurait 100 challenge, mais ceux-ci
serais très progressif, par exemple, en premier cela montre graphiquement comment placer nos doit sur le clavier et comment se repérer sur le clavier
, par exemple les touche F et J on de la texture sur leurs touches pour orientée la personne sur l'emplacement de ces mains en premier.
par la suite voici les challenge qui pourrais être présent "liste":

Veuiller scanner tout les boutton ayant (dans le site: https://www.edclub.com/sportal/program-3.game) : "Arial-Label = "Lesson [num]". le but étant que vous voyez le scope de quelle genre de nom d'exercise une platforme que celui-ci pourrais avoir pour "s'entrainer pour débutant"


D) Le mode de race Multiplayer, voici le workflow du tout : 
1. la personne voit le menue avec le logo du jeux (placeholder pour le moment, seulement afficher le nom du jeux)
2. La personne voit seulement --> Solo, Multiplayer, Option et Apprendre.
3. Quand la personne clique sur Multijoueur, il y a maintenant trois boutton de menu: "Create Game", "Join Game" ou "Back" (pour revenir en arriere)
3a. Si la personne clique sur Join Game, cela demande dans un champ "Race Code" (nous allons faire la logique de cela donc tant que la personne n,a pas mis le code à "x nb. de characthere, cela empêche de faire "join game").
3b. Si la personne lcique sur Create Game, cela fait apparaitre si le jeux peux être jouer en publique ou en privée (channel or discord server scope). Par la suite, la personne 
peux cliquer sur "Create Game" et choisir le mode de jeux auquelle il veux jouer en attendant les autre joueurs. Le lobby ID qui est soit publique 
(donc d'autre personne d'autre serveur peux rejoindre) ou si la game était sélectionner comme privée, il peux donner le code de la partie à ceux-ci. 
4. La personne qui à créer la "Race" est le party Leader, il peux changer quelque paramètre de la partie et décide quand il est temps de comment la partie (limite de 8 jouerus dans un lobby).


VOici ce qu'il se passe au départ de la partie:
UI wise: 
- Un compteur stiliser est dans l'écran et faire un cont down de 7 second.
- Chaque personne qui est dans la partie est sur un auto avec leurs avatar discord dans celui-ci, leurs noms discord est en arriere de celui-ci à la ligne de départ.
- et sur chacune des lignes, à la fin de celui-ci (la ligne d'arriver), on peux voir le wpm durant la course de chaque joueurs en temps réelle.
- En dessous (on peux reprendre l'encadrer utiliser auparavant pour montrer la TOTALITÉ de ce que les gens doivent marquée). Plusieurs phrase et tirée de 
l'API des quotes (les quotes peuvent avoir beuacoup de mots/phrase ou pas beaucoup).
- En dessous du texte est marquer (les instructions de la course): "Type the above text here when the race begins", cela va être le mots qui est en train de se faire 
tapper durant que la race va etre en cours -> IMPORTANT : seulement le mots qui est marquer doit être mentionner parce que cela aide la personne à vérifier les typos qui 
pourrais être fait et rapidment voir quelle est l'erreur commit (garder la logique de couleurs si une faute occur).
- En haut à gauche serais un boutton qui serais marqué : "Main menu (leave race)" pour les gens qui veulent quitter au besoin. et l'orsque la race est partie un boutton apparait pour abandonner la partie. 
Quand une personne abandonne, cela fait seulement abandonner la course et l'auto arrête, MAIS cela ne fait pas quitter la partie, la personne peux donc jouer et continuer pour la prochaine partie sans "Quitter complétement".

Logique wise:
- La personne commence à typer et faire un logique ou que dépendament de la vitesse de la personne et du nombre de mots total, la personne fait avancer sa voiture pour indiquer au autre joueurs de sa vitesse.
- Quand une personne finit le texte, il peux voir ces statistiques final de la course en détail.
- La partie se termine tout le monde à terminer de jouer.


Feat/race-podium:
- Quand la partie est finit on peux voir pendant quelque seconde le podium de tout les auto des personnes pour display leurs temps et leurs statistiques de la course (global).
- les trois premier sur sur le podium et les autre son sur le coter (mais visible avec leurs nom et score).

Feat/PlayOfTheGame:
Comme dans overwatch après une partie, on peux voir le replay de ce qui à été tapper pour les deux autos qui on termienr qui était le plus proche, par exemple la position 1 et 2 c'est
jouer sur 0.5 seconde d'écart (78wpm et 76wpm). donc on peux voir ce qu'il c'Est passer avec la fonctionnalité du "replay" vers les derniere seconde + SLOW MOTION SI POSSIBLE.

Par la suite tout le monde revient dans le lobby et recommence le process. 
