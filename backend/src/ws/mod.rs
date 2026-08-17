// =============================================================================
//  ws/mod.rs — le FIL : état partagé des Rooms, boucle socket, dispatch (Phase 2).
//
//  Câblé au routeur Axum via `/ws` (voir main.rs). Ce fichier possède les TYPES que tout
//  le module partage (`Room`, `RaceState`, `Rooms`), la boucle d'une connexion, le
//  dispatch des `ClientEvent`, et l'horloge commune. Le reste vit à côté (#205) :
//
//   - `room.rs` — la Room comme LIEU : entrer, sortir, présence, owner, Code de partie,
//     et le texte d'une Room (génération, Source, aller-retour d'une citation).
//   - `race_engine.rs` — le déroulé d'une course : départ, progression, arrivées,
//     clôture et classement, Play of the Game, watchdog et tics des Modes de jeu.
//   - `room_setting.rs` — la garde d'un Réglage de salon (ADR 0017).
//   - `game_mode.rs` — la table de règles d'un Mode de jeu (ADR 0017).
//   - `tests.rs` — les tests des trois premiers, ensemble (helpers partagés).
//
//  Les invariants qui traversent tout ça, une fois pour toutes :
//   - Une Room est indexée par une CLÉ, sous deux formes (ADR 0008) : le salon vocal
//     (`channel_id`, créée à la volée — la clé vient du SDK, elle est authentique) ou
//     un Code de partie (créée seulement sur `CreateRoom`, jamais à la volée : un code
//     vient d'un clavier, une faute de frappe enfermerait le joueur seul dans une Room
//     fantôme). Une seule HashMap, aucune table de correspondance.
//   - Présence : JoinChannel/CreateRoom/JoinCode enregistrent le joueur, LeaveRoom /
//     déconnexion le retire. Chaque changement re-DIFFUSE RoomState (présence + owner
//     + code) à tous les sockets de la Room via un broadcast::Sender par Room.
//     Plafond de MAX_PLAYERS présents ; au-delà, RoomFull.
//   - Owner = premier joueur à rejoindre ; passe au suivant s'il part. Seul l'owner
//     peut lancer : StartRace → RaceStart{start_at_epoch_ms} diffusé à tous (t=0).
//     Les PARTANTS sont figés au RaceStart : arrivées/départs en cours de course ne
//     bloquent ni ne clôturent la fin (voir all_racers_done).
//   - Le serveur possède la vérité terrain : seed + texte cible générés à la création
//     de la Room (domain::text_gen), regénérés après chaque course (revanche).
//   - Progress relayé (barres live) ; Finish → recompute autoritaire → RaceOver.
//   - Le `Mutex` std des Rooms n'est JAMAIS tenu à travers un `await` (CONTEXT.md).
// =============================================================================

#![allow(dead_code)]

pub mod protocol;

mod game_mode;
mod race_engine;
mod room;
mod room_setting;

#[cfg(test)]
mod tests;

// Ré-export à plat : `ws` reste UNE surface pour ses voisins (`main.rs`, `game_mode.rs`,
// `room_setting.rs`, les tests). Le découpage de #205 est une affaire d'organisation
// interne — il n'a pas à se voir dans un chemin d'import.
pub(crate) use race_engine::*;
pub(crate) use room::*;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sqlx::sqlite::SqlitePool;
use tokio::sync::broadcast;

use game_mode::rules;
use room_setting::{apply_setting, RoomSetting, SettingOutcome};

use crate::domain::difficulty::{detect_difficulty_failure, Difficulty};
use crate::domain::replay::{compute_scoreboard, ScoreInput};
use crate::domain::text_gen::{generate_text, GenSettings};
use crate::domain::types::{Keystroke, Mode, RunConfig};
use crate::quote::QuoteClient;
use protocol::{
    ClientEvent, GameMode, Identity, PlayOfTheGame, PlayerEntry, PlayerId, RaceResult, RoomKey,
    ServerEvent, TextSource,
};

