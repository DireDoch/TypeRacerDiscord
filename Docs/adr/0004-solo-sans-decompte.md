# Solo démarre sans décompte — t=0 devient la 1re frappe

`renderCountdown` masquait tout le texte cible pendant les 3 s du décompte en solo
(`ui/practice.ts`), forçant à taper en aveugle le tout premier mot — contraire à la
règle produit « le décompte ne doit jamais cacher le texte », déjà respectée en
multijoueur (`ui/race.ts` garde le texte visible pendant son propre décompte). Retirer
le décompte réglait ce défaut, mais rouvrait ce que CONTEXT.md fige depuis le début :
« t=0 = fin du décompte, le temps de réaction est compté ». Ce n'est pas un changement
d'interface, c'est un changement d'unité de mesure — voir issue #22.

## Considered Options

- **Garder le décompte en solo** (statu quo) : les PB restent comparables tels quels,
  mais il aurait fallu corriger `renderCountdown` à part pour ne plus masquer le texte
  — un correctif isolé qui laisse la mesure du temps de réaction inchangée alors
  qu'elle n'a jamais eu de justification en solo (personne d'autre n'attend le Player,
  contrairement à la Race où le décompte synchronise plusieurs joueurs).
- **Retirer le décompte sans rien invalider** : rejeté d'emblée — un Run après ce
  changement bat un Run d'avant pour une raison qui n'est pas la vitesse du Player (le
  temps de réaction, jusque-là inclus dans le dénominateur du WPM, en sort
  mécaniquement). Le classement des PB perdrait sa seule promesse : comparer des
  choses comparables.
- **Retirer le décompte et invalider les PB affectés** (choisi) : t=0 devient la 1re
  frappe en solo — pas de délai imposé, pas de temps de réaction à mesurer puisqu'il
  n'y a personne d'autre à attendre. Le multijoueur garde son décompte de 3 s (il
  synchronise plusieurs Players sur `RaceStart`, le temps de réaction y est un signal
  réel, pas un artefact de mesure) : Solo et Race ne mesurent plus la même chose, mais
  ne se comparaient déjà jamais entre eux (Race est déjà exclue des PB — fin stricte,
  texte 100 % exact).

## Backfill des PB existants

Un Run Time/Words solo persisté avant cette décision a été mesuré décompte inclus : le
comparer à un Run après serait aussi invalide que comparer une Quote de 40 caractères à
une de 400 (précédent direct : ADR 0003). Migration `0006` : `UPDATE runs SET
pb_eligible = 0 WHERE pb_eligible = 1` — Race n'étant déjà pas PB-eligible, ceci ne
touche que les Runs Time/Words solo antérieurs. Même geste que la migration `0005`
(Quotes, #14) : l'Historique et le Replay restent inchangés, seule l'éligibilité PB est
corrigée. Irréversible au sens où revenir en arrière repartirait d'un historique de PB
vide plutôt que de restaurer l'état antérieur — assumé, comme pour ADR 0003.

## Consequences

- `RunPhase` perd l'état `countdown` côté client (solo) : `idle → running → finished`.
  La 1re frappe démarre `clock.start()` ET compte déjà comme Keystroke — elle n'est
  plus « avalée » par un décompte qui ne l'enregistrait pas.
- Le multijoueur (`ui/race.ts`) est inchangé : son propre décompte, sa propre machine
  d'état, non affectée par cette décision.
- CONTEXT.md (« Origine du temps ») distingue désormais explicitement Solo et
  Multijoueur au lieu d'une seule règle globale.
- Aucun Run Zen / Time infini n'est affecté par le backfill : ils n'ont jamais été
  PB-eligible (leur durée dérive déjà du dernier `t` du log, pas du décompte).
