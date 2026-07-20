# Persister le texte cible verbatim (pas de régénération depuis le seed)

Le Replay rejoue un Keystroke log **contre** son texte cible. On ajoute une colonne
`target_text` à `runs` (migration `0003`) et on y stocke le texte complet tel que tapé,
plutôt que de le régénérer depuis le seed au moment du replay.

## Considered Options

- **Régénérer depuis le seed** : moins de stockage, mais impossible pour les Quotes
  (texte issu d'une API externe, non régénérable) et fragile — tout changement futur de
  l'algo de génération ou de la word-list rendrait les vieux Runs silencieusement faux.
- **Stocker verbatim** (choisi) : quelques Ko par Run, correct pour tous les Modes,
  immunisé contre l'évolution du générateur.

## Consequences

Les Runs antérieurs à la migration `0003` ont `target_text = NULL` : ils restent dans
l'historique mais ne sont **pas rejouables** (le bouton Replay est masqué pour eux).