/// Longueur d'un texte `Words` en Race — les trois seules valeurs acceptées (ADR 0009).
/// Un `count` arbitraire venu du client imposerait une course de longueur quelconque aux
/// sept autres : c'est une frontière de confiance, pas une commodité d'affichage.
const WORDS_LENGTHS: [u32; 3] = [15, 30, 50];
/// Longueur par défaut et de repli (échec du proxy de citations).
const ROOM_WORD_COUNT: u32 = 30;
/// Intervalles d'élimination proposés en floor is lava (ADR 0015). Jeu fixe, comme
/// `COUNTDOWN_VALUES` : à 3 s la course devient illisible, à 60 s elle dure huit minutes.
const LAVA_INTERVAL_VALUES: [u32; 4] = [5, 10, 15, 20];
/// Intervalle par défaut.
const LAVA_INTERVAL_DEFAULT: u32 = 10;
/// Longueur du texte imposé par floor is lava (ADR 0015) : ~1 200 caractères, ~4 min à
/// 60 WPM contre 70 s de course maximum à huit joueurs. C'est ce qui SUPPRIME la ligne
/// d'arrivée — un mode qui se gagne à la survie ne doit pas offrir de victoire à
/// l'arrivée. Toutes les Sources de texte du lobby en finiraient trop tôt (ADR 0015).
const LAVA_WORD_COUNT: u32 = 200;
/// Seuils de répétitions proposés en Spam (ADR 0016). Paliers fixes, comme la longueur de
/// la Source `Mots` et comme `LAVA_INTERVAL_VALUES` — jamais un nombre libre venu du
/// client : c'est un réglage qui s'impose aux sept autres.
const SPAM_THRESHOLD_VALUES: [u32; 4] = [10, 20, 30, 50];
/// Seuil par défaut.
const SPAM_THRESHOLD_DEFAULT: u32 = 20;
/// Plafonds de temps proposés en Spam, en secondes. Paliers fixes eux aussi, et plafonnés
/// à 60 s (ADR 0016) : au-delà, la seconde façon de gagner cesse d'en être une.
const SPAM_TIME_CAP_VALUES: [u32; 4] = [15, 30, 45, 60];
/// Plafond de temps par défaut.
const SPAM_TIME_CAP_DEFAULT: u32 = 30;
/// Longueur max d'un mot personnalisé de Spam (ADR 0016).
const SPAM_WORD_MAX_LEN: usize = 20;
/// Combien de répétitions le serveur pose d'avance dans `target_text` — de quoi remplir
/// les lignes visibles au départ. Ce n'est PAS une longueur de course : le client allonge
/// le texte tout seul au fur et à mesure (c'est le même mot, il n'a rien à demander), ce
/// qui est exactement ce que « texte infini » veut dire ici (ADR 0016).
///
/// À partir de la première rallonge, c'est `SPAM_LOOKAHEAD` (`ui/race.ts`, via `spamRefill`)
/// qui décide seul de la longueur — cette constante-ci ne sert qu'à l'amorce.
const SPAM_LEAD_WORDS: usize = 60;
/// Plafond DUR de répétitions reconstruites pour le recompute d'un log de Spam. Le log
/// vient du client : sans borne, un log gonflé d'espaces ferait allouer un texte cible de
/// taille arbitraire. 5 000 mots = ~1 250 WPM pendant les 60 s du plafond le plus long.
const SPAM_MAX_WORDS: usize = 5_000;
/// Profondeur du canal de diffusion par Room (messages en vol tolérés).
const BROADCAST_CAP: usize = 64;
/// Plafond DUR de présents dans une Room, et taille par défaut. Porte sur `players`, donc
/// un spectateur arrivé en cours de course occupe une place comme un autre. L'owner peut
/// descendre en dessous (`Room::max_players`), jamais au-dessus : la piste et le Play of
/// the Game sont dessinés pour huit.
const MAX_PLAYERS: usize = 8;
/// Plancher de la taille réglable : à un seul joueur il n'y a pas de course.
const MIN_PLAYERS: usize = 2;
/// Durées de décompte réglables par l'owner (ADR 0007 : réglage produit, pas une unité
/// de mesure — t=0 reste la fin du décompte quelle que soit la valeur choisie).
const COUNTDOWN_VALUES: [u32; 4] = [3, 5, 7, 10];
/// Durée par défaut d'une Room neuve.
/// 5 s (#185). ADR 0007 avait posé 7 s — et s'était explicitement réservé le droit de
/// bouger cette valeur « sans ADR ni invalidation, tant que t=0 reste la fin du
/// décompte ». Son argument pour une constante figée (« personne ne touchera ce
/// réglage ») a cessé d'être vrai le jour où le décompte est devenu un Réglage de salon :
/// un salon qui veut du temps de lecture remet 7 ou 10 s en un clic.
const DEFAULT_COUNTDOWN_S: u32 = 5;
/// Alphabet des Codes de partie : ni `0`/`O`, ni `1`/`I`/`L` — un code se dicte à
/// l'oral, l'ambiguïté visuelle y coûte cher. 31 caractères.
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/// Longueur d'un Code de partie. 5 → ~28 M de combinaisons, et surtout AUCUN
/// recouvrement possible avec un snowflake Discord (18-19 chiffres) : les deux formes
/// de clé cohabitent dans la même map sans désambiguïsation.
const CODE_LEN: usize = 5;

