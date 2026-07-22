// =============================================================================
//  ws/mod.rs — état partagé des Rooms + boucle socket (Phase 2).
//
//  Câblé au routeur Axum via `/ws` (voir main.rs).
//   - Présence : JoinRoom enregistre le joueur, LeaveRoom / déconnexion le retire.
//     Chaque changement re-DIFFUSE RoomState (présence + owner) à tous les sockets
//     du salon via un broadcast::Sender par Room.
//   - Owner = premier joueur à rejoindre ; passe au suivant s'il part. Seul l'owner
//     peut lancer : StartRace → RaceStart{start_at_epoch_ms} diffusé à tous (t=0).
//     Les PARTANTS sont figés au RaceStart : arrivées/départs en cours de course ne
//     bloquent ni ne clôturent la fin (voir all_racers_done).
//   - Le serveur possède la vérité terrain : seed + texte cible générés à la création
//     de la Room (domain::text_gen), regénérés après chaque course (revanche).
//   - Progress relayé (barres live) ; Finish → recompute autoritaire → RaceOver.
// =============================================================================

#![allow(dead_code)]

pub mod protocol;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sqlx::sqlite::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::replay::{compute_scoreboard, ScoreInput};
use crate::domain::text_gen::{generate_text, GenSettings};
use crate::domain::types::{Keystroke, Mode, RunConfig};
use protocol::{ChannelId, ClientEvent, PlayerId, ServerEvent};

/// Nombre de mots pré-générés pour le texte cible d'une Room (défaut Words).
const ROOM_WORD_COUNT: usize = 30;
/// Profondeur du canal de diffusion par Room (messages en vol tolérés).
const BROADCAST_CAP: usize = 64;

/// État de course d'une Room (issue #18) — remplace trois champs mutés indépendamment
/// (`start_at_epoch_ms: Option`, `racers: Vec`, `finishers: Vec` : 8 combinaisons
/// représentables, 2 légales). Racers et finishers n'existent QU'ensemble, avec t=0 —
/// un état illégal (t=0 posé sans partants, par ex.) n'est plus représentable.
pub enum RaceState {
    /// Pas de course en cours : en attente de StartRace.
    Lobby,
    /// Course en cours. `racers` figés au départ (voir `all_racers_done`) ; `finishers`
    /// grandit jusqu'à `racers.len()`.
    Racing { start_at_epoch_ms: i64, racers: Vec<PlayerId>, finishers: Vec<(PlayerId, f64)> },
}

impl RaceState {
    pub fn is_racing(&self) -> bool {
        matches!(self, RaceState::Racing { .. })
    }
}

/// Une Room : une Race en cours, scopée à un salon vocal Discord.
pub struct Room {
    pub channel_id: ChannelId,
    pub players: Vec<PlayerId>,
    /// Owner = qui peut lancer la course (1er arrivé, transféré s'il part).
    pub owner: PlayerId,
    pub seed: u64,
    pub target_text: String,
    pub state: RaceState,
    /// Diffusion des ServerEvent vers tous les sockets du salon.
    pub tx: broadcast::Sender<ServerEvent>,
}

/// État global partagé des Rooms. Injecté dans l'AppState Axum.
pub type Rooms = Arc<Mutex<HashMap<ChannelId, Room>>>;

