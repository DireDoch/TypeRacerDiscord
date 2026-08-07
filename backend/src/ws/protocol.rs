// =============================================================================
//  Protocole WebSocket de la Race (Room). Miroir de frontend/src/core/net.ts.
//
//  Le serveur possède la vérité terrain (seed/texte + t=0) : le client n'envoie
//  jamais le texte ni la durée de référence. Voir Docs/PHASE2.md.
//
//  Une Room a UNE clé, sous deux formes (ADR 0008) : un salon vocal ou un Code de
//  partie. D'où trois portes d'entrée distinctes plutôt qu'un `JoinRoom` générique —
//  elles n'ont pas les mêmes droits de création (voir `ws/mod.rs`).
// =============================================================================

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub use crate::domain::difficulty::Difficulty;
use crate::domain::types::{Keystroke, PerSecondPoint};

/// Clé d'une Room : soit un `ChannelId`, soit un Code de partie. Les deux formes ne
/// peuvent pas se confondre — un snowflake fait 18-19 chiffres, un code en fait 5.
pub type RoomKey = String;
/// Identifiant de salon vocal Discord (snowflake).
pub type ChannelId = String;
/// Discord user ID (snowflake), toujours en string.
pub type PlayerId = String;

/// D'où vient le texte d'une Race (ADR 0009).
///
/// Ce n'est **pas** un Mode : la règle de fin d'une Race est toujours « le texte entier,
/// exactement ». Time signifierait une autre condition de fin et des voitures sans ligne
/// d'arrivée commune ; Zen n'a pas de fin du tout. Ce que le party leader choisit, c'est
/// la provenance du texte — le recompute autoritaire reste `Words` dans tous les cas.
///
/// Wire : `{"kind":"quote"}` ou `{"kind":"words","count":30}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextSource {
    /// Citation via le proxy serveur. Sa longueur appartient à la citation, pas au lobby.
    Quote,
    /// Texte généré. `count` est le repli à durée maîtrisée : une citation de 400
    /// caractères imposerait une course longue à huit personnes sans échappatoire.
    Words { count: u32 },
}

impl Default for TextSource {
    /// Défaut = Quote, ce que demande le brief de la section D.
    fn default() -> Self {
        TextSource::Quote
    }
}

/// Comment une Race se GAGNE (ADR 0015) — un axe à part entière.
///
/// Ni un Mode (solo, décide du texte), ni une Source de texte (décide d'où vient le
/// texte), ni une Difficulté (condition d'échec INDIVIDUELLE, évaluée sur le seul log du
/// joueur — l'élimination, elle, est COMPARATIVE). Un seul à la fois : ce sont des règles
/// de victoire, elles ne se cumulent pas.
///
/// Wire : `"normal"` | `"floorIsLava"` | `"spam"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameMode {
    /// Le premier à taper tout le texte, exactement. Le comportement historique.
    #[default]
    Normal,
    /// Élimination du moins avancé à intervalle régulier ; le dernier vivant gagne.
    /// Pas de ligne d'arrivée : le mode impose un texte que personne ne peut finir.
    FloorIsLava,
    /// Un seul mot, répété indéfiniment (ADR 0016). Gagne qui verrouille le premier le
    /// seuil de répétitions correctes — ou, si le plafond de temps tombe avant, qui en a
    /// le plus. Pas de ligne d'arrivée non plus : le texte ne s'épuise jamais.
    ///
    /// Variante NUE, alors que l'ADR l'écrivait `Spam { word_source, threshold,
    /// time_cap_s }` : ses trois réglages vivent à plat sur `Room`, comme
    /// `lava_interval_s`. Écart assumé — les porter dans la variante rendrait `GameMode`
    /// non-`Copy` et ferait perdre au lobby les réglages préparés avant la bascule, que
    /// le patron existant conserve précisément pour qu'y revenir les retrouve.
    Spam,
}