/// État de course d'une Room (issue #18) — remplace trois champs mutés indépendamment
/// (`start_at_epoch_ms: Option`, `racers: Vec`, `finishers: Vec` : 8 combinaisons
/// représentables, 2 légales). Racers et finishers n'existent QU'ensemble, avec t=0 —
/// un état illégal (t=0 posé sans partants, par ex.) n'est plus représentable.
pub enum RaceState {
    /// Pas de course en cours : en attente de StartRace.
    Lobby,
    /// Course en cours. `racers` figés au départ (voir `all_racers_done`) ; `finishers`
    /// grandit jusqu'à `racers.len()` et retient le scoreboard COMPLET de chacun
    /// jusqu'à la clôture, pour que le podium n'ait rien à re-demander (ADR 0010).
    /// `logs` retient les Keystroke logs des finisseurs jusqu'à `end_race` (ADR 0011) :
    /// le Play of the Game rejoue les deux logs du duel. ~72 Ko à huit joueurs, libéré
    /// avec la variante (retour en `Lobby`). Même durée de vie que `finishers`.
    Racing {
        start_at_epoch_ms: i64,
        racers: Vec<PlayerId>,
        finishers: Vec<RaceResult>,
        logs: HashMap<PlayerId, Vec<Keystroke>>,
        /// Dernier `charsDone` connu de chaque partant (floor is lava, ADR 0015).
        /// `relay_progress` rediffusait et OUBLIAIT ; le tic d'élimination a besoin de
        /// comparer, donc le serveur retient. Déclaratif et arrondi au mot verrouillé
        /// (issue #94) — les deux plafonds sont assumés dans l'ADR.
        progress: HashMap<PlayerId, u32>,
        /// Les brûlés DANS L'ORDRE DES DÉCÈS, avec l'instant (ms depuis t=0). Cet ordre
        /// EST le classement du mode, inversé : le dernier brûlé est 2e. Plusieurs
        /// entrées peuvent partager un instant (égalité au tic : les deux brûlent).
        burned: Vec<(PlayerId, f64)>,
        /// Nombre de tics d'élimination déjà joués. Compté plutôt que déduit de
        /// `burned.len()`, que les égalités désynchroniseraient.
        lava_ticks: u32,
        /// L'instant (ms depuis t=0) du `SpamStop` déjà diffusé (ADR 0016), `None` tant
        /// qu'il ne l'est pas. Sans cette marque, un partant déconnecté laisserait la Room
        /// en course et le plafond de temps re-diffuserait l'arrêt à chaque seconde de
        /// watchdog jusqu'aux 10 minutes du `close_overlong_races`.
        ///
        /// Un booléen suffisait jusqu'à #164 : l'instant est ce contre quoi se borne le log
        /// que chaque partant renvoie ensuite — pendant du `burned_at_ms` de Floor is lava,
        /// qui le retenait déjà.
        spam_stopped_at_ms: Option<f64>,
    },
}

impl RaceState {
    pub fn is_racing(&self) -> bool {
        matches!(self, RaceState::Racing { .. })
    }
}

