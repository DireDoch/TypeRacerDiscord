// =============================================================================
//  Frontière Phase 2 — état partagé des Rooms.  ESQUISSE, NON CÂBLÉE.
//
//  Le routeur Axum du MVP n'instancie PAS ce module. Il fige la forme de l'état
//  multijoueur pour que la bascule Phase 2 soit localisée ici + ws/protocol.rs.
// =============================================================================

#![allow(dead_code)]

pub mod protocol;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use protocol::{ChannelId, PlayerId};

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
