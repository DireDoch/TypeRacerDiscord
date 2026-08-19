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

## v1.0.0 — le jeu est jouable dans Discord

Première version stable. Le jeu tourne de bout en bout comme une Activity Discord : on
lance TypeRacer depuis un salon vocal, on joue à plusieurs, et le serveur reste en ligne
entre deux parties.

### Le jeu est fonctionnel

- **Trois modes de jeu.** La course classique, **Floor is lava** (rester au-dessus d'une
  vitesse minimum, sous peine d'être brûlé) et **Spam** (répéter le texte le plus de fois
  possible dans le temps imparti).
- **Le multijoueur complet.** Salon avec code de partie, lobby en trois colonnes, décompte
  commun, piste de course en direct, podium avec l'écart au vainqueur et le **Play of the
  Game**.
- **Les réglages de salon** — source du texte, mode, difficulté, durée, décompte, taille du
  salon — décidés dans le lobby et appliqués à tout le monde.
- **Apprendre** : un cursus de 100 leçons, et le solo garde son graphe de résultats et son
  record personnel.
- **La Rich Presence** : les autres membres du serveur voient ce que vous jouez, avec les
  bonnes icônes et le temps écoulé.
- **Les résultats sont recalculés par le serveur.** Le classement ne dépend plus de ce que
  le client déclare : une arrivée exige le texte entier, et une arrivée annoncée sans
  l'avoir tapé est refusée.

### Hébergement

- Le jeu est joignable en permanence sur son propre domaine, via un **tunnel Cloudflare
  nommé** — l'adresse ne change plus à chaque redémarrage. Le backend tourne en service
  systemd et n'écoute que sur la boucle locale ; c'est Cloudflare qui termine le HTTPS.
- Chaque release contient un binaire Linux statique et le frontend compilé : rien à
  installer sur la machine qui héberge le jeu.

### Sécurité

- En-têtes de sécurité (dont la CSP) sur toutes les réponses du serveur, sans casser
  l'affichage dans l'iframe Discord.
- Un jeton émis pour une autre application est refusé, et le nombre de requêtes par joueur
  est plafonné.

### Documentation

- **`Docs/documentation.pdf`** : la documentation de référence du projet — fonctionnalités
  écran par écran, architecture, protocole WebSocket complet, base de données, sécurité,
  avec captures réelles et diagrammes. Livrée en thème sombre et en thème clair.
- Le `README.md` explique comment jouer, développer et héberger le jeu.

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
- En entrant dans un salon, le réglage « Décompte » annonçait 7 secondes une fraction de
  seconde avant de retomber sur la vraie valeur du salon. Il affiche tout de suite la
  bonne.

### Sous le capot

Rien de visible en jeu, mais c'est ce qui rend la suite plus sûre à écrire.

- Le cœur d'une partie tapée — l'horloge, le texte, le relevé de frappe, la condition
  d'échec — est désormais au même endroit pour les trois écrans où l'on tape (solo,
  course, Apprendre), au lieu d'être recâblé trois fois. Il est testé pour la première
  fois, et deux écarts entre les trois écrans ont disparu au passage.
- Les réglages de salon offerts par le lobby et ceux que le serveur accepte sont
  maintenant vérifiés l'un contre l'autre à chaque build. Quand les deux divergeaient,
  un réglage cliqué ne faisait rien du tout, sans le moindre message.
- Les leçons d'Apprendre sont devenues un fichier de contenu à part : les relire ou les
  corriger ne demande plus d'ouvrir du code.
- Le moteur multijoueur, jusque-là un seul fichier de 3 300 lignes, est séparé en trois —
  le fil réseau, le salon, la course.
