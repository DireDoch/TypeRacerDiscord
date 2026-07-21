# L'identité d'affichage n'est jamais persistée

Les joueurs sont désignés à l'écran par leur nom Discord et leur avatar (une **Display
identity**), mais rien de tout cela n'est écrit côté serveur : chaque client annonce le
sien en rejoignant une Room, le serveur le relaie aux autres, et il est oublié à la
déconnexion. Un **Player** reste le snowflake Discord, seul identifiant durable et seul
propriétaire des Runs.

## Considered Options

- **Persister nom et avatar** (table `players`) : débloquerait un classement permanent du
  serveur et un historique nominatif. Rejeté parce que `PRIVACY.md` promet explicitement
  de ne collecter que l'identifiant Discord — stocker le nom et l'avatar en ferait une
  donnée personnelle de plus, à déclarer, à effacer sur demande et à maintenir quand un
  joueur change de pseudo.
- **Éphémère, relayé entre clients** (choisi) : les visages n'existent que le temps de la
  session. Aucune migration, aucun amendement à la politique de confidentialité, et le
  cas d'usage réel — reconnaître ses amis pendant une course dans un salon vocal — est
  entièrement couvert.

## Réversibilité

Cette décision est la direction réversible des deux : ne pas collecter se défait
(amender `PRIVACY.md`, ajouter une table, les noms apparaissent à partir de ce jour-là) ;
collecter ne se défait pas. Aucune incohérence visible n'en découle aujourd'hui —
l'écran Historique ne liste que les Runs du joueur lui-même, sans aucun identifiant à
l'écran, et les autres joueurs n'apparaissent que dans le lobby et le classement d'une
Race, où ils portent leur nom. Le seul écran qui forcerait à rouvrir la question est un
classement permanent du serveur, qui n'existe pas.

## Consequences

Tout ce qui survit à la session nomme les joueurs par snowflake : l'historique, les PB,
la progression du cursus, et tout classement permanent qui viendrait plus tard. Un tel
classement afficherait donc des numéros, ou exigerait de rouvrir cette décision.

L'identité d'affichage n'est vérifiée par personne : le joueur peut remplacer son nom
Discord par un surnom (une **Preference**, conservée sur sa machine), et deux joueurs
peuvent afficher le même nom. Sans conséquence sur les scores, qui sont attachés au
snowflake.
