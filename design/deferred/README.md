# Différé

Fichiers mis de côté volontairement, en attente de décisions produit — pas
cassés, juste pas branchés sur `build.sh` pour l'instant.

- `icon-spam.typ` — dérive entièrement de `clavier()` ; en attente de
  l'implémentation du clavier (composant posé dans `components.typ`, pas
  encore intégré dans les assets actifs).
- `icon-floor-is-lava.typ` — mode « floor is lava » mis de côté pour l'instant,
  à reprendre plus tard.
- `composition-demo.typ` — démo des 3 combinaisons de `compose()` (#108), dont
  deux dépendent du clavier ; à reprendre en même temps que `icon-spam.typ`.

Pour les réactiver : les remonter dans `design/`, réajouter leur ligne dans
`build.sh`.
