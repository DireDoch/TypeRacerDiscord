# Les deux captures qui restent

Seize des dix-huit captures du document sont réelles. Les deux ci-dessous ne
peuvent pas être produites en local : elles exigent un vrai client Discord avec
l'Activity publiée et un second compte. Ce sont aussi les deux plus précieuses —
ce sont les seules qui prouvent que le câblage Discord fonctionne, et aucun
schéma ne les remplace.

**Rien à modifier dans le Typst.** Écrase le fichier, relance `./Docs/build.sh`,
c'est tout.

---

## Préalable commun (une fois)

Le détail est dans le `README.md`, section « Mise en place Discord ». En résumé :

```sh
cd frontend && npm run build     # le backend sert dist/, pas le serveur Vite
cd backend  && cargo run         # PAS de « ⚠ MODE DEV » au démarrage
cloudflared tunnel --url http://localhost:8080
```

1. Copier l'URL du tunnel dans **Activities → URL Mappings** du portail
   développeur (Prefix `/`, Target = le domaine **sans** `https://`) → Save.
2. **App Testers** : inviter les *deux* comptes, et vérifier que chacun a
   **accepté l'invitation par courriel**. Une Activity non publiée reste
   invisible tant que ce n'est pas fait — c'est le piège qui coûte une session.
3. Les deux comptes rejoignent le **même salon vocal**.

Si l'app se charge mais que rien ne réagit : URL Mapping périmé (le quick tunnel
change d'adresse à chaque redémarrage).

---

## 1. `rich-presence.png`

> Ce qu'un **autre membre du salon vocal** voit dans Discord, **sans avoir
> ouvert l'Activity**.

### Mise en place

- **Compte A** lance l'Activity et va jusqu'à un **salon d'attente**, avec un
  Mode de jeu choisi. Prends **Floor is lava** ou **Spam** : leur visuel est
  plus parlant que celui de la course classique.
- **Compte B** reste dans le salon vocal et **n'ouvre pas** l'Activity.
- Sur le compte B : cliquer sur le nom du compte A dans la liste des membres
  (ou dans les participants du salon vocal) → la carte de profil s'ouvre et
  affiche la présence.

### Ce qui doit être lisible

| Élément | Valeur attendue |
| --- | --- |
| Ligne d'état | `Dans un salon` · `En course` · `S'entraîne` · `Floor is lava` · `Mode Spam` |
| Grand visuel | l'illustration du Mode de jeu — `race`, `floor-is-lava` ou `spam` |
| Petit visuel | l'icône de l'application, en pastille |
| Compte des présents | `2 sur 8` (n'apparaît qu'au salon d'attente) |
| Chrono | temps écoulé, ou restant pendant une course |

### Cadrage

Recadrer sur **la carte de profil**, pas sur tout l'écran. Le reste de Discord
n'apporte rien ici — c'est la capture suivante qui montre le contexte. Viser du
16/9 ou proche, **1280 px de large au minimum**.

### Si la présence n'apparaît pas

Le `setActivity` a échoué. Le bandeau rouge en bas du jeu le dira — c'est
exactement ce à quoi il sert.

---

## 2. `activity-salon-vocal.png`

> L'Activity **lancée depuis un salon vocal**, dans le client Discord.

### Mise en place

- Dans le salon vocal : **🚀 → Activités → TypeRacer → Lancer**.
- Attendre l'écran **Menu** (consentement `identify` à la première fois).

### Ce qui doit être lisible

- La **fenêtre Discord entière** : barre des serveurs, liste des salons, salon
  vocal avec ses participants.
- Le jeu **dans la zone de conversation**, à l'échelle de la fenêtre.

C'est le contexte qui fait la capture. **Ne recadre pas sur l'iframe seule** :
une capture du jeu seul, on en a déjà treize, et elle ne prouverait rien.

### Cadrage

Fenêtre Discord complète, **1920 px de large au minimum**. Thème sombre de
préférence — le document l'est aussi.

---

## Après

```sh
cp <ta-capture>.png Docs/captures/rich-presence.png
cp <ta-capture>.png Docs/captures/activity-salon-vocal.png
./Docs/build.sh
```

Une fois les deux en place, `_gabarit.typ` et `build.sh` de ce dossier ne
servent plus à rien : ils ne produisaient que les images d'attente. Ils peuvent
être supprimés.

## Un mot sur la vie privée

Si des pseudos ou avatars de tiers apparaissent dans le salon, floute-les ou
utilise un serveur de test avec deux comptes à toi. Le PDF est destiné à être
montré.