pub fn new_rooms() -> Rooms {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Boucle d'une connexion WebSocket. `player_id` est résolu côté serveur (jamais
/// via le corps) AVANT l'upgrade, comme pour les endpoints HTTP.
pub async fn handle_socket(socket: WebSocket, rooms: Rooms, player_id: PlayerId, pool: SqlitePool) {
    // 1. Le premier message utile DOIT être JoinRoom : il fixe le salon et donne
    //    l'abonnement à la diffusion. Toute autre trame avant est ignorée.
    let (channel_id, socket, mut rx) = match await_join(socket, &rooms, &player_id).await {
        Some(v) => v,
        None => return, // socket fermé avant tout JoinRoom
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
            Ok(ClientEvent::StartRace) => start_race(&rooms, &channel_id, &player_id),
            Ok(ClientEvent::Progress { chars_done }) => {
                relay_progress(&rooms, &channel_id, &player_id, chars_done)
            }
            Ok(ClientEvent::Finish { keystrokes, ended_at_ms }) => {
                finish_race(&rooms, &channel_id, &player_id, keystrokes, ended_at_ms, &pool)
            }
            Ok(ClientEvent::LeaveRoom) => break,
            // JoinRoom en double : ignoré.
            Ok(_) | Err(_) => {}
        }
    }

    // 4. Déconnexion : retire la présence (re-diffuse RoomState) et coupe le forward.
    forward.abort();
    leave_room(&rooms, &channel_id, &player_id);
}

/// Lit les messages jusqu'au premier JoinRoom, enregistre le joueur et renvoie
/// (socket, (channel_id, receiver de diffusion)). `None` si le socket ferme avant.
async fn await_join(
    mut socket: WebSocket,
    rooms: &Rooms,
    player_id: &str,
) -> Option<(ChannelId, WebSocket, broadcast::Receiver<ServerEvent>)> {
    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return None,
            _ => continue,
        };
        if let Ok(ClientEvent::JoinRoom { channel_id }) = serde_json::from_str::<ClientEvent>(&text)
        {
            let rx = join_room(rooms, &channel_id, player_id);
            return Some((channel_id, socket, rx));
        }
    }
    None
}

/// Ajoute le joueur (crée la Room avec seed+texte serveur si absente), s'abonne à
/// la diffusion, puis re-diffuse RoomState à tous. Le lock std n'est jamais tenu à
/// travers un await (broadcast::send/subscribe sont synchrones).
fn join_room(rooms: &Rooms, channel_id: &str, player_id: &str) -> broadcast::Receiver<ServerEvent> {
    let mut rooms = rooms.lock().unwrap();
    let room = rooms.entry(channel_id.to_string()).or_insert_with(|| {
        let seed = fresh_seed();
        let target_text =
            generate_text(&GenSettings { punctuation: false, numbers: false }, ROOM_WORD_COUNT, seed)
                .join(" ");
        let (tx, _) = broadcast::channel(BROADCAST_CAP);
        Room {
            channel_id: channel_id.to_string(),
            players: Vec::new(),
            owner: player_id.to_string(), // 1er arrivé = owner
            seed: seed as u64,
            target_text,
            state: RaceState::Lobby,
            tx,
        }
    });
    // S'abonner AVANT de diffuser → ce socket reçoit aussi le RoomState.
    let rx = room.tx.subscribe();
    if !room.players.iter().any(|p| p == player_id) {
        room.players.push(player_id.to_string());
    }
    let _ = room.tx.send(room_state(room));
    rx
}

fn leave_room(rooms: &Rooms, channel_id: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(channel_id) {
        room.players.retain(|p| p != player_id);
        if room.players.is_empty() {
            rooms.remove(channel_id); // tx droppé → forwards des sockets se terminent
            return;
        }
        if room.owner == player_id {
            room.owner = room.players[0].clone(); // transfert au suivant dans la pile
        }
        let _ = room.tx.send(room_state(room));
        // Si le partant était le dernier attendu, la course se termine maintenant.
        let should_end = match &room.state {
            RaceState::Racing { racers, finishers, .. } => all_racers_done(racers, &room.players, finishers),
            RaceState::Lobby => false,
        };
        if should_end {
            end_race(room);
        }
    }
}

/// StartRace : accepté du seul owner, hors course en cours. Fige les partants,
/// fixe t=0 (horloge murale serveur) et le diffuse.
fn start_race(rooms: &Rooms, channel_id: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(channel_id) {
        if room.owner != player_id || room.state.is_racing() {
            return; // non-owner ou course déjà lancée : ignoré
        }
        let start = now_epoch_ms();
        room.state = RaceState::Racing {
            start_at_epoch_ms: start,
            racers: room.players.clone(),
            finishers: Vec::new(),
        };
        let _ = room.tx.send(ServerEvent::RaceStart { start_at_epoch_ms: start });
    }
}

