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
use tokio::sync::broadcast;

use crate::domain::replay::{compute_scoreboard, ScoreInput};
use crate::domain::text_gen::{generate_text, GenSettings};
use crate::domain::types::{Keystroke, Mode};
use protocol::{ChannelId, ClientEvent, PlayerId, ServerEvent};

/// Nombre de mots pré-générés pour le texte cible d'une Room (défaut Words).
const ROOM_WORD_COUNT: usize = 30;
/// Profondeur du canal de diffusion par Room (messages en vol tolérés).
const BROADCAST_CAP: usize = 64;

/// Une Room : une Race en cours, scopée à un salon vocal Discord.
pub struct Room {
    pub channel_id: ChannelId,
    pub players: Vec<PlayerId>,
    /// Owner = qui peut lancer la course (1er arrivé, transféré s'il part).
    pub owner: PlayerId,
    pub seed: u64,
    pub target_text: String,
    /// t=0 partagé une fois la Race lancée.
    pub start_at_epoch_ms: Option<i64>,
    /// Partants figés au RaceStart (vide = pas de course en cours). Un joueur qui
    /// rejoint en cours de course n'est pas attendu ; un partant qui quitte non plus.
    pub racers: Vec<PlayerId>,
    /// Joueurs ayant fini (ordre d'arrivée) + leur WPM autoritaire.
    pub finishers: Vec<(PlayerId, f64)>,
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
pub async fn handle_socket(socket: WebSocket, rooms: Rooms, player_id: PlayerId) {
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
                finish_race(&rooms, &channel_id, &player_id, keystrokes, ended_at_ms)
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
            start_at_epoch_ms: None,
            racers: Vec::new(),
            finishers: Vec::new(),
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
        if room.start_at_epoch_ms.is_some()
            && all_racers_done(&room.racers, &room.players, &room.finishers)
        {
            end_race(room);
        }
    }
}

/// StartRace : accepté du seul owner, hors course en cours. Fige les partants,
/// fixe t=0 (horloge murale serveur) et le diffuse.
fn start_race(rooms: &Rooms, channel_id: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(channel_id) {
        if room.owner != player_id || room.start_at_epoch_ms.is_some() {
            return; // non-owner ou course déjà lancée : ignoré
        }
        room.racers = room.players.clone();
        let start = now_epoch_ms();
        room.start_at_epoch_ms = Some(start);
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

/// Finish : recompute AUTORITAIRE contre le texte du serveur, diffuse PlayerFinished,
/// puis RaceOver (classé par WPM) quand tous les présents ont fini.
fn finish_race(rooms: &Rooms, channel_id: &str, player_id: &str, keystrokes: Vec<Keystroke>, ended_at_ms: f64) {
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(channel_id) else { return };
    if !room.racers.iter().any(|p| p == player_id) {
        return; // pas un partant de CETTE course (ou pas de course) : ignoré
    }
    if room.finishers.iter().any(|(p, _)| p == player_id) {
        return; // déjà fini : on ignore un doublon
    }

    // Race = Words sur le texte du salon (le serveur possède seed/texte/config).
    let mode_value = room.target_text.split(' ').count() as i64;
    let sb = compute_scoreboard(&ScoreInput {
        mode: Mode::Words,
        mode_value,
        target_text: room.target_text.clone(),
        keystrokes,
        ended_at_ms,
    });

    room.finishers.push((player_id.to_string(), sb.wpm));
    let _ = room.tx.send(ServerEvent::PlayerFinished {
        player_id: player_id.to_string(),
        wpm: sb.wpm,
    });

    if all_racers_done(&room.racers, &room.players, &room.finishers) {
        end_race(room);
    }
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

/// Clôt la course : diffuse le classement (par WPM), puis prépare la revanche —
/// nouveau seed + nouveau texte (l'ancien est mémorisé par les joueurs) re-diffusés
/// via RoomState. L'owner peut relancer StartRace depuis l'écran RaceOver.
fn end_race(room: &mut Room) {
    let mut ranked = room.finishers.clone();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let ranking = ranked.into_iter().map(|(p, _)| p).collect();
    let _ = room.tx.send(ServerEvent::RaceOver { ranking });

    room.finishers.clear();
    room.racers.clear();
    room.start_at_epoch_ms = None;
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

#[cfg(test)]
mod tests {
    use super::all_racers_done;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
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
}