/// Une Room : une Race en cours, identifiée par une clé (salon vocal ou Code de partie).
pub struct Room {
    pub key: RoomKey,
    /// Le Code de partie, si la Room en a un. `None` = Room de salon vocal. C'est aussi
    /// ce qui dit comment la Room a été créée, sans champ « kind » séparé.
    pub code: Option<String>,
    /// Présence ET ordre d'arrivée (l'owner se transfère à `players[0]`). Reste une liste
    /// d'ID : toute la logique de course raisonne là-dessus.
    pub players: Vec<PlayerId>,
    /// Display identity par présent — une projection d'affichage, à côté de `players`
    /// plutôt que dedans, pour que la logique de course n'ait pas à la connaître. Tenue
    /// à jour aux DEUX seuls endroits où la présence bouge : `add_player` et `leave_room`.
    pub identities: HashMap<PlayerId, Identity>,
    /// Owner = qui peut lancer la course (1er arrivé, transféré s'il part).
    pub owner: PlayerId,
    pub seed: u64,
    pub target_text: String,
    /// Source EFFECTIVE du `target_text` courant — pas celle qui a été demandée. Un repli
    /// après échec du proxy de citations bascule réellement ce champ (ADR 0009).
    pub text_source: TextSource,
    /// Taille max de la Room, réglée par l'owner dans `MIN_PLAYERS..=MAX_PLAYERS`.
    /// Ne porte QUE sur les arrivées : la baisser sous le nombre de présents n'expulse
    /// personne — on ne sort pas quelqu'un du lobby par un réglage, la place se libère
    /// quand il part de lui-même.
    pub max_players: usize,
    /// Durée du décompte avant le départ, réglée par l'owner parmi `COUNTDOWN_VALUES`.
    pub countdown_s: u32,
    /// Ready-check activé par l'owner (issue #63) — par défaut désactivé, comportement
    /// de départ inchangé (voir `all_present_ready`).
    pub ready_check: bool,
    /// Présents s'étant marqués prêts. Vidé à chaque bascule de `ready_check` et à
    /// chaque retour en Lobby (`end_race`) : chaque manche redemande une confirmation.
    pub ready: HashSet<PlayerId>,
    /// Difficulté de la Room (Normal | Master, issue #71, ADR 0013) — Expert n'est pas
    /// un Réglage de salon, sa condition de déclenchement y est inatteignable.
    pub difficulty: Difficulty,
    /// Mode de jeu de la Room (ADR 0015) — comment la Race se gagne. Un axe à part,
    /// orthogonal à la Difficulté (qui, elle, fait échouer sur SA propre faute).
    pub game_mode: GameMode,
    /// Intervalle d'élimination de floor is lava, en secondes. Inerte sous `Normal` —
    /// gardé quand même, pour que rebasculer sur le mode retrouve le réglage choisi.
    pub lava_interval_s: u32,
    /// Mot personnalisé de Spam (ADR 0016), ou `None` pour le mot par défaut — tiré de la
    /// liste de la Source `Mots`, seedé pareil, et RETIRÉ à chaque manche : c'est ce qui
    /// fait qu'une revanche en mot par défaut ne rejoue pas le mot d'avant.
    pub spam_word: Option<String>,
    /// Seuil de répétitions qui gagne la Race sur-le-champ. Inerte hors Spam — gardé
    /// quand même, comme `lava_interval_s`, pour que rebasculer retrouve le réglage.
    pub spam_threshold: u32,
    /// Plafond de temps de Spam, en secondes : si personne n'atteint le seuil, c'est le
    /// plus de répétitions qui gagne à son expiration. Inerte hors Spam.
    pub spam_time_cap_s: u32,
    pub state: RaceState,
    /// Diffusion des ServerEvent vers tous les sockets du salon.
    pub tx: broadcast::Sender<ServerEvent>,
}

/// État global partagé des Rooms. Injecté dans l'AppState Axum.
pub type Rooms = Arc<Mutex<HashMap<RoomKey, Room>>>;

/// Pourquoi une jointure a échoué. `NotFound` n'est possible que par Code de partie :
/// une Room de salon est créée à la volée, elle ne peut pas manquer.
#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    NotFound,
    Full,
}

