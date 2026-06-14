Parfait le stack serais donc en HTML / TS et vite si possible avec des websockets, si possible j'aimerais inclure du Rust si possible pour m'entrainer dans ce language de programmation. 


Si vous penser que celui-ci pourrais être prêt en tant que plan je vais avoir besoin de vous pour m'écrire un plan complet pour que je puisse demander à Claude son opinion pour le tout, veuiller prendre en compte les besoins que je dois mettre dans le portail développeur de discord (je viens de me faire un "groupe" et commencer à créer mon "application" dans celui-ci.


De plus, veuiller inclure ces fonctionnalité et les séparer dans le prompt par rapport à leurs fonction (exemple: Catégories feature, theme, parametre, etc.):

- ponctuation: ajouter les characthere générer aléatoirement "'-.?!;:", etc. pour mettre dans le typeracer.

- Nombre : "" meme chose pour les nombres qui peux etre inclue dans celui-ci (la ponctuation peuvent indépendament être intégrer dans celui-ci ou les deux peuvent etre actif ou désactiver)

- (mode) Time: (default: 30sec), peux etre désactiver tout seul seulement pour se pratiquer par exemple, mais on peut mettre un compteur : 15,30,60,120 sec et mettre un icone "custom" pour que le joueurs puisse mettre : You can use “h” for hours and “m” for minutes, for example “1h30m”.You can start an infinite test by inputting 0.

- (Mode) Words: celui-ci est seulement de mettres statiquement un nombre de mots prédéfinit: 10, 25, 50, 100.

- (Mode) Quotes: ajouter un API pour aller prendre des quotes et mettre l'autheur et la source de celui-ci en bas du typeracer, a la fin de celui-ci on peut aller voir la source de l'information (par exemple wikipedia)

- (Mode) Zen: seulement se pratiquer a seulement tapper des mots sans avoir de mots apparaitre à l'écran, l'utilisateur peut par la suite cliquer sur "Shift + Enter" pour arreter le compteur et termienr sa course.


Après chaque course, l'utilisateur peux consulter son scord de cette facon: 

- WPM: mots par minutes

- ACC: "accuracy" dont les nombre de bon chactactere par rapport au nombre d'erreur de la personne (en %, exemple: ACC 84%)

- le mode du jeux : exemple: time 30sec, english

- raw: le nombre de mots marquer en tout, meme pour ceux qui on eux des erreurs. 

- Characters: "Correct/Incorrect/Extra/Missed".

- Time : exemple: 30s (cela s'applique mieux à certains "Mode", mais on doit le mettre à chaque fois.


De plus il doit y avoir un graphique qui montre le défilement du test selon (axes CORRIGÉS — le temps va toujours sur l'axe horizontal) :

Axe X (horizontal) : le nombre de secondes écoulées durant le test.

Axe Y gauche : WPM / Raw (lignes).

Axe Y droite : Errors (num, points rouges).


Important: en survolant le tableau qui prend 70-80% de la largeur de l'écran, on peux voir les différentes lignes qui représente le flux de la rapidité et autre statistique:

1. Le Titre du on:hover serais le nombre de seconde correspondant (y) exemple: "à 4 seconde".

2. Error (rouge): démontre combien d'erreur on été fait durant cette seconde.

3. WPM: montre le WPM que la personne aurait durant cette seconde en particulier  (depuis le départ).

4. Raw: montre le RAW que la personne aurait durant cette seconde en particulier (depuis le départ).

5.Burst.