/// Longueur max d'un nom affiché. Ce n'est pas une règle Discord, c'est une protection
/// de mise en page : un nom de 4 000 caractères casserait la piste des SEPT autres.
const MAX_DISPLAY_NAME: usize = 32;
/// Longueur max d'un hash d'avatar Discord (32 hex, + le préfixe `a_` des animés).
const MAX_AVATAR_HASH: usize = 34;

/// La Display identity, **annoncée par le client** à la jointure.
///
/// Le serveur ne la résout PAS via `/users/@me` : le glossaire autorise un override de
/// pseudo qui appartient au device, et une résolution serveur l'écraserait. Elle n'est
/// donc ni vérifiée ni persistée — deux joueurs peuvent afficher le même nom, c'est assumé.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub display_name: String,
    /// Hash d'avatar Discord — **jamais une URL**. Chaque client reconstruit
    /// `cdn.discordapp.com/avatars/{id}/{hash}.png` lui-même : une URL fournie par un
    /// client serait une URL arbitraire chargée dans le navigateur des sept autres.
    pub avatar_hash: Option<String>,
}

impl Identity {
    /// Ramène une identité venue du réseau à quelque chose d'affichable sans danger.
    ///
    /// Le rendu client échappe déjà le HTML, donc le sujet ici n'est pas l'injection :
    /// c'est qu'un nom démesuré ou un hash fantaisiste dégradent l'écran des AUTRES.
    /// Un hash hors `[0-9a-f_]` est jeté plutôt que corrigé — il désignerait un chemin
    /// arbitraire sur le CDN, et l'avatar par défaut est une repli parfaitement valable.
    pub fn sanitized(self) -> Identity {
        let display_name: String = self
            .display_name
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_DISPLAY_NAME)
            .collect();
        let avatar_hash = self.avatar_hash.filter(|h| {
            !h.is_empty()
                && h.len() <= MAX_AVATAR_HASH
                && h.chars().all(|c| c.is_ascii_hexdigit() || c == '_')
        });
        Identity { display_name: display_name.trim().to_string(), avatar_hash }
    }
}

/// Un présent, tel que la piste et le podium le dessinent. `player_id` reste la vérité
/// durable (il possède les Runs) ; le reste n'est que la façon de le dessiner.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerEntry {
    pub player_id: PlayerId,
    pub display_name: String,
    pub avatar_hash: Option<String>,
    /// Prêt pour le ready-check (issue #63). Sans objet quand `ready_check` est
    /// désactivé — `false` par défaut, jamais lu dans ce cas.
    pub ready: bool,
}