pub fn new_rooms() -> Rooms {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Boucle d'une connexion WebSocket. `player_id` est résolu côté serveur (jamais
/// via le corps) AVANT l'upgrade, comme pour les endpoints HTTP.
pub async fn handle_socket(
    socket: WebSocket,
    rooms: Rooms,
    player_id: PlayerId,
    pool: SqlitePool,
    quotes: Arc<QuoteClient>,
) {
    // 1. Le premier message utile DOIT être une jointure : elle fixe la clé de Room et
    //    donne l'abonnement à la diffusion. Toute autre trame avant est ignorée.
    let (key, socket, mut rx) = match await_join(socket, &rooms, &player_id).await {
        Some(v) => v,
        None => return, // socket fermé avant toute jointure réussie
    };

    // 2. Diffusion → ce socket, en tâche dédiée (l'émetteur du socket lui appartient).
    let (mut sender, mut receiver) = socket.split();
    let forward = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let json = serde_json::to_string(&ev).expect("ServerEvent sérialisable");
                    if sender.send(Message::Text(json)).await.is_err() {
                        break; // socket fermé
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue, // on saute
                Err(broadcast::error::RecvError::Closed) => break,       // Room détruite
            }
        }
    });

    // 3. Lecture des messages du client jusqu'à fermeture / LeaveRoom.
    while let Some(Ok(msg)) = receiver.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        match serde_json::from_str::<ClientEvent>(&text) {
            // Un Réglage de salon = une variante `RoomSetting` (#204). Le dispatch ne sait
            // plus lesquels demandent d'aller rechercher un texte : `SettingOutcome` le dit.
            Ok(ClientEvent::SetTextSource { source }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::TextSource(source), &quotes)
            }
            Ok(ClientEvent::SetMaxPlayers { max }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::MaxPlayers(max as usize), &quotes)
            }
            Ok(ClientEvent::SetCountdown { seconds }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::Countdown(seconds), &quotes)
            }
            Ok(ClientEvent::SetReadyCheck { enabled }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::ReadyCheck(enabled), &quotes)
            }
            // PAS un Réglage de salon (ADR 0017) : n'importe quel présent se marque prêt.
            Ok(ClientEvent::SetReady { ready }) => {
                set_ready(&rooms, &key, &player_id, ready);
            }
            Ok(ClientEvent::SetDifficulty { difficulty }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::Difficulty(difficulty), &quotes)
            }
            Ok(ClientEvent::SetGameMode { mode }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::GameMode(mode), &quotes)
            }
            Ok(ClientEvent::SetLavaInterval { seconds }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::LavaInterval(seconds), &quotes)
            }
            Ok(ClientEvent::SetSpamWord { word }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::SpamWord(word), &quotes)
            }
            Ok(ClientEvent::SetSpamThreshold { count }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::SpamThreshold(count), &quotes)
            }
            Ok(ClientEvent::SetSpamTimeCap { seconds }) => {
                apply_room_setting(&rooms, &key, &player_id, RoomSetting::SpamTimeCap(seconds), &quotes)
            }
            Ok(ClientEvent::StartRace) => start_race(&rooms, &key, &player_id),
            Ok(ClientEvent::Progress { chars_done, reps }) => {
                relay_progress(&rooms, &key, &player_id, chars_done, reps, now_epoch_ms())
            }
            Ok(ClientEvent::Finish { keystrokes, ended_at_ms }) => {
                if finish_race(&rooms, &key, &player_id, keystrokes, ended_at_ms, &pool) {
                    // Course close : la revanche part sur un texte de la bonne Source.
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::Forfeit) => {
                if forfeit_race(&rooms, &key, &player_id) {
                    // Abandon du dernier partant : la revanche part sur un texte neuf.
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::Fail { keystrokes }) => {
                if fail_race(&rooms, &key, &player_id, keystrokes) {
                    // Échec du dernier partant : la revanche part sur un texte neuf.
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::LeaveRoom) => break,
            // Jointure en double : ignorée.
            Ok(_) => {}
            Err(e) => eprintln!("WS {player_id} : message illisible ({e}) : {text}"),
        }
    }

    // 4. Déconnexion : retire la présence (re-diffuse RoomState) et coupe le forward.
    forward.abort();
    if leave_room(&rooms, &key, &player_id) {
        spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
    }
}