/// Relaie la progression d'un joueur aux autres (rendu des barres). Non autoritaire.
fn relay_progress(rooms: &Rooms, channel_id: &str, player_id: &str, chars_done: u32) {
    let rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get(channel_id) {
        let _ = room.tx.send(ServerEvent::PlayerProgress {
            player_id: player_id.to_string(),
            chars_done,
        });
    }
}

/// Résultat d'une tentative d'enregistrer une arrivée.
#[derive(Debug, PartialEq, Eq)]
enum FinishOutcome {
    /// Pas un partant de cette course, ou déjà fini : ignoré (doublon ou état périmé).
    Rejected,
    Recorded,
    /// Enregistré, et c'était le dernier partant attendu : la course est close.
    RaceOver,
}

/// Enregistre l'arrivée d'un partant (rejette les non-partants et les doublons),
/// diffuse PlayerFinished, et clôt la course si c'était la dernière arrivée attendue.
/// Machine d'état PURE : aucun socket, aucune DB — un seul paramètre (`pool`, dans
/// `finish_race`) séparait ça d'une couverture complète (issue #18).
fn record_finish(rooms: &Rooms, channel_id: &str, player_id: &str, wpm: f64) -> FinishOutcome {
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(channel_id) else { return FinishOutcome::Rejected };

    let eligible = match &room.state {
        RaceState::Racing { racers, finishers, .. } => {
            racers.iter().any(|p| p == player_id) && !finishers.iter().any(|(p, _)| p == player_id)
        }
        RaceState::Lobby => false,
    };
    if !eligible {
        return FinishOutcome::Rejected;
    }

    let RaceState::Racing { finishers, .. } = &mut room.state else { unreachable!("vérifié ci-dessus") };
    finishers.push((player_id.to_string(), wpm));
    let _ = room.tx.send(ServerEvent::PlayerFinished { player_id: player_id.to_string(), wpm });

    let done = match &room.state {
        RaceState::Racing { racers, finishers, .. } => all_racers_done(racers, &room.players, finishers),
        RaceState::Lobby => false,
    };
    if done {
        end_race(room);
        FinishOutcome::RaceOver
    } else {
        FinishOutcome::Recorded
    }
}

/// Finish : recompute AUTORITAIRE contre le texte du serveur, puis enregistre l'arrivée
/// (`record_finish`). Le Run est aussi persisté dans `runs` (kind "race") — historique
/// seulement, jamais PB : la fin stricte (texte 100 % exact) le rend incomparable aux
/// buckets Practice.
fn finish_race(
    rooms: &Rooms,
    channel_id: &str,
    player_id: &str,
    keystrokes: Vec<Keystroke>,
    _ended_at_ms: f64, // wire uniquement : la durée vient du log, jamais du client (issue #11)
    pool: &SqlitePool,
) {
    // Vérif préliminaire, bref verrou : évite le recompute (coûteux) pour un partant déjà
    // rejeté d'office. `record_finish` refait l'authoritative check plus bas, verrou séparé.
    let target_text = {
        let rooms = rooms.lock().unwrap();
        let Some(room) = rooms.get(channel_id) else { return };
        let eligible = match &room.state {
            RaceState::Racing { racers, finishers, .. } => {
                racers.iter().any(|p| p == player_id) && !finishers.iter().any(|(p, _)| p == player_id)
            }
            RaceState::Lobby => false,
        };
        if !eligible {
            return;
        }
        room.target_text.clone()
    };

    // Sérialisé avant le recompute (qui prend possession des keystrokes).
    let keystroke_log = serde_json::to_string(&keystrokes).unwrap_or_else(|_| "[]".to_string());

    // Race = Words sur le texte du salon (le serveur possède seed/texte/config).
    // Hors verrou : le recompute (O(n) sur le log) ne doit pas bloquer les autres Rooms.
    let mode_value = target_text.split(' ').count() as i64;
    let mut sb = compute_scoreboard(&ScoreInput {
        mode: Mode::Words,
        mode_value,
        target_text: target_text.clone(),
        keystrokes,
    });

    // Verrou séparé, bref : enregistrement authoritative (l'état a pu changer entretemps).
    if record_finish(rooms, channel_id, player_id, sb.wpm) == FinishOutcome::Rejected {
        return;
    }

    // Persistance hors verrou (spawn) : l'échec ne casse pas la course, il se logue.
    sb.pb_eligible = false;
    let config = RunConfig {
        mode: Mode::Words,
        mode_value,
        language: "english".to_string(),
        punctuation: false,
        numbers: false,
    };
    let pool = pool.clone();
    let pid = player_id.to_string();
    tokio::spawn(async move {
        let run_id = format!("r_{}", now_epoch_nanos());
        if let Err(e) = crate::store::insert_run(
            &pool, &run_id, &pid, now_epoch_ms(), "race", &config, &sb, &keystroke_log, &target_text,
        )
        .await
        {
            eprintln!("persistance du Run de Race ({pid}) : {e}");
        }
    });
}

