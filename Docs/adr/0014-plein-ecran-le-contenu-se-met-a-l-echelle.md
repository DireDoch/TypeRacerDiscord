# ADR 0014 — Plein écran : le contenu se met à l'échelle, il ne scrolle pas

- **Statut** : accepté
- **Date** : 2026-08-03
- **Issues** : #91 (socle), #96 (jauges de course)

## Contexte

Dans l'Activity Discord, l'app affichait une scrollbar dès que le contenu dépassait la
fenêtre : `body`/`#app` n'avaient aucune contrainte de hauteur. L'issue #91 fixe la
cible : **aucune scrollbar, sur aucun écran**, et le contenu à taille variable
**rétrécit pour tenir** plutôt que d'être coupé.

Ces deux critères entrent en conflit au-delà d'un certain rapport contenu/fenêtre.
Mesuré : l'écran Paramètres fait ~2990 px de contenu ; dans une fenêtre de 620 px, le
faire tenir demanderait un facteur 0,21 — un texte à 4 px de haut. « Ne rien couper »
et « ne rien réduire à l'illisible » ne peuvent pas être vrais en même temps là.

## Décision

Une seule boucle de mise à l'échelle pour toute l'app (`ui/chrome.ts`) : `#app` est un
cadre clippé à la fenêtre, `#screen` porte le contenu à hauteur libre, et un `zoom` est
posé sur `#app` pour que `#screen` tienne.

`zoom` et non `transform: scale()` : `zoom` **reflowe** (le texte se recoupe à la
nouvelle largeur, les hauteurs en pourcentage se recalculent), là où `scale` étirerait
une image figée de la page en laissant les zones cliquables décalées.

Le facteur suit trois règles (`fitScale`, fonction pure) :

| Cas | Facteur |
| --- | --- |
| Le contenu tient déjà | `1` |
| Il déborde un peu (jusqu'à ×2) | juste ce qu'il faut, moins 1 % de marge |
| Il déborde au-delà du plancher de 0,5 | `1` |

**Le troisième cas est la décision.** Réduire n'a de sens que quand ça atteint le but.
Pour un écran qui est une liste longue par nature (Paramètres, Apprendre), descendre au
plancher ne le ferait pas tenir pour autant : il défilerait de toute façon, mais en
plus illisible. On le laisse donc à taille pleine, et il **défile sans qu'aucune
scrollbar ne soit peinte** (`scrollbar-width: none` + `::-webkit-scrollbar`).

Le critère de l'issue est donc tenu à la lettre — aucune scrollbar visible nulle part —
et aucun contenu n'est jamais rendu inatteignable.

Les écrans qui ne peuvent PAS défiler sans nuire au jeu — la Race, où l'on tape en
regardant les jauges — tiennent tous entiers dans la plage mesurée (2 à 8 joueurs,
fenêtres de 1440×900 à 760×500). C'est ce que la règle protège en priorité.

## Conséquences

- Une longueur de mise en page en `vh` ne suit **pas** l'échelle (elle se mesure sur la
  fenêtre, pas sur le contenu) : les paddings de structure sont en `rem`. Un `vh`
  réintroduit dans une hauteur de bloc casse la convergence en une passe.
- La marge de 1 % absorbe le recalcul des métriques de police après réduction (mesuré :
  2 px regagnés sur le menu), sans deuxième passe de mesure qui risquerait d'osciller.
- La mesure et l'application se font dans un `requestAnimationFrame`, jamais dans le
  callback du `ResizeObserver` : redimensionner pendant la livraison déclenche le
  « ResizeObserver loop completed with undelivered notifications », que le bandeau
  d'erreurs de `main.ts` affiche en plein écran et qui bloque les clics.
- `#91` étant garanti, les tailles ont pu grossir sans risque : socle du `rem` à 19 px,
  et jauges de course jusqu'à `3.2rem` (#96, plancher `1.6rem` à 8 joueurs).
