# Refonte visuelle — décisions

Session de grilling du 21 juillet 2026. Objectif : sortir de l'apparence de Monkeytype,
pour une activité jouée entre amis dans un salon vocal Discord.

Le glossaire du domaine est dans `CONTEXT.md` (termes **Display identity**, **Gap**,
**Preference**). L'identité d'affichage fait l'objet de l'ADR `0002`.

## Le point de départ

`style.css` déclarait « inspiration Monkeytype » ; c'était la palette *serika dark* au hex
près (`#323437`, `#e2b714`, `#d1d0c5`), la même barre de modes en haut, le même caret
barre clignotant, la même faute rouge soulignée. Contrastes WCAG mesurés de cette palette :

| variable | usage | ratio | verdict |
|---|---|---|---|
| `--text` | texte tapé | 8,05:1 | AA |
| `--main` | caret, accents | 6,55:1 | AA |
| `--sub` | texte **à taper** | 2,17:1 | échec |
| `--error` | fautes | 2,70:1 | échec |
| `--extra` | caractères en trop | 1,35:1 | quasi invisible |

## Décisions

1. **Identité d'affichage** — les joueurs portent leur nom Discord et leur avatar, jamais
   le snowflake brut. Éphémère, jamais stocké (ADR `0002`). Le joueur peut lui substituer
   un surnom, conservé sur sa machine.
2. **Zone de frappe — trois signatures remplacées.** Curseur **bloc** qui glisse (au lieu
   de la barre qui clignote) ; faute en **fond sourd** (au lieu du soulignement rouge) ;
   **contraste inversé** — le texte à venir est net, le texte déjà tapé s'estompe. Ce
   dernier point fait passer le texte qu'on lit de 2,17:1 à ~15:1.
   Corollaire obligatoire : retirer le soulignement impose de remonter le rouge de l'erreur
   (≥ 4,5:1), sinon la faute devient invisible.
3. **Fin de course — le photo-finish.** Le classement affiche l'**écart** au vainqueur en
   gros (« +1,4 s »), pas le WPM absolu : c'est l'écart qui se dit à voix haute.
4. **Palette** — corail sur bleu de nuit. Une seule source, `:root` :

   | variable | valeur | rôle | contraste |
   |---|---|---|---|
   | `--bg` | `#12161f` | fond | — |
   | `--panel` | `#1b2230` | cartes, pistes de jauge | 1,14:1 (séparation) |
   | `--text` | `#e8ecf4` | texte à venir, valeurs | 15,3:1 (AAA) |
   | `--sub` | `#6b7689` | texte tapé, libellés | 3,95:1 (AA-large) |
   | `--main` | `#ff7a59` | curseur, accent, leader | 7,1:1 (AAA) |
   | `--error` | `#ff4d6d` | faute | 5,6:1 (AA) |

   Modifiable sur <https://coolors.co/12161f-1b2230-e8ecf4-6b7689-ff7a59>.
5. **Typographie — deux polices, auto-hébergées** (la CSP des Activities interdit Google
   Fonts). Mono pour la zone de frappe, les chiffres et les jauges ; **Inter** pour le
   reste — menu, titres, contenu des leçons, historique, plaques de nom. Ligatures
   désactivées (`font-variant-ligatures: none`) : elles fusionnent `!=` ou `->` en un
   glyphe, ce qui ment sur le texte à taper.
6. **Sélecteur de police** (Preference) — trois monos embarquées : JetBrains Mono, Commit
   Mono, IBM Plex Mono. Il ne change **que** la police de frappe ; l'interface reste en
   Inter. Aperçu sur la vraie zone de frappe, pas sur un échantillon figé.
7. **Écran Apprendre — chemin vertical.** Un tracé descendant, une pastille par leçon,
   les paliers du barème (70 / 80 / 90 %) matérialisés en jalons. Remplace la colonne de
   22 boutons dont 21 grisés.
8. **Hauteur du chemin** — longueur naturelle, et l'écran s'ouvre centré sur la prochaine
   leçon (`scrollIntoView` au montage). Fonctionne dans les deux tailles d'iframe.
