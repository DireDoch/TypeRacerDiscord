# Trigram Drill : nouveau Mode distinct de Drill, pas une extension

Le brief FeatureSupp (« Practice » ciblé typos) demandait de retenir le
caractère qui vient avant **et après** une faute — un vrai delta face à
Drill, qui n'attribue les fautes qu'à une touche seule ou à un bigramme
(caractère précédent uniquement). Plutôt que d'étendre Drill pour absorber
ce contexte plus riche, on crée un Mode séparé, **Trigram Drill** :
`domain/analysis.rs` gagne un 3ᵉ `kind: "trigram"` (caractère précédent +
fautif + suivant, mêmes règles de rupture que le bigramme — espace,
backspace, Extra) ; Drill continue de piocher parmi `key`/`bigram`, Trigram
Drill exclusivement parmi `trigram`. Les deux Modes partagent le même
endpoint `GET /api/profile/analysis` et la même fenêtre de 20 Runs — seul le
filtre de `kind` diffère.

## Considered Options

- **Étendre Drill pour inclure le trigramme** : rejeté — Drill piocherait
  alors un mélange de kinds de sévérité incomparable (le trigramme, plus
  rare, a mécaniquement moins d'occurrences qu'une touche seule), et le nom
  « Drill » ne dirait plus ce qui est réellement ciblé.
- **Fusionner en un seul Mode « complet » (tous kinds confondus)** : rejeté
  — perd la distinction pédagogique entre « cette touche te ralentit » et
  « cette séquence précise te ralentit », et complexifie le seuil anti-bruit
  (un seul `MIN_OCCURRENCES` pour des populations de fréquence très
  différente).
- **Mode séparé, filtré par kind** (choisi) : chaque Mode reste lisible —
  Drill = touches/bigrammes, Trigram Drill = trigrammes — avec un seuil
  anti-bruit propre à chacun (`MIN_OCCURRENCES_TRIGRAM` plus bas, les
  trigrammes étant rares par construction : il faut les deux voisins
  présents et non cassés).

## Consequences

- `MIN_OCCURRENCES_TRIGRAM` (proposé : 5, contre 10 pour `key`/`bigram`) est
  une constante séparée dans `analysis.rs` — à calibrer à l'usage, comme les
  autres seuils (voir issue #3).
- Trigram Drill a un état vide dédié (« profil présent mais aucun trigramme
  significatif ») distinct de celui de Drill (« pas de profil »), qui renvoie
  vers Drill comme alternative immédiatement jouable.
- Mots-cibles en échec (retenir des mots entiers ratés, pas seulement des
  touches contenant le Weak spot) et mémoire longue durée persistée (au-delà
  des 20 derniers Runs) restent hors scope — des pistes citées par le brief
  mais explicitement écartées de cette itération.
