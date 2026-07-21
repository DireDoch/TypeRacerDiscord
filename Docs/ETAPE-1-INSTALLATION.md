# Étape 1 — ce qu'il reste à lancer à la maison

Le code du socle visuel (`Docs/REFONTE-VISUELLE.md`, étape 1) est écrit et commitable tel
quel. Deux choses n'ont **pas** pu être faites ici, faute de réseau et de `node_modules` :
récupérer les `.woff2` et lancer la vérification. Tout est ci-dessous, dans l'ordre.

> PowerShell, depuis la racine du dépôt. Chaque bloc est indépendant.

## 1. Dépendances

```powershell
cd frontend
npm install
```

## 2. Les deux polices (les fichiers `.woff2`)

Le CSS les attend à des noms **précis** dans `frontend/public/fonts/` :

| fichier attendu | police | usage |
| --- | --- | --- |
| `inter-var.woff2` | Inter (variable) | interface : menu, titres, leçons, historique |
| `jetbrains-mono-400.woff2` | JetBrains Mono 400 | zone de frappe, chiffres, jauges |

### Par npm (le plus simple)

```powershell
cd frontend
npm i -D @fontsource-variable/inter @fontsource/jetbrains-mono
Copy-Item node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 public/fonts/inter-var.woff2
Copy-Item node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2 public/fonts/jetbrains-mono-400.woff2
```

Si un nom de fichier a changé côté paquet, liste ce qui est disponible :

```powershell
Get-ChildItem node_modules/@fontsource-variable/inter/files/*latin*.woff2
Get-ChildItem node_modules/@fontsource/jetbrains-mono/files/*latin-400*.woff2
```

Les deux paquets ne servent qu'à extraire les fichiers — une fois copiés, ils peuvent
partir (`npm uninstall @fontsource-variable/inter @fontsource/jetbrains-mono`). Les
`.woff2` sont dans `public/`, donc versionnés : **aucune dépendance à l'exécution, aucune
requête externe** — c'est ce qu'exige la CSP des Activities.

### À la main (si tu préfères)

- Inter variable : <https://github.com/rsms/inter/releases> → `InterVariable.woff2`
- JetBrains Mono : <https://github.com/JetBrains/JetBrainsMono/releases> → `JetBrainsMono-Regular.woff2`

Renomme-les selon le tableau ci-dessus et dépose-les dans `frontend/public/fonts/`.

> Tant que les fichiers sont absents, l'app **fonctionne** : `font-display: swap` laisse la
> pile de repli s'afficher (Segoe UI / Consolas). Seul le rendu diffère.

## 3. Vérification

```powershell
cd frontend
npm test          # history.test.ts a changé (libellés français)
npm run build     # tsc + vite : attrape les imports cassés
npm run dev       # http://localhost:5173
```

À regarder à l'œil, écran de Practice :

- [ ] le curseur est un **bloc corail qui glisse** d'un caractère à l'autre, sans clignoter ;
- [ ] le caractère **sous** le bloc reste lisible (il s'inverse en bleu nuit) ;
- [ ] le texte **à venir** est le plus clair, le texte **déjà tapé** est gris-bleu estompé ;
- [ ] une faute apparaît en **fond sourd rouge**, sans soulignement ;
- [ ] la barre de config dit `temps mots citations zen entraînement · ponctuation chiffres` ;
- [ ] aucune ligature : tape `->` et `!=`, deux glyphes distincts ;
- [ ] Historique : en-têtes `date type mode wpm précision durée`, valeurs `course` / `solo` ;
- [ ] écrans Race et Replay : même curseur, mêmes couleurs.

## 4. Ce qui n'est PAS dans cette étape

- Le **sélecteur de police** (Preference) et donc les **deux autres monos** — Commit Mono
  (<https://commitmono.com>, pas sur npm) et IBM Plex Mono (`@fontsource/ibm-plex-mono`) :
  c'est l'étape 2, avec les Preferences en `localStorage`.
- Le résumé dépliable de la barre de config (décision 9) : seuls les libellés en font partie.
- Les `@media` / le panneau réduit (décision 11), le photo-finish (3), le chemin vertical
  de l'écran Apprendre (7 — dépend de la branche `learn-cursus-complet`), le graphe SVG et
  la suppression de `chart.js` (13).

## 5. Détail des fichiers touchés

| fichier | changement |
| --- | --- |
| `frontend/src/style.css` | palette `:root`, deux `@font-face`, `--font-ui`/`--font-mono`, ligatures coupées, contraste inversé, faute en fond sourd, curseur bloc, `#2c2e31` → `var(--panel)` |
| `frontend/src/ui/practice.ts` | `MODE_LABELS` (source unique des libellés), libellés de la barre de config, `renderWord` pose `.at-cursor`, nouvelle `placeCaret`, enveloppe `.words-wrap` |
| `frontend/src/ui/race.ts` | enveloppe `.words-wrap` + `placeCaret` |
| `frontend/src/ui/replay.ts` | enveloppe `.words-wrap` + `placeCaret` |
| `frontend/src/ui/history.ts` | en-têtes et valeurs en français, filtres via `MODE_LABELS` |
| `frontend/src/ui/history.test.ts` | les 5 assertions qui figeaient les libellés anglais |
| `frontend/src/ui/results.ts` | 5 couleurs du graphe chart.js passées à la nouvelle palette (le graphe disparaît à l'étape 5) |
| `frontend/index.html` | `lang="fr"`, titre nettoyé |

Non touchés : `core/**` (dont `stats/scoreboard.ts` et les contrôleurs de saisie), `menu.ts`,
`learn.ts`, tout le backend.