9. **Barre de config — résumé dépliable, libellés en français.** Repliée : une ligne
   (`mots · 25 · ponctuation`). Dépliée au clic. Les libellés passent de `time words
   quotes zen punctuation numbers` à `temps mots citations zen entraînement ponctuation
   chiffres` — le reste de l'app est en français.
10. **Son** — sons d'interface uniquement (clic, retour, leçon réussie), synthétisés en
    WebAudio : aucun fichier, aucun souci de CSP, la politique de lecture automatique est
    satisfaite puisque le son naît d'un clic. Volume bas, coupable dans les Preferences.
    **Jamais de son par frappe** : en vocal, les micros le captent et le renvoient à tous.

11. **Panneau réduit — le texte reste roi.** Quand la place manque, la zone de frappe
    garde sa taille et ce sont les adversaires qui se condensent : jauges fines empilées,
    avatar réduit à une pastille, WPM masqué, seul l'écart au leader survit. On ne peut
    pas taper ce qu'on ne lit pas ; on peut courir en sachant seulement qui est devant.

12. **Lobby — échauffement libre + bouton « prêt ».** Pendant l'attente, chacun peut taper
    sur le texte à venir : rien n'est compté, rien n'est envoyé, tout se réinitialise au
    décompte (doigts chauds dès la première manche, œil déjà au bon endroit). Le bouton
    « prêt » est un **signal, pas un verrou** : l'écran affiche « 3/4 prêts » et l'owner
    lance quand il veut. Un verrou recréerait le blocage de `all_racers_done` — un joueur
    absent figerait la soirée.
13. **Graphe de résultats — SVG maison, `chart.js` supprimé.** Une polyligne aux couleurs
    de la palette (aire corail, fautes en points rouges) remplace la dépendance ; la série
    seconde par seconde est déjà calculée par le scoreboard. Supprime la seule dépendance
    de rendu et retire au graphe son air de composant standard.

## Défauts constatés en chemin (hors refonte)

- `index.html` déclare `<html lang="en">` alors que l'interface est en français.
- Le titre de l'onglet est figé sur « TypeRacerDiscord — Practice ».
- `--font` demande JetBrains Mono / Fira Code / SF Mono, dont **aucune n'est chargée ni
  installée par défaut sur Windows** : le rendu réel est Consolas.
- Même mélange français/anglais dans l'Historique : en-têtes `date type mode wpm acc`,
  valeurs `race` / `practice` (`history.ts:143`).
- `style.css` ne contient **aucune règle `@media`** et fige `#app` à `min(1000px, 92vw)`,
  alors qu'une Activity se joue aussi en panneau réduit.
- `ws/mod.rs::all_racers_done` — une course n'est close que si chaque partant encore
  connecté a fini. Un joueur présent mais inactif fige l'écran de tous, indéfiniment, et
  aucun bouton ne permet de clore. Un partant qui ferme l'onglet disparaît du classement
  au lieu d'y figurer comme abandon. **Défaut fonctionnel, pas visuel — à traiter à part.**

## Reporté

- **Import de palette.** Une URL coolors contient déjà les hex
  (`coolors.co/12161f-1b2230-…`) : coller l'URL et découper sur les tirets suffit, et le
  collage brut de hex tombe du même code. ASE (binaire Adobe), SVG et CSS demanderaient
  chacun leur analyseur pour une donnée que l'URL donne en clair — non retenus.
  Une palette importée devra assigner des **rôles**, pas des couleurs : l'interface les
  emploie dans des proportions très inégales.
- **Musique de fond.** Coupée par défaut si elle arrive : en vocal elle entre dans le
  micro du joueur, ressort décalée chez les autres, et la suppression de bruit de Discord
  la déforme. Seul ajout de la session qui pèserait des mégaoctets, plus une question de
  licence.

## Ordre de construction suggéré

1. Le socle : variables de palette, deux polices embarquées, libellés français, curseur
   bloc, contraste inversé, faute en fond sourd. Touche tous les écrans d'un coup.
2. Les Preferences (police, palette, surnom, son) — un seul écran, `localStorage`.
3. La Display identity dans le lobby et les jauges, puis le photo-finish.
4. Le chemin vertical de l'écran Apprendre.
5. Le graphe SVG et la suppression de `chart.js`.
