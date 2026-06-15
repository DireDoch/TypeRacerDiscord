// =============================================================================
//  main.rs — serveur HTTP du backend TypeRacerDiscord (Axum).
//
//  TRANCHE 2 : persistance SQLite + PB réel + historique + identité/OAuth Discord.
//   - POST /token        : échange du code OAuth (Embedded App SDK) → access_token
//   - POST /api/runs      : recompute autoritaire + persistance + verdict PB
//   - GET  /api/history   : historique du joueur (filtrable par bucket)
//   - GET  /api/health    : sonde
//
//  Identité : résolue côté serveur depuis `Authorization: Bearer <token>` (jamais le
//  corps). Voir discord.rs (mode dev si secrets absents). Reste à venir : GET /api/quote
//  (proxy API-Ninjas) et service des fichiers statiques du build Vite (origine unique).
// =============================================================================

mod discord;
mod domain;
mod store;
mod ws; // frontière Phase 2 (esquisse, non câblée — voir Docs/PHASE2.md)

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    async_trait,
    extract::{FromRequestParts, Query, State},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::sqlite::SqlitePool;

use discord::{AuthError, DiscordConfig, Identity};
use domain::replay::{compute_scoreboard, ScoreInput};
use domain::types::{
    HistoryResponse, SubmitRunRequest, SubmitRunResponse, TokenRequest, TokenResponse,
};

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    identity: Arc<Identity>,
}

#[tokio::main]
async fn main() {
    let pool = store::init_pool().await;
    let identity = Arc::new(Identity::new(DiscordConfig::from_env()));
    let state = AppState { pool, identity };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/token", post(token))
        .route("/api/runs", post(submit_run))
        .route("/api/history", get(history))
        .with_state(state);

    let addr = "127.0.0.1:8080";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind 127.0.0.1:8080");
    println!("TypeRacerDiscord backend → http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}

async fn health() -> &'static str {
    "ok"
}

/// POST /token — échange le code OAuth contre un access_token (secret client serveur).
/// Nommé « GET /token » par convention Discord ; implémenté en POST car il porte un corps JSON.
async fn token(
    State(state): State<AppState>,
    Json(req): Json<TokenRequest>,
) -> Result<Json<TokenResponse>, StatusCode> {
    let access_token = state
        .identity
        .exchange_code(&req.code)
        .await
        .map_err(auth_status)?;
    Ok(Json(TokenResponse { access_token }))
}

/// POST /api/runs — recompute autoritaire, persistance, et verdict PB réel.
async fn submit_run(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
    Json(req): Json<SubmitRunRequest>,
) -> Result<Json<SubmitRunResponse>, StatusCode> {
    let scoreboard = compute_scoreboard(&ScoreInput {
        mode: req.config.mode,
        mode_value: req.config.mode_value,
        target_text: req.target_text,
        keystrokes: req.keystrokes,
        ended_at_ms: req.ended_at_ms,
    });

    // PB précédent du bucket (avant insertion) → verdict.
    let previous = store::previous_pb(&state.pool, &player_id, &req.config)
        .await
        .map_err(internal)?;
    let is_personal_best =
        scoreboard.pb_eligible && previous.map_or(true, |p| scoreboard.wpm > p);

    let run_id = format!("r_{}", now_nanos());
    store::insert_run(
        &state.pool,
        &run_id,
        &player_id,
        now_ms() as i64,
        &req.config,
        &scoreboard,
    )
    .await
    .map_err(internal)?;

    Ok(Json(SubmitRunResponse {
        run_id,
        scoreboard,
        is_personal_best,
        previous_pb_wpm: previous,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    limit: Option<i64>,
    mode: Option<String>,
    mode_value: Option<i64>,
}

/// GET /api/history — Runs du joueur (plus récent d'abord), filtrable par bucket.
async fn history(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<HistoryResponse>, StatusCode> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let entries = store::history(&state.pool, &player_id, q.mode.as_deref(), q.mode_value, limit)
        .await
        .map_err(internal)?;
    Ok(Json(HistoryResponse { entries }))
}

// ----------------------------------------------------------------------------
//  Identité & helpers d'erreur
// ----------------------------------------------------------------------------

/// Identité du joueur, résolue depuis `Authorization: Bearer <token>` (jamais via le corps).
/// Extracteur `FromRequestParts` : s'exécute AVANT le parsing du corps JSON → un token
/// absent renvoie 401 même si le corps est invalide.
struct AuthPlayer(String);

#[async_trait]
impl FromRequestParts<AppState> for AuthPlayer {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, StatusCode> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| !t.is_empty())
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let player_id = state
            .identity
            .resolve_player_id(token)
            .await
            .map_err(auth_status)?;
        Ok(AuthPlayer(player_id))
    }
}

fn auth_status(e: AuthError) -> StatusCode {
    match e {
        AuthError::Unauthorized => StatusCode::UNAUTHORIZED,
        AuthError::Upstream => StatusCode::BAD_GATEWAY,
        AuthError::NotConfigured => StatusCode::SERVICE_UNAVAILABLE,
    }
}

fn internal<E>(_e: E) -> StatusCode {
    StatusCode::INTERNAL_SERVER_ERROR
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}
