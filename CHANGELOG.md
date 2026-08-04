# Changelog

Les versions publiées de TypeRacerDiscord, de la plus récente à la plus ancienne.

Ce fichier n'est pas décoratif : le job `release` de `.github/workflows/ci.yml` en extrait
la section correspondant à la version de `backend/Cargo.toml` et en fait les notes de la
release GitHub. **Une section absente ou vide fait échouer la publication** — écrire les
notes est la condition pour publier, pas une formalité d'après-coup.

Écrire pour un joueur, pas pour un développeur : « la piste se remplissait à fond sur un
abandon », pas « corrige `trackPercent` ». La liste des commits est déjà dans git.

**Format des titres : `## vX.Y.Z — titre court`.** Le pipeline repère la section sur les
deux premiers mots de la ligne, et reprend la ligne entière comme titre de la release.

Les versions `v0.0.1` à `v0.0.3`, publiées à la main avant ce fichier, ne figurent pas
ici — leurs notes vivent sur la page des releases GitHub.

## v0.0.4 — publication automatisée

### Ajouté

- Les releases se publient désormais toutes seules. Quand la version de
  `backend/Cargo.toml` change et que `main` bouge, le pipeline pose le tag, écrit les
  notes depuis ce fichier et attache une archive prête à déployer.
- Chaque release contient maintenant **quelque chose de téléchargeable** : un binaire
  Linux 64 bits entièrement statique et le frontend compilé. Aucun toolchain Rust ou Node
  n'est plus nécessaire sur la machine qui héberge le jeu.

### Corrigé

- Le numéro de version du projet ne se contredit plus. `backend/Cargo.toml` faisait
  autorité sur le papier mais annonçait `0.1.0` là où les tags publiés en étaient à
  `v0.0.3`, et `frontend/package.json` disait encore `0.0.0`. Le manifeste du backend
  tranche désormais, et il est juste.
