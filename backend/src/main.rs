// =============================================================================
//  main.rs — serveur HTTP du backend TypeRacerDiscord (Axum).
//
//  TRANCHE 1 (cette étape) : recompute autoritaire câblé sur POST /api/runs.
//  À VENIR (tranches suivantes, voir Docs/API.md) :
//   - persistance SQLite (sqlx) + dérivation du PB → renseigne isPersonalBest
//   - GET /api/history (historique par bucket)
//   - GET /api/quote (proxy API-Ninjas) et GET /token (échange OAuth Discord)
//   - service des fichiers statiques du build Vite (origine unique)
// =============================================================================

mod domain;
mod ws; // frontière Phase 2 (esquisse, non câblée — voir Docs/PHASE2.md)

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    routing::{get, post},
    Json, Router,
};

use domain::replay::{compute_scoreboard, ScoreInput};
use domain::types::{SubmitRunRequest, SubmitRunResponse};

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/runs", post(submit_run));

    let addr = "127.0.0.1:8080";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind 127.0.0.1:8080");
    println!("TypeRacerDiscord backend → http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}

/// Sonde de vivacité.
async fn health() -> &'static str {
    "ok"
}

/// POST /api/runs — recompute autoritaire du scoreboard à partir du log brut.
///
/// MVP : identité et PB non encore branchés (pas de DB ni de header Authorization).
/// Le scoreboard, lui, est déjà la vérité (même algo que le client, port Rust).
async fn submit_run(Json(req): Json<SubmitRunRequest>) -> Json<SubmitRunResponse> {
    let scoreboard = compute_scoreboard(&ScoreInput {
        mode: req.config.mode,
        mode_value: req.config.mode_value,
        target_text: req.target_text,
        keystrokes: req.keystrokes,
        ended_at_ms: req.ended_at_ms,
    });

    Json(SubmitRunResponse {
        run_id: format!("local_{}", now_ms()),
        scoreboard,
        is_personal_best: false, // inconnu sans persistance (le PB se dérive en base)
        previous_pb_wpm: None,
    })
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