/// L'arrivée d'un partant, telle que le podium l'affiche (ADR 0010).
///
/// Le serveur possédait déjà tout ça — il le calculait au Finish, s'en servait pour
/// classer, puis n'en gardait que le WPM. Il le retient désormais jusqu'à la clôture.
/// C'est ce qui permet au podium d'afficher le **Gap** (dérivé des `duration_ms`) et de
/// déplier le graphe d'un joueur **sans aucun aller-retour**.
///
/// On ne passe PAS par `GET /api/runs/:id` : cet endpoint est délibérément scopé au
/// demandeur, et le serveur ne peut pas vérifier après coup « tu étais partant de cette
/// course » (la composition vit dans la Room, en mémoire, et meurt avec elle). Le
/// WebSocket n'a pas ce problème : il n'atteint que les sockets de la Room.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceResult {
    pub player_id: PlayerId,
    pub wpm: f64,
    pub accuracy: f64,
    pub duration_ms: f64,
    /// Abandon (volontaire ou déconnexion) : aucun recompute n'est fait sur son log,
    /// donc pas de série et pas de graphe à déplier.
    pub forfeit: bool,
    /// Échec Difficulté Master (issue #71, ADR 0013) — distinct d'un Abandon (involontaire),
    /// mêmes mécaniques par ailleurs. Pourcentage d'avancement au moment de la faute,
    /// affiché (« failed (X%) ») mais JAMAIS utilisé pour classer. `None` sinon.
    pub failed_percent: Option<i64>,
    /// Brûlé en floor is lava (ADR 0015) : instant du décès, en ms depuis t=0. C'est ce
    /// qui CLASSE dans ce mode (ordre des décès inversé) et ce que le podium affiche en
    /// gros à la place du Gap, qui n'existe pas ici. `None` = pas brûlé — donc le
    /// survivant, ou n'importe quelle arrivée d'une Race normale.
    ///
    /// Un Brûlé porte un VRAI score partiel (wpm/accuracy/per_second recomputés sur ce
    /// qu'il a eu le temps de taper), contrairement à un Abandon ou à un Échec Master qui
    /// sont construits en dur à zéro. Ce score ne le classe jamais : il l'affiche, et il
    /// choisit le duel.
    pub burned_at_ms: Option<f64>,
    /// Répétitions correctes sous le Mode de jeu Spam (ADR 0016), recomptées par le
    /// SERVEUR sur le log (`domain::spam::count_reps`) contre sa propre copie du mot —
    /// jamais le compte déclaré en cours de course. C'est ce qui CLASSE dans ce mode et
    /// ce que le podium affiche en gros à la place du Gap, qui n'existe pas ici.
    ///
    /// `None` hors Spam — et c'est aussi à ça que le podium reconnaît le mode, sans
    /// qu'aucun champ de mode n'ait à voyager jusqu'à lui (même astuce que `burned_at_ms`).
    pub reps: Option<u32>,
    /// Caractères corrects de la répétition EN COURS au moment du clap. Départage deux
    /// Players à égalité de répétitions (ADR 0016) et ne sert QU'À ÇA : il ne voyage pas,
    /// le classement étant déjà l'ordre du tableau.
    #[serde(skip)]
    pub spam_partial: u32,
    pub per_second: Vec<PerSecondPoint>,
}

impl RaceResult {
    /// Une arrivée qui n'en est pas une. Valeurs explicites plutôt qu'un recompute sur
    /// un log vide — l'accuracy y vaudrait 100, pas 0 (piège de l'issue #23).
    pub fn forfeited(player_id: &str) -> RaceResult {
        RaceResult {
            player_id: player_id.to_string(),
            wpm: 0.0,
            accuracy: 0.0,
            duration_ms: 0.0,
            forfeit: true,
            failed_percent: None,
            burned_at_ms: None,
            reps: None,
            spam_partial: 0,
            per_second: Vec::new(),
        }
    }

    /// Échec Master : même forme qu'un Abandon (0 WPM, aucun recompute, jamais persisté)
    /// mais `forfeit: false` — un échec est involontaire, ADR 0013 le veut distinct.
    pub fn failed(player_id: &str, percent: i64) -> RaceResult {
        RaceResult {
            player_id: player_id.to_string(),
            wpm: 0.0,
            accuracy: 0.0,
            duration_ms: 0.0,
            forfeit: false,
            failed_percent: Some(percent),
            burned_at_ms: None,
            reps: None,
            spam_partial: 0,
            per_second: Vec::new(),
        }
    }
}

/// Le duel le plus serré d'une Race, rejoué au ralenti après la course (ADR 0011).
///
/// Le SERVEUR choisit la paire (fonction `duel`, purement en Rust) et ne transporte que
/// **ses deux logs**, jamais les huit : le client ne rejoue pas le choix, il reçoit le
/// résultat. Les temps d'arrivée ne voyagent pas non plus — le client les dérive du
/// dernier `t` de chaque log (on ne finit qu'à texte 100 % exact, la dernière frappe EST
/// l'arrivée). `None` côté `RaceOver` = pas de duel, le bouton est absent du podium.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayOfTheGame {
    pub a: PlayerId,
    pub log_a: Vec<Keystroke>,
    pub b: PlayerId,
    pub log_b: Vec<Keystroke>,
}

