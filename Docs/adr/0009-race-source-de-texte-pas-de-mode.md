# Une Race n'a pas de Mode — elle a une Source de texte

Le brief D dit que le party leader « choisit le mode de jeu auquel il veut jouer en
attendant les autres joueurs ». Pris au mot, cela ouvrirait le sélecteur de Mode du solo
(Time / Words / Quotes / Zen) au lobby. C'est incompatible avec ce qu'est une Race.

Une Race a **une seule règle de fin** : le texte entier tapé exactement (`raceComplete`,
`all_racers_done`). Time signifierait « tout le monde tape 30 s, le meilleur WPM gagne » —
une autre condition de fin, une autre notion de gagnant, et plus aucune course visible
entre des voitures qui n'ont pas de ligne d'arrivée commune. Zen et Time infini n'ont pas
de fin du tout ; `RACE_MAX_DURATION_MS` le note déjà dans le code.

Ce que le leader choisit n'est donc pas un **Mode**, c'est **d'où vient le texte**.

## Décision

Nouveau terme de domaine : la **Source de texte** d'une Race, `Quote` ou `Mots`.

- **Quote** (défaut, ce que demande le brief) : le texte vient du proxy déjà en place
  (`GET /api/quote`). Sa longueur n'est pas un réglage — elle appartient à la citation.
- **Mots** : texte généré, comportement actuel, avec une longueur choisie parmi trois
  valeurs fixes — **Court 15 / Normal 30 / Long 50**. C'est le repli à durée maîtrisée,
  précisément parce que le brief note lui-même qu'« une quote peut avoir beaucoup de mots
  ou pas beaucoup » : à huit joueurs, une citation de 400 caractères impose une course
  longue à tout le monde, sans échappatoire.

`Punctuation` et `Numbers` ne sont **pas** offerts au lobby. Ce sont des Settings, et un
Setting sert à faire varier son propre entraînement ; en Race, il ferait surtout varier la
difficulté imposée aux sept autres.

Le **scoring ne change pas** : quelle que soit la Source, le recompute autoritaire reste
`Mode::Words` sur le texte du serveur, avec `mode_value` = son nombre de mots. La Source
décide du texte, jamais de la mesure. Et la Race reste hors PB dans tous les cas.

## Consequences

- `Room` gagne `text_source: Quote | Words { count }`, réglable par le seul owner et
  seulement hors course. Chaque changement re-diffuse `RoomState`.
- La génération du texte de revanche (`end_race`) relit la Source courante de la Room au
  lieu d'appeler `generate_text` en dur.
- Source `Quote` : le serveur appelle son propre proxy. Un échec API (clé absente → `502`)
  ne doit pas bloquer le lobby — il retombe sur `Mots (30)` et le signale dans `RoomState`.
- CONTEXT.md : **Source de texte** entre au glossaire ; **Mode** précise qu'il ne
  s'applique qu'aux Runs solo.
