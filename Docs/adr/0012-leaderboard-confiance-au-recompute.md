# Le Leaderboard fait confiance au recompute autoritaire, sans anti-triche dédié

Le Leaderboard (board de PB Practice, par Config bucket, vue Global + Server) rend
un PB **public** pour la première fois. Un score public crée une incitation à tricher
que l'historique privé n'avait pas. On décide malgré tout de **ne pas** ajouter
d'anti-triche : le board affiche les PB tels que le recompute Rust les valide déjà,
en assumant qu'ils sont falsifiables.

## Pourquoi c'est falsifiable, et pourquoi on l'accepte

Pour une Practice, le **Keystroke log est fourni par le client** (`POST /api/runs`).
Le recompute autoritaire vérifie que les stats sont **cohérentes avec ce log** — pas
qu'un humain l'a tapé. Un client modifié peut POSTer un log fabriqué aux timings
parfaits et obtenir un PB à 300 WPM. Le recompute attrape un log *incohérent*, jamais
un log *fabriqué mais cohérent*. Le « serveur possède le texte en Phase 2 » ne change
rien ici : il verrouille le **texte**, pas les **timings** d'une frappe solo.

On l'accepte parce que l'enjeu est un jeu Discord entre amis, que le coût d'un vrai
anti-triche est hors de proportion avec ce gain, et que le vrai rempart existera
gratuitement le jour où le serveur possédera le run de bout en bout (frappe live
vérifiée, comme le fait déjà la Race via le canal WebSocket). Ajouter des garde-fous
maintenant serait de la complexité contre une menace hypothétique.

## Considered

- **Garde-fou de bon sens** (rejeter un PB > ~250 WPM, ou un delta impossible vs
  l'historique du joueur) : quelques lignes, mais arbitraire — un tricheur reste sous
  le seuil — et prématuré tant que personne n'a pollué un board. À ressortir *si* le
  problème se manifeste, pas avant.
- **Vrai anti-triche** (plausibilité humaine des timings, ou canal live comme en Race) :
  gros chantier, disproportionné pour le MVP, et redondant avec la vérité serveur de
  Phase 2.

## Consequences

- Le plafond est **écrit dans le code** : un commentaire `ponytail:` au point de lecture
  du board nomme la limite (falsifiable par client modifié) et le chemin de sortie
  (run possédé par le serveur en Phase 2). Le registre `PONYTAIL-DEBT.md` le suit.
- `PRIVACY.md` / le README restent fidèles au comportement réel : le board ne prétend
  pas à un classement vérifié.
- Aucune table ni écriture nouvelle pour la triche : le board reste une **lecture
  dérivée** des PB existants. Le jour où le garde-fou de bon sens devient nécessaire,
  c'est un filtre sur cette lecture, pas un changement de modèle.