/// Messages Client → Serveur.
/// Wire : JSON internally-tagged, ex. `{ "type": "JoinChannel", "channelId": "123" }`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    /// Rejoindre la Room du salon vocal courant, en la CRÉANT si elle n'existe pas.
    /// La clé vient du SDK Discord : elle est authentique, elle ne peut pas être
    /// mal tapée — d'où la création à la volée.
    JoinChannel { channel_id: ChannelId, identity: Identity },
    /// Créer une Room à Code de partie. Le serveur tire le code et le renvoie dans
    /// le `RoomState` qui suit.
    CreateRoom { identity: Identity },
    /// Rejoindre une Room par son Code de partie. Ne crée JAMAIS : un code vient du
    /// clavier d'un joueur, et créer sur une faute de frappe l'enfermerait seul dans
    /// une Room fantôme. Code inconnu → `RoomNotFound`.
    JoinCode { code: String, identity: Identity },
    /// Régler la Source de texte de la prochaine course — accepté du seul owner, et
    /// seulement hors course (ignoré sinon). Déclenche la regénération du texte.
    SetTextSource { source: TextSource },
    /// Régler la taille max de la Room (2–8) — accepté du seul owner, et seulement hors
    /// course (ignoré sinon). Ne porte que sur les arrivées : personne n'est expulsé.
    SetMaxPlayers { max: u32 },
    /// Régler la durée du décompte avant le départ (3/5/7/10 s) — accepté du seul owner,
    /// et seulement hors course (ignoré sinon).
    SetCountdown { seconds: u32 },
    /// Activer/désactiver le ready-check — accepté du seul owner, et seulement hors
    /// course. Réinitialise les prêts déjà marqués (nouveau départ à zéro).
    SetReadyCheck { enabled: bool },
    /// Se marquer prêt/pas prêt — accepté de N'IMPORTE quel présent, hors course. Sans
    /// effet sur `StartRace` tant que `ready_check` est désactivé.
    SetReady { ready: bool },
    /// Régler la Difficulté de la Room (Normal | Master — Expert n'est pas un Réglage
    /// de salon, ADR 0013) — accepté du seul owner, et seulement hors course.
    SetDifficulty { difficulty: Difficulty },
    /// Régler le Mode de jeu (ADR 0015) — accepté du seul owner, hors course. Basculer
    /// vers/depuis floor is lava REGÉNÈRE le texte : le mode impose le sien.
    SetGameMode { mode: GameMode },
    /// Régler l'intervalle d'élimination de floor is lava, en secondes — accepté du seul
    /// owner, hors course, parmi `LAVA_INTERVAL_VALUES`. Inerte sous `Normal`.
    SetLavaInterval { seconds: u32 },
    /// Régler le mot de Spam (ADR 0016) — accepté du seul owner, hors course. `None` =
    /// mot par défaut, tiré de la liste de la Source `Mots`. `Some(w)` = mot personnalisé,
    /// VALIDÉ côté serveur (non vide, sans espace, ≤ 20 caractères) : un espace
    /// transformerait « un mot répété » en plusieurs mots cibles et casserait le comptage.
    /// Regénère le texte, qui est ce mot répété.
    SetSpamWord { word: Option<String> },
    /// Régler le seuil de répétitions qui gagne la Race — accepté du seul owner, hors
    /// course, parmi `SPAM_THRESHOLD_VALUES`. Inerte hors `Spam`.
    SetSpamThreshold { count: u32 },
    /// Régler le plafond de temps de Spam, en secondes — accepté du seul owner, hors
    /// course, parmi `SPAM_TIME_CAP_VALUES`. Inerte hors `Spam`.
    SetSpamTimeCap { seconds: u32 },
    /// Lancer la course — accepté du seul owner de la Room (ignoré sinon).
    StartRace,
    /// Progression de frappe (diffusée pour le rendu des "voitures"). Pas autoritaire.
    ///
    /// `reps` = répétitions correctes DÉCLARÉES sous le Mode de jeu Spam (ADR 0016), 0
    /// partout ailleurs. `chars_done` ne pourrait pas les porter : un mot faux avance les
    /// caractères sans être une répétition. Déclaratif comme `chars_done` — mais il ne
    /// fait qu'ARRÊTER la course, il ne la gagne pas : le classement vient du recompute
    /// serveur au `Finish`. `default` : un client qui ne connaît pas le champ reste lisible.
    Progress {
        chars_done: u32,
        #[serde(default)]
        reps: u32,
    },
    /// Soumission finale : log brut + durée. Le serveur recompute contre SON texte
    /// (seed/texte/config lui appartiennent — jamais renvoyés par le client).
    Finish { keystrokes: Vec<Keystroke>, ended_at_ms: f64 },
    /// Abandon VOLONTAIRE : le joueur renonce à la course en cours mais RESTE au lobby
    /// pour la suivante. Enregistré comme une arrivée en abandon (0 WPM, flag explicite,
    /// aucun recompute ni persistance) — même enregistrement qu'une déconnexion, un seul
    /// chemin de code. Débloque la fin pour les autres au lieu de les faire attendre le
    /// watchdog.
    Forfeit,
    /// Échec Difficulté Master (issue #71, ADR 0013) : le client a détecté localement
    /// (même logique pure que Practice) sa 1re frappe incorrecte et arrête d'y toucher.
    /// Le serveur REJOUE le log contre SON texte pour confirmer l'échec avant de
    /// l'enregistrer — jamais fait confiance sur la seule parole du client.
    Fail { keystrokes: Vec<Keystroke> },
    LeaveRoom,
}

