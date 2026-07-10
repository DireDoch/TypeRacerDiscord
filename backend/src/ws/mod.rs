// =============================================================================
//  ws/mod.rs — état partagé des Rooms + boucle socket (Phase 2, étape 3).
//
//  Câblé au routeur Axum via `/ws` (voir main.rs). Étape 3 = présence nue :
//  JoinRoom enregistre le joueur et renvoie RoomState (seed + texte cible générés
//  côté serveur — le serveur est désormais propriétaire de la vérité terrain).
//  Ready/Progress/Finish/RaceStart… viennent aux étapes suivantes.
// =============================================================================

#![allow(dead_code)]

pub mod protocol;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket};

use crate::domain::text_gen::{generate_text, GenSettings};
use protocol::{ChannelId, ClientEvent, PlayerId, ServerEvent};

/// Nombre de mots pré-générés pour le texte cible d'une Room (défaut Words).
const ROOM_WORD_COUNT: usize = 30;

/// Une Room : une Race en cours, scopée à un salon vocal Discord.
pub struct Room {
    pub channel_id: ChannelId,
    pub players: Vec<PlayerId>,
    pub seed: u64,
    pub target_text: String,
    /// t=0 partagé une fois la Race lancée.
    pub start_at_epoch_ms: Option<i64>,
}

/// État global partagé des Rooms. Injecté dans l'AppState Axum en Phase 2.
pub type Rooms = Arc<Mutex<HashMap<ChannelId, Room>>>;

pub fn new_rooms() -> Rooms {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Boucle d'une connexion WebSocket. `player_id` est résolu côté serveur (jamais
/// via le corps) AVANT l'upgrade, comme pour les endpoints HTTP.
pub async fn handle_socket(mut socket: WebSocket, rooms: Rooms, player_id: PlayerId) {
    // Salon rejoint par CE socket (pour nettoyer la présence à la déconnexion).
    let mut joined: Option<ChannelId> = None;

    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue, // ping/pong/binaire ignorés
        };
        let event = match serde_json::from_str::<ClientEvent>(&text) {
            Ok(e) => e,
            Err(_) => continue, // trame invalide : ignorée (pas de crash)
        };

        match event {
            ClientEvent::JoinRoom { channel_id } => {
                joined = Some(channel_id.clone());
                let state = join_room(&rooms, &channel_id, &player_id);
                if send(&mut socket, &state).await.is_err() {
                    break;
                }
            }
            ClientEvent::LeaveRoom => break,
            // Ready / Progress / Finish : câblés aux étapes 4-5.
            _ => {}
        }
    }

    // Déconnexion (close, LeaveRoom, ou erreur) : retire la présence.
    if let Some(channel_id) = joined {
        leave_room(&rooms, &channel_id, &player_id);
    }
}

/// Ajoute le joueur à la Room (la crée avec seed+texte serveur si absente) et
/// retourne le RoomState courant. Le lock std n'est jamais tenu à travers un await.
fn join_room(rooms: &Rooms, channel_id: &str, player_id: &str) -> ServerEvent {
    let mut rooms = rooms.lock().unwrap();
    let room = rooms.entry(channel_id.to_string()).or_insert_with(|| {
        let seed = fresh_seed();
        let target_text =
            generate_text(&GenSettings { punctuation: false, numbers: false }, ROOM_WORD_COUNT, seed)
                .join(" ");
        Room {
            channel_id: channel_id.to_string(),
            players: Vec::new(),
            seed: seed as u64,
            target_text,
            start_at_epoch_ms: None,
        }
    });
    if !room.players.iter().any(|p| p == player_id) {
        room.players.push(player_id.to_string());
    }
    ServerEvent::RoomState {
        players: room.players.clone(),
        seed: room.seed,
        target_text: room.target_text.clone(),
    }
}

fn leave_room(rooms: &Rooms, channel_id: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(channel_id) {
        room.players.retain(|p| p != player_id);
        if room.players.is_empty() {
            rooms.remove(channel_id);
        }
    }
}

async fn send(socket: &mut WebSocket, event: &ServerEvent) -> Result<(), axum::Error> {
    let json = serde_json::to_string(event).expect("ServerEvent est sérialisable");
    socket.send(Message::Text(json)).await
}

/// Seed 32 bits dérivée de l'horloge (le serveur possède la vérité terrain).
fn fresh_seed() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u32)
        .unwrap_or(0)
}
