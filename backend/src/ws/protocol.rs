// =============================================================================
//  Frontière Phase 2 — protocole WebSocket (Race / Room).  ESQUISSE, NON CÂBLÉE.
//
//  Aucune de ces structures n'est utilisée par le MVP. Elles existent pour figer
//  la frontière au bon endroit (voir Docs/PHASE2.md). Le serveur deviendra alors
//  propriétaire de la vérité terrain (seed/texte + t=0), supprimant la confiance
//  faite au client en solo.
// =============================================================================

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Identifiant de salon vocal Discord (snowflake) — clé d'une Room.
pub type ChannelId = String;
/// Discord user ID (snowflake), toujours en string.
pub type PlayerId = String;

/// Messages Client → Serveur.
/// Wire : JSON internally-tagged, ex. `{ "type": "JoinRoom", "channelId": "123" }`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    /// Rejoindre/instancier la Room du salon courant.
    JoinRoom { channel_id: ChannelId },
    /// Signaler qu'on est prêt à démarrer.
    Ready,
    /// Progression de frappe (diffusée pour le rendu des "voitures"). Pas autoritaire.
    Progress { chars_done: u32 },
    /// Soumission finale : même payload que POST /api/runs (log brut), recompute serveur.
    Finish { keystrokes_json: String },
    LeaveRoom,
}

/// Messages Serveur → Client.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ServerEvent {
    /// État de la Room après un join (joueurs présents, config, seed).
    RoomState {
        players: Vec<PlayerId>,
        seed: u64,
        target_text: String,
    },
    /// Top de départ partagé : t=0 pour TOUS les clients (cale les horloges locales).
    RaceStart { start_at_epoch_ms: i64 },
    /// Position d'un adversaire (rendu temps réel).
    PlayerProgress { player_id: PlayerId, chars_done: u32 },
    /// Scoreboard autoritaire d'un joueur ayant fini (recompute serveur).
    PlayerFinished { player_id: PlayerId, wpm: f64 },
    /// Classement final.
    RaceOver { ranking: Vec<PlayerId> },
}