/// Messages Serveur → Client. `Clone` : diffusé via broadcast à tous les sockets.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ServerEvent {
    /// État de la Room (présence + owner + config), re-diffusé à chaque join/leave.
    /// `code` porte le Code de partie quand la Room en a un — c'est ce qui permet à
    /// N'IMPORTE quel membre du lobby de le lire pour inviter, pas seulement au
    /// créateur. `None` pour une Room de salon vocal.
    RoomState {
        /// Les présents AVEC leur Display identity — c'est ce que la piste dessine.
        players: Vec<PlayerEntry>,
        owner: PlayerId,
        seed: u64,
        target_text: String,
        code: Option<String>,
        /// Source EFFECTIVE du texte affiché. Un repli après échec du proxy de citations
        /// se lit donc ici : la Room bascule réellement sur `Words`, il n'y a pas de
        /// « Quote demandée mais pas obtenue » à représenter en plus.
        text_source: TextSource,
        /// Taille max courante de la Room. Lue par TOUT le lobby : « 3/5 » se dessine
        /// chez les non-hôtes aussi, ils subissent le réglage.
        max_players: u32,
        /// Durée du décompte avant le départ, en secondes. Lue par TOUT le lobby : le
        /// décompte s'impose aussi aux non-hôtes.
        countdown_s: u32,
        /// Ready-check activé ou non (issue #63). L'état « prêt » de chacun se lit sur
        /// `players[].ready`, pas ici.
        ready_check: bool,
        /// Difficulté de la Room (Normal | Master, issue #71, ADR 0013).
        difficulty: Difficulty,
        /// Mode de jeu de la Room (ADR 0015). Lu par TOUT le lobby : il décide comment on
        /// gagne, les non-hôtes le subissent autant que le décompte.
        game_mode: GameMode,
        /// Intervalle d'élimination de floor is lava, en secondes. Toujours transporté
        /// (le lobby l'affiche dès que le mode est choisi), inerte sous `Normal`.
        lava_interval_s: u32,
        /// Mot personnalisé de Spam, ou `None` quand la Room utilise le mot par défaut.
        /// Le mot RÉELLEMENT en jeu se lit toujours dans `target_text` (il en est la
        /// répétition) ; ce champ ne dit que ce que l'owner a choisi, pour redessiner
        /// son champ de saisie tel qu'il l'a laissé.
        spam_word: Option<String>,
        /// Seuil de répétitions qui gagne la Race. Inerte hors `Spam`.
        spam_threshold: u32,
        /// Plafond de temps de Spam, en secondes. Inerte hors `Spam`.
        spam_time_cap_s: u32,
    },
    /// Top de départ partagé : t=0 pour TOUS les clients (cale les horloges locales).
    RaceStart { start_at_epoch_ms: i64 },
    /// Position d'un adversaire (rendu temps réel). `reps` porte son compte de répétitions
    /// sous Spam (ADR 0016), 0 partout ailleurs — c'est ce que la piste affiche à la place
    /// du WPM dans ce mode, la répétition étant la grandeur qui décide de la victoire.
    PlayerProgress { player_id: PlayerId, chars_done: u32, reps: u32 },
    /// Scoreboard autoritaire d'un joueur ayant fini (recompute serveur). `forfeit`
    /// distingue une VRAIE arrivée d'un abandon : la piste affiche « abandon » plutôt
    /// que « 0 wpm » pendant la course (le podium, lui, lit RaceOver). `failed_percent`
    /// distingue un Échec Master (ADR 0013) — jamais les deux à la fois.
    PlayerFinished { player_id: PlayerId, wpm: f64, forfeit: bool, failed_percent: Option<i64> },
    /// Élimination floor is lava (ADR 0015) : ce joueur vient de brûler, à `at_ms` depuis
    /// t=0. Diffusé AVANT que son log n'arrive — c'est ce message qui le lui demande, en
    /// lui disant d'arrêter de taper. `PlayerFinished` suivra quand le log sera recompté.
    ///
    /// Plusieurs `PlayerBurned` peuvent tomber sur le même tic (égalité : les deux
    /// brûlent). Le survivant n'a pas d'événement à lui : il déduit qu'il a gagné en
    /// voyant qu'il ne reste que lui de vivant — il connaît les partants et les brûlés.
    PlayerBurned { player_id: PlayerId, at_ms: f64 },
    /// Arrêt d'une Race sous Spam (ADR 0016) : quelqu'un a verrouillé le seuil de
    /// répétitions, ou le plafond de temps a expiré. Un seul message pour les deux — le
    /// mode ne les distingue pas non plus, et personne n'a besoin de savoir lequel des
    /// deux a claqué pour arrêter de taper.
    ///
    /// Diffusé UNE fois, à TOUT LE MONDE (contrairement à `PlayerBurned`, qui vise un
    /// joueur) : c'est ce message qui demande à chacun son log. Il ne désigne AUCUN
    /// vainqueur, délibérément — le seul classement est celui du recompute serveur qui
    /// suit, dans `RaceOver`. Une déclaration de répétitions gonflée peut donc arrêter la
    /// Race trop tôt, jamais la gagner.
    SpamStop,
    /// Fin de course : les résultats COMPLETS, dans l'ordre du classement (ADR 0010).
    /// L'ordre du tableau EST le classement — il n'y a pas de champ d'ordre séparé.
    /// `play_of_the_game` porte les deux logs du duel le plus serré (ADR 0011), ou
    /// `None` s'il n'y a pas eu de duel (< 2 finisseurs, ou meilleur écart > 2 s).
    RaceOver { results: Vec<RaceResult>, play_of_the_game: Option<PlayOfTheGame> },
    /// Code de partie inconnu. Envoyé au SEUL socket demandeur (pas de diffusion :
    /// il n'y a aucune Room à qui le diffuser). Le socket reste ouvert — le joueur
    /// corrige son code et retente sans se reconnecter.
    RoomNotFound,
    /// Room déjà à sa taille max. Même traitement : réponse directe, socket gardé.
    RoomFull,
}
