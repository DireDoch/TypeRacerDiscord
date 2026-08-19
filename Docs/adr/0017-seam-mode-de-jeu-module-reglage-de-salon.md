# Seam Mode de jeu : table déclarée ; Réglage de salon : contrat de retour explicite

Les issues #128 (13 branchements sur `game_mode` dans `ws/mod.rs`) et #129 (la garde
« owner + hors course » recopiée dans 9 fonctions `set_*`) demandaient chacune une
session de grilling avant de coder — #129 est bloquée par #128, la deuxième absorbant
une partie de `set_game_mode`/`set_spam_word`. Grillé avec l'utilisateur.

## Forme du seam Mode de jeu (#128)

**Table de règles déclarée**, pas un trait objet. `GameMode` (`Normal` | `FloorIsLava` |
`Spam`) reste l'enum du protocole réseau — `Serialize`/`Deserialize`, transporté par
`ClientEvent::SetGameMode` et `ServerEvent::RoomState` — un trait objet ne s'y
substituerait pas, il faudrait de toute façon une couche interne résolue depuis cet enum
à un seul endroit. Entre les deux formes internes possibles, la table gagne : même
bénéfice de lisibilité qu'un trait objet (un bloc par mode, ses ADR cités une fois,
plutôt qu'un `match` par question dispersé sur ~10 fonctions comme l'aurait donné
l'option « enum + match centralisé »), sans la cérémonie d'un trait à ~10 méthodes pour
trois implémentations connues d'avance, et sans dispatch dynamique pour un polymorphisme
qui ne sert à rien ici (le mode d'une Room ne change jamais après résolution).

`effective_source`/la production du texte imposé (`refresh_spam_text` pour Spam) fait
partie de cette table : « comment ce mode produit son texte » est une des règles que
#128 liste déjà, pas une conséquence accessoire d'un Réglage de salon.

## `set_ready` reste hors de `RoomSetting` (#129)

`CONTEXT.md` définit un Réglage de salon comme *« set by the **party leader** »* —
`set_ready` (n'importe quel présent se marque prêt, pas de garde owner) n'en est pas un
par définition, pas par oubli. Précédent direct dans le code : le commentaire de
`set_difficulty` exclut déjà Expert du Réglage de salon pour la même raison structurelle
(ADR 0013). `set_ready` reste donc une exception unique et nommée, hors de l'enum
`RoomSetting`, plutôt que d'ajouter un champ « garde owner : oui/non » par variante rien
que pour son cas.

## Contrat de retour de `RoomSetting::apply` (#129)

Le `bool` actuel des `set_*` porte deux post-conditions différentes selon la fonction,
jamais visibles dans le type : pour `set_text_source`/`set_game_mode`, `true` veut dire
« accepté ET l'appelant doit lancer `spawn_refresh_text` hors verrou » (une Quote peut
demander un aller-retour réseau) ; pour `set_spam_word`, `true` veut dire « accepté,
texte DÉJÀ régénéré sous le verrou » — l'appelant ne doit surtout rien relancer par-dessus.
Remplacé par un type à trois variantes explicites :

```rust
enum SettingOutcome { Rejected, Applied, AppliedNeedsRetext }
```

`handle_socket` ne fait que `match` dessus ; seul `AppliedNeedsRetext` déclenche
`spawn_refresh_text`. `RoomSetting::apply` reste synchrone et pur (`&mut Room` seul, pas
d'accès à `Rooms`/`Arc<QuoteClient>`) — c'est lui qui lit le verdict de la table
`GameModeRules` de #128 pour savoir laquelle des trois variantes renvoyer, jamais
l'inverse.

## Consequences

- #129 reste bloquée par #128 dans cet ordre précis : la table `GameModeRules` doit
  exister (et porter la stratégie de texte par mode) avant que `RoomSetting` puisse
  distinguer `Applied` de `AppliedNeedsRetext` pour `SetGameMode`/`SetSpamWord`.
- #131 (miroir frontend du lobby déclaratif) reste bloquée à son tour par #129 — cette
  ADR ne change pas la chaîne de dépendance, elle rend seulement #128 et #129
  implémentables mécaniquement (les décisions de forme sont prises).
- Aucun changement de vocabulaire : `GameModeRules`, `RoomSetting`, `SettingOutcome` sont
  des constructions internes Rust, pas des termes de domaine — rien à ajouter à
  `CONTEXT.md`.