/// Course finie quand chaque partant ENCORE PRÉSENT a fini. Les partants sont figés
/// au RaceStart : un joueur qui rejoint en cours ne bloque pas la fin, un partant
/// qui quitte n'est plus attendu. Vide = pas de course en cours.
fn all_racers_done(
    racers: &[PlayerId],
    players: &[PlayerId],
    finishers: &[(PlayerId, f64)],
) -> bool {
    !racers.is_empty()
        && racers
            .iter()
            .filter(|r| players.contains(r))
            .all(|r| finishers.iter().any(|(p, _)| p == r))
}

/// Clôt la course : diffuse le classement (par WPM décroissant), puis prépare la
/// revanche — nouveau seed + nouveau texte (l'ancien est mémorisé par les joueurs)
/// re-diffusés via RoomState. L'owner peut relancer StartRace depuis l'écran RaceOver.
fn end_race(room: &mut Room) {
    let RaceState::Racing { finishers, .. } = &room.state else { return }; // rien à clore
    let mut ranked = finishers.clone();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let ranking = ranked.into_iter().map(|(p, _)| p).collect();
    let _ = room.tx.send(ServerEvent::RaceOver { ranking });

    room.state = RaceState::Lobby;
    room.seed = fresh_seed() as u64;
    room.target_text =
        generate_text(&GenSettings { punctuation: false, numbers: false }, ROOM_WORD_COUNT, room.seed as u32)
            .join(" ");
    let _ = room.tx.send(room_state(room));
}