/// Lit les messages jusqu'à une jointure RÉUSSIE, enregistre le joueur et renvoie
/// (clé de Room, socket, receiver de diffusion). `None` si le socket ferme avant.
///
/// Un échec (`RoomNotFound`, `RoomFull`) répond sur le socket et **continue la boucle** :
/// le joueur corrige son code et retente sans se reconnecter. C'est aussi pourquoi ces
/// deux événements ne sont pas diffusés — il n'y a aucune Room à qui les diffuser.
async fn await_join(
    mut socket: WebSocket,
    rooms: &Rooms,
    player_id: &str,
) -> Option<(RoomKey, WebSocket, broadcast::Receiver<ServerEvent>)> {
    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return None,
            _ => continue,
        };
        let attempt = match serde_json::from_str::<ClientEvent>(&text) {
            Ok(ClientEvent::JoinChannel { channel_id, identity }) => {
                join_channel(rooms, &channel_id, player_id, identity).map(|rx| (channel_id, rx))
            }
            Ok(ClientEvent::CreateRoom { identity }) => {
                Ok(create_room(rooms, player_id, identity))
            }
            Ok(ClientEvent::JoinCode { code, identity }) => {
                join_code(rooms, &code, player_id, identity).map(|rx| (code, rx))
            }
            Ok(_) => continue, // toute autre trame avant une jointure : ignorée
            Err(e) => {
                eprintln!("WS {player_id} : trame de jointure illisible ({e}) : {text}");
                continue;
            }
        };
        match attempt {
            Ok((key, rx)) => return Some((key, socket, rx)),
            Err(e) => {
                let ev = match e {
                    JoinError::NotFound => ServerEvent::RoomNotFound,
                    JoinError::Full => ServerEvent::RoomFull,
                };
                let json = serde_json::to_string(&ev).expect("ServerEvent sérialisable");
                if socket.send(Message::Text(json)).await.is_err() {
                    return None;
                }
            }
        }
    }
    None
}


/// Applique un Réglage de salon, puis relance la génération de texte HORS VERROU si le
/// Réglage l'exige (une Quote demande un aller-retour réseau, ADR 0017).
///
/// Quels Réglages l'exigent n'est PAS connu ici : `SettingOutcome::AppliedNeedsRetext` le
/// dit. Avant #204, chaque `Set*` du dispatch passait par une fonction `set_*` à son nom
/// qui n'ajoutait rien à `apply_setting` — dix passe-plats, et la connaissance du retext
/// recopiée dans deux bras du `match`.
fn apply_room_setting(
    rooms: &Rooms,
    key: &RoomKey,
    player_id: &str,
    setting: RoomSetting,
    quotes: &Arc<QuoteClient>,
) {
    if apply_setting(rooms, key, player_id, setting) == SettingOutcome::AppliedNeedsRetext {
        spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
    }
}


/// Projette la présence en entrées dessinables. Un présent sans identité connue retombe
/// sur son snowflake : jamais joli, mais jamais vide non plus.
fn room_state(room: &Room) -> ServerEvent {
    let players = room
        .players
        .iter()
        .map(|id| {
            let ident = room.identities.get(id);
            PlayerEntry {
                player_id: id.clone(),
                display_name: ident
                    .map(|i| i.display_name.clone())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| id.clone()),
                avatar_hash: ident.and_then(|i| i.avatar_hash.clone()),
                ready: room.ready.contains(id),
            }
        })
        .collect();
    ServerEvent::RoomState {
        players,
        owner: room.owner.clone(),
        seed: room.seed,
        target_text: room.target_text.clone(),
        code: room.code.clone(),
        text_source: room.text_source,
        max_players: room.max_players as u32,
        countdown_s: room.countdown_s,
        ready_check: room.ready_check,
        difficulty: room.difficulty,
        game_mode: room.game_mode,
        lava_interval_s: room.lava_interval_s,
        spam_word: room.spam_word.clone(),
        spam_threshold: room.spam_threshold,
        spam_time_cap_s: room.spam_time_cap_s,
    }
}

/// Seed 32 bits dérivée de l'horloge (le serveur possède la vérité terrain).
fn fresh_seed() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u32)
        .unwrap_or(0)
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Identifiant de Run (même forme `r_<nanos>` que POST /api/runs).
fn now_epoch_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}
