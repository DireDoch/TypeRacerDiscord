# Déployer TypeRacerDiscord en permanence

Ce document couvre le passage de « ça tourne pendant que je teste » à « les
joueurs peuvent jouer n'importe quand ». Le `DEPLOY.md` livré dans l'archive de
release décrit le binaire ; celui-ci décrit **l'hébergement**.

---

## D'abord : ce qui bloque aujourd'hui

Trois choses empêchent le jeu d'être disponible en permanence, et aucune n'est
un problème de code.

| Bloqueur | Pourquoi | Section |
| --- | --- | --- |
| Le **quick tunnel** change d'URL à chaque redémarrage | L'URL Mapping Discord se remet à la main. Un redémarrage de nuit = jeu cassé au matin | [Tunnel nommé](#1-le-tunnel-nommé--le-vrai-préalable) |
| Rien ne **redémarre tout seul** | `cargo run` dans un terminal meurt avec la session SSH | [Les deux services](#2-les-deux-services-systemd) |
| L'Activity n'est **pas publiée** | Seuls les App Testers la voient dans le menu 🚀 | [Publication](#5-côté-discord--qui-peut-jouer) |

**Ce ne sont pas trois commandes mais deux services.** En production il n'y a
pas de serveur frontend : le binaire Rust sert lui-même le build de Vite. Le
« terminal 2 » du README (`npm run dev`) n'existe qu'en développement.

---

## 1. Le tunnel nommé — le vrai préalable

Un `cloudflared tunnel --url …` tire une adresse au hasard à chaque lancement.
Un **tunnel nommé** garde la sienne : l'URL Mapping Discord se règle une fois et
plus jamais. Il faut un compte Cloudflare et un domaine (le domaine peut être
acheté chez eux, ~10 $/an).

```sh
cloudflared tunnel login                        # ouvre le navigateur, choisir le domaine
cloudflared tunnel create typeracer             # crée le tunnel + son fichier d'identifiants
cloudflared tunnel route dns typeracer typeracer.tondomaine.tld
```

`~/.cloudflared/config.yml` :

```yaml
tunnel: typeracer
credentials-file: /home/anthonyb/.cloudflared/<UUID>.json

ingress:
  - hostname: typeracer.tondomaine.tld
    service: http://localhost:8080
  - service: http_status:404
```

Test avant de continuer :

```sh
cloudflared tunnel run typeracer
```

> **Sans domaine ?** Un quick tunnel peut tenir si tu acceptes de remettre
> l'URL Mapping à chaque redémarrage. Ce n'est pas compatible avec « jouable
> n'importe quand ».

---

## 2. Les deux services systemd

### Le binaire et le build

Deux chemins. Le second est celui que le projet a prévu.

**a. Compiler sur la machine** (rapide à mettre en place)

```sh
cd frontend
VITE_DISCORD_CLIENT_ID=1533329189753585815 npm run build
cd ../backend && cargo build --release
```

⚠️ `VITE_DISCORD_CLIENT_ID` est **figée à la compilation** par Vite. Sans elle,
le bundle part en mode dev : tous les joueurs deviennent `dev-player-1`, et ça
ne se voit qu'une fois déployé. Elle vit dans le `.env` de la racine, que Vite
lit via `envDir` — la passer explicitement comme ci-dessus reste possible et
prend le dessus.

**b. Passer par une release** (reproductible, et jamais encore exercé)

Bumper `backend/Cargo.toml` en `0.0.5`, écrire la section `CHANGELOG.md`, fusionner
`develop` → `main`. La CI produit un binaire musl **entièrement statique** + le
`dist/` + un `DEPLOY.md`, dans une archive attachée à la release. La variable
`VITE_DISCORD_CLIENT_ID` est déjà posée sur le dépôt.

À noter : **ce travail n'a jamais tourné**. Les versions `v0.0.1` à `v0.0.3`
sont antérieures à son ajout, et `0.0.4` (la version actuelle) n'a jamais été
publiée. La première release réelle sera aussi le premier test de la chaîne.

### Les secrets

```sh
sudo install -d -m 0755 /etc/typeracer
sudo tee /etc/typeracer/env >/dev/null <<'EOF'
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
APININJAS_API_KEY=…
STATIC_DIR=/srv/typeracer/dist
DATABASE_URL=sqlite:/var/lib/typeracer/typeracer.db?mode=rwc
PORT=8080
EOF
sudo chmod 600 /etc/typeracer/env
sudo install -d -o typeracer -g typeracer /var/lib/typeracer
```

`DATABASE_URL` en **chemin absolu** : sinon la base est créée dans le dossier
courant du service, qui n'est pas celui auquel tu penses.

### `typeracer.service`

```ini
[Unit]
Description=TypeRacerDiscord — backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=typeracer
WorkingDirectory=/srv/typeracer
EnvironmentFile=/etc/typeracer/env
ExecStart=/srv/typeracer/typeracer-discord-backend
Restart=on-failure
RestartSec=5

# Le binaire n'a besoin de rien d'autre que sa base.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/typeracer

[Install]
WantedBy=multi-user.target
```

### `cloudflared.service`

`cloudflared` pose son unité tout seul :

```sh
sudo cloudflared service install
```

Il lit `/etc/cloudflared/config.yml` — y copier le `config.yml` et le fichier
d'identifiants créés plus haut.

### Démarrer

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now typeracer cloudflared
systemctl status typeracer cloudflared
journalctl -u typeracer -f
```

**Les deux commandes qui comptent**, une fois tout en place :

```sh
sudo systemctl enable --now typeracer     # le jeu, redémarre seul, survit au reboot
sudo systemctl enable --now cloudflared   # le tunnel, même chose
```

---

## 3. Ce qu'un redémarrage casse

**Les Rooms vivent en mémoire et meurent avec le processus.** Un
`systemctl restart typeracer` vide tous les salons et interrompt toute course en
cours — les joueurs sont éjectés sans message. Les Runs solo, eux, sont en base
et survivent.

Conséquence pratique : déployer aux heures creuses, et ne pas mettre de
redémarrage périodique dans un timer. `Restart=on-failure` (et non `always`)
est délibéré.

---

## 4. La base et les sauvegardes

Un seul fichier SQLite. Les migrations sont **compilées dans le binaire** et
s'appliquent au démarrage : rien à lancer à la main.

```sh
sudo -u typeracer sqlite3 /var/lib/typeracer/typeracer.db \
  ".backup '/var/lib/typeracer/backup-$(date +%F).db'"
```

`.backup` et non `cp` : la copie brute d'une base en cours d'écriture peut être
incohérente. Un timer systemd quotidien suffit largement — le volume est celui
de quelques milliers de Runs.

---

## 5. Côté Discord : qui peut jouer

C'est ici que se joue vraiment « n'importe quand ».

### L'URL Mapping (une fois, grâce au tunnel nommé)

**Activities → URL Mappings** : Prefix `/`, Target `typeracer.tondomaine.tld`
(**sans** `https://`) → Save.

### Tant que l'app n'est pas publiée

Seuls les **App Testers** voient l'activité dans le menu 🚀 — et seulement
après avoir **accepté l'invitation par courriel**. C'est le piège n°1 : l'app
est parfaitement fonctionnelle et reste invisible.

Pour ouvrir à n'importe qui, il faut **publier l'application** dans le portail
(App Directory), ce qui passe par une revue de Discord. Prévois-y :

- les liens **Terms of Service** et **Privacy Policy** dans *General
  Information* — pointe-les sur `TERMS.md` et `PRIVACY.md` du dépôt, ils
  existent déjà et c'est exactement pour ça ;
- une description, une icône et une cover — déjà produites dans `design/out/` ;
- l'app vit sur un **compte dev dédié, sans team** (une app en team exige la 2FA
  de tous ses membres à chaque action sensible).

### Installation sur un serveur

**Installation → Guild Install** → ouvrir le lien avec le compte admin du
serveur → Autoriser. À refaire pour chaque serveur Discord où le jeu doit
apparaître.

---

## 6. Avant d'ouvrir aux joueurs

- [ ] **Faire tourner les secrets Discord.** Ils ont traîné en clair dans
      `backend/.env` sur la machine de développement (ce fichier a depuis été fusionné dans le `.env` de la racine). Le fichier n'a jamais été
      committé (il est dans `.gitignore`), mais un secret qui a été exposé se
      remplace : *OAuth2 → Reset Secret*, puis mettre à jour
      `/etc/typeracer/env` seulement.
- [ ] Vérifier qu'aucun `⚠️ MODE DEV` n'apparaît dans `journalctl -u typeracer`.
      S'il est là, les secrets ne sont pas lus et **n'importe qui peut se faire
      passer pour n'importe qui**.
- [ ] Lancer une course complète à deux comptes dans Discord, avatars affichés,
      console sans violation CSP — ce sont les critères de l'issue #152, encore
      ouverte.
- [ ] Vérifier `APININJAS_API_KEY` : sans elle, les courses en Source « Citation »
      échouent. Le quota est mensuel et partagé — le plafond serré du proxy est
      là pour ça.
- [ ] Confirmer que le tunnel remonte tout seul après un `sudo reboot`.