fn room_state(room: &Room) -> ServerEvent {
    ServerEvent::RoomState {
        players: room.players.clone(),
        owner: room.owner.clone(),
        seed: room.seed,
        target_text: room.target_text.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    fn racers_of(rooms: &Rooms, channel_id: &str) -> Vec<PlayerId> {
        match &rooms.lock().unwrap().get(channel_id).unwrap().state {
            RaceState::Racing { racers, .. } => racers.clone(),
            RaceState::Lobby => panic!("pas en course"),
        }
    }

    #[test]
    fn partants_figes_au_depart() {
        let racers = s(&["a", "b"]);
        let fin_a = vec![("a".to_string(), 80.0)];
        let fin_ab = vec![("a".to_string(), 80.0), ("b".to_string(), 60.0)];

        // Pas de course en cours (partants vides) : jamais "fini".
        assert!(!all_racers_done(&[], &racers, &fin_ab));
        // Il manque b : pas fini.
        assert!(!all_racers_done(&racers, &racers, &fin_a));
        // Tous les partants ont fini.
        assert!(all_racers_done(&racers, &racers, &fin_ab));
        // Un joueur qui REJOINT en cours de course ne bloque pas la fin.
        assert!(all_racers_done(&racers, &s(&["a", "b", "spectateur"]), &fin_ab));
        // Un partant qui QUITTE n'est plus attendu : a fini + b parti → fini.
        assert!(all_racers_done(&racers, &s(&["a"]), &fin_a));
    }

    #[test]
    fn actions_sans_joinroom_prealable_sont_des_no_op() {
        // issue #18 : StartRace/Progress/Finish sur un salon jamais rejoint (aucune Room
        // créée) sont ignorés — pas de panique, pas de Room créée par effet de bord.
        let rooms = new_rooms();
        start_race(&rooms, "c1", "p1");
        relay_progress(&rooms, "c1", "p1", 5);
        assert_eq!(record_finish(&rooms, "c1", "p1", 80.0), FinishOutcome::Rejected);
        assert!(rooms.lock().unwrap().is_empty());
    }

    #[test]
    fn owner_premier_arrive_et_transfert_au_depart() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1");
        join_room(&rooms, "c1", "p2");
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().owner, "p1");

        leave_room(&rooms, "c1", "p1");
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().owner, "p2");
    }

    #[test]
    fn start_race_reserve_a_lowner_et_refuse_pendant_une_course() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1"); // owner
        join_room(&rooms, "c1", "p2");

        start_race(&rooms, "c1", "p2"); // pas l'owner : ignoré
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        start_race(&rooms, "c1", "p1"); // owner : accepté
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        let start_at = |rooms: &Rooms| match &rooms.lock().unwrap().get("c1").unwrap().state {
            RaceState::Racing { start_at_epoch_ms, .. } => *start_at_epoch_ms,
            RaceState::Lobby => panic!("pas en course"),
        };
        let avant = start_at(&rooms);
        start_race(&rooms, "c1", "p1"); // déjà en course : ignoré, t=0 inchangé
        assert_eq!(start_at(&rooms), avant);
    }

    #[test]
    fn gel_des_partants() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1");
        join_room(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");

        join_room(&rooms, "c1", "p3"); // rejoint APRÈS le départ
        assert_eq!(racers_of(&rooms, "c1"), s(&["p1", "p2"])); // p3 absent : pas un partant
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().players, s(&["p1", "p2", "p3"])); // mais présent
    }

    #[test]
    fn rejet_des_arrivees_en_double_et_des_non_partants() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1");
        join_room(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        join_room(&rooms, "c1", "spectateur"); // rejoint après le départ : pas un partant

        assert_eq!(record_finish(&rooms, "c1", "spectateur", 999.0), FinishOutcome::Rejected);
        assert_eq!(record_finish(&rooms, "c1", "p1", 80.0), FinishOutcome::Recorded);
        assert_eq!(record_finish(&rooms, "c1", "p1", 999.0), FinishOutcome::Rejected); // doublon
    }

    #[test]
    fn classement_par_wpm_decroissant() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1");
        join_room(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        assert_eq!(record_finish(&rooms, "c1", "p1", 60.0), FinishOutcome::Recorded);
        assert_eq!(record_finish(&rooms, "c1", "p2", 90.0), FinishOutcome::RaceOver);

        let mut ranking = None;
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::RaceOver { ranking: r } = ev {
                ranking = Some(r);
            }
        }
        assert_eq!(ranking, Some(s(&["p2", "p1"]))); // p2 (90) devant p1 (60)
    }

    #[test]
    fn revanche_sur_texte_neuf() {
        let rooms = new_rooms();
        join_room(&rooms, "c1", "p1");
        let texte_avant = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();

        start_race(&rooms, "c1", "p1");
        assert_eq!(record_finish(&rooms, "c1", "p1", 60.0), FinishOutcome::RaceOver);

        {
            let guard = rooms.lock().unwrap();
            let room = guard.get("c1").unwrap();
            assert!(!room.state.is_racing()); // retour au Lobby
            assert_ne!(room.target_text, texte_avant); // nouveau texte pour la revanche
        }

        // L'owner peut relancer une course sur ce texte neuf.
        start_race(&rooms, "c1", "p1");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }
}
