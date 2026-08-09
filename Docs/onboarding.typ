// Doc d'onboarding contributeur (issue #116).
//
// Autonome : ne reconvertit PAS CONTEXT.md, y renvoie plutôt — les deux
// maintenus en double dériveraient l'un de l'autre à la première frappe.
//
//   typst compile Docs/onboarding.typ Docs/onboarding.pdf

#import "../design/composants.typ": logo, nuit, corail, texte, panel

// Page de garde brandée : palette et logo de design/composants.typ.
#page(fill: nuit, margin: 0pt)[
  #align(center + horizon)[
    #logo(taille-texte: 2.6cm)
    #v(0.9cm)
    #text(fill: texte.darken(10%), size: 13pt)[Guide de démarrage — contributeurs]
  ]
]

// Corps sobre : composants.typ est pensé pour des assets 1024×1024/576, pas
// pour plusieurs pages de texte dense.
#set page(fill: white, margin: 2.5cm, numbering: "1", number-align: center)
#set text(size: 10.5pt, lang: "fr")
#set heading(numbering: "1.")
#set par(justify: true)
#show link: set text(fill: corail.darken(15%))

= Vue d'ensemble

TypeRacerDiscord est un jeu de vitesse de frappe embarqué dans Discord comme
Activity (Embedded App SDK) — backend Rust, frontend React/TypeScript.

Deux familles de Run : *Practice* (solo, entrée libre façon Monkeytype) et
*Race* (compétitif, en Room). Une Race se joue selon un *Mode de jeu* — la
règle qui décide comment elle se gagne :

- *Normal* — premier à taper le texte entier, exactement.
- *Floor is lava* — à intervalle fixe, le joueur le moins avancé est brûlé ;
  le dernier survivant gagne, sans ligne d'arrivée.
- *Spam* — un mot répété en boucle sur un texte infini ; la victoire va au
  seuil de répétitions ou au plafond de temps, selon lequel des deux tombe
  en premier.

Le salon Discord affiche l'activité en cours (Rich Presence) : statut mis à
jour côté client au fil des transitions de Run/Race (`updateActivity`,
`frontend/src/discord.ts`), visible par les autres membres du salon vocal
sans qu'ils aient besoin d'ouvrir l'Activity.

Le vocabulaire précis du domaine (Run, Mode, Mode de jeu, Réglage de salon,
Difficulté, Gap, Brûlé, Devancé, PB…) est défini dans #link("../CONTEXT.md")[`CONTEXT.md`],
à la racine du dépôt — ce document n'en reprend aucune définition, il y
renvoie systématiquement.

= Stack technique

*Backend* — Rust, `axum` (HTTP + WebSocket), `tokio`, `sqlx` (SQLite,
migrations), `reqwest` (proxy de citations), sert aussi le build statique du
frontend en production.

*Frontend* — TypeScript, Vite, `@discord/embedded-app-sdk` (intégration
Activity/OAuth Discord), `chart.js` (graphiques de résultats). Aucun
framework de vue — DOM manipulé directement.

*Tests* — `vitest` côté frontend (domaine TypeScript, référence de
l'algorithme de score), `cargo test` côté backend (parité avec le calcul
Rust + le store SQLite).

= Démarrage local

Prérequis : Rust (`cargo`) et Node (`npm`). Aucune clé Discord n'est requise
pour développer : le backend démarre en *mode dev*, où le Bearer token sert
directement de `player_id` (jouable au navigateur, hors Discord).

```sh
# Backend (port 8080)
cd backend
cargo run

# Frontend (port 5173, proxy /api /token /ws → 8080) — 2e terminal
cd frontend
npm install
npm run dev
```

```sh
# Tests
cd frontend && npx vitest run
cd backend  && cargo test
```

La mise en place complète pour tester *dans* Discord (tunnel `cloudflared`,
URL Mappings du portail développeur, pièges CSP connus) est déjà documentée
dans #link("../README.md")[`README.md`] — non reprise ici pour ne pas la
faire diverger.

= Décisions d'architecture

Les choix de conception qui ne se lisent pas depuis le code seul sont
enregistrés en ADR, `Docs/adr/`. Un résumé d'une phrase chacun pour naviguer
sans ouvrir les dix-sept fichiers :

+ #link("adr/0001-persist-target-text-verbatim.md")[Persister le texte cible verbatim] —
  le Replay stocke le texte tel que tapé plutôt que de le régénérer depuis un seed.
+ #link("adr/0002-display-identity-never-persisted.md")[L'identité d'affichage n'est jamais persistée] —
  nom et avatar sont annoncés à la connexion et oubliés, jamais écrits côté serveur.
+ #link("adr/0003-quotes-jamais-pb-eligible.md")[Les Quotes ne produisent jamais de PB] —
  leur longueur variable rend le Config bucket incomparable d'une Quote à l'autre.
+ #link("adr/0004-solo-sans-decompte.md")[Solo démarre sans décompte] —
  t = 0 devient la première frappe au lieu de masquer le texte pendant 3 s.
+ #link("adr/0005-trigram-drill-mode-separe.md")[Trigram Drill, un Mode séparé de Drill] —
  il retient aussi le caractère qui suit une faute, pas seulement celui qui la précède.
+ #link("adr/0006-cursus-apprendre-100-lecons.md")[Le cursus Apprendre passe à 100 leçons] —
  extension du cursus existant plutôt qu'un second système parallèle.
+ #link("adr/0007-decompte-race-reglage-produit.md")[Le décompte de Race passe à 7 s] —
  un réglage produit, choisi comme tel, pas une unité de mesure à figer.
+ #link("adr/0008-room-cle-salon-ou-code.md")[Une Room s'identifie par une clé] —
  salon vocal Discord OU code de partie, selon comment on y entre.
+ #link("adr/0009-race-source-de-texte-pas-de-mode.md")[Une Race n'a pas de Mode] —
  elle a une Source de texte (Quote ou Mots), un axe distinct du Mode solo.
+ #link("adr/0010-podium-raceover-porte-les-resultats.md")[`RaceOver` porte les résultats] —
  pas seulement l'ordre d'arrivée : le message porte directement le podium.
+ #link("adr/0011-play-of-the-game.md")[Play of the Game] —
  un duel choisi par le serveur, rejoué au ralenti sur une horloge partagée.
+ #link("adr/0012-leaderboard-confiance-au-recompute.md")[Le Leaderboard fait confiance au recompute] —
  aucun anti-triche dédié : le recompute autoritaire du backend suffit déjà.
+ #link("adr/0013-difficulte-race-normal-master-failed.md")[Difficulté et l'état Failed] —
  `Normal`/`Expert`/`Master`, ce dernier seul disponible et autoritaire en Race.
+ #link("adr/0014-plein-ecran-le-contenu-se-met-a-l-echelle.md")[Plein écran : le contenu s'échelonne] —
  jamais de scroll, le contenu se met à l'échelle de la fenêtre.
+ #link("adr/0015-floor-is-lava-mode-de-jeu.md")[Floor is lava] —
  un Mode de jeu à part entière, sans ligne d'arrivée : on gagne en survivant.
+ #link("adr/0016-spam-mode-de-jeu.md")[Spam] —
  texte infini, victoire au seuil de répétitions ou au plafond de temps.
+ #link("adr/0017-seam-mode-de-jeu-module-reglage-de-salon.md")[Seam Mode de jeu] —
  table déclarée pour `game_mode`, et un contrat de retour explicite pour les Réglages de salon.
