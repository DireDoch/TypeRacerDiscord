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
//  corps). Voir discord.rs (mode dev si secrets absents).
//
//  ORIGINE UNIQUE : en plus de /api et /token, ce serveur sert le build statique de Vite
//  (fallback ServeDir → index.html pour le routage SPA). En dev on passe plutôt par le
//  proxy Vite (port 5173 → 8080) ; en prod le frontend et l'API partagent le même hôte.
// =============================================================================

mod discord;
mod domain;
mod quote;
mod store;
mod ws; // frontière Phase 2 (esquisse, non câblée — voir Docs/PHASE2.md)

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    async_trait,
    extract::{ws::WebSocketUpgrade, FromRequestParts, Query, State},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::sqlite::SqlitePool;
use tower_http::services::{ServeDir, ServeFile};

use discord::{AuthError, DiscordConfig, Identity};
use domain::replay::{compute_scoreboard, ScoreInput};
use domain::types::{
    AnalysisResponse, HistoryResponse, RunDetailResponse, SubmitRunRequest, SubmitRunResponse,
    TokenRequest, TokenResponse,
};
use quote::{QuoteClient, QuoteResponse};

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    identity: Arc<Identity>,
    quotes: Arc<QuoteClient>,
    rooms: ws::Rooms,
}

#[tokio::main]
async fn main() {
    // Charge backend/.env si présent (sinon on lit l'environnement du process tel quel).
    let _ = dotenvy::dotenv();

    let pool = store::init_pool().await;
    let identity = Arc::new(Identity::new(DiscordConfig::from_env()));
    let quotes = Arc::new(QuoteClient::from_env());
    let rooms = ws::new_rooms();
    let state = AppState { pool, identity, quotes, rooms };

    // Build statique de Vite (origine unique). Surcoûtable via STATIC_DIR.
    let static_dir =
        std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/dist".to_string());
    let spa = ServeDir::new(&static_dir)
        .fallback(ServeFile::new(format!("{static_dir}/index.html")));

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/quote", get(quote_handler))
        .route("/token", post(token))
        .route("/api/runs", post(submit_run))
        .route("/api/runs/:id", get(run_detail))
        .route("/api/runs/:id/analysis", get(run_analysis))
        .route("/api/profile/analysis", get(profile_analysis))
        .route("/api/history", get(history))
        .route("/ws", get(ws_handler))
        .with_state(state)
        // Tout ce qui ne matche pas une route API → fichiers statiques (puis index.html).
        .fallback_service(spa);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("bind {addr}: {e}"));
    println!("TypeRacerDiscord backend → http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}

async fn health() -> &'static str {
    "ok"
}

/// GET /api/quote — proxy vers API-Ninjas (clé injectée côté serveur). 502 si amont KO.
/// Authentifié : sans Bearer valide, n'importe qui sur l'URL publique viderait le quota.
async fn quote_handler(
    State(state): State<AppState>,
    AuthPlayer(_player_id): AuthPlayer,
) -> Result<Json<QuoteResponse>, StatusCode> {
    state
        .quotes
        .fetch()
        .await
        .map(Json)
        .map_err(|_| StatusCode::BAD_GATEWAY)
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
    // Sérialisé AVANT le recompute (qui prend possession des keystrokes) : le log
    // brut est persisté depuis la migration 0002 (futures features replay/analyse).
    let keystroke_log =
        serde_json::to_string(&req.keystrokes).unwrap_or_else(|_| "[]".to_string());
    // Cloné avant le recompute (qui prend possession du texte) : persisté verbatim
    // depuis la migration 0003 pour le Replay (ADR 0001).
    let target_text = req.target_text.clone();
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
        "practice",
        &req.config,
        &scoreboard,
        &keystroke_log,
        &target_text,
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
struct WsQuery {
    token: String,
}

/// GET /ws — connexion Race. L'identité est résolue AVANT l'upgrade depuis
/// `?token=` (l'API WebSocket du navigateur ne permet pas d'en-tête Authorization).
async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> Response {
    let player_id = match state.identity.resolve_player_id(&q.token).await {
        Ok(id) => id,
        Err(e) => return auth_status(e).into_response(),
    };
    // Un log de course fait quelques dizaines de Ko ; sans borne (64 Mio par défaut),
    // un Finish géant se recompute sous le verrou global des Rooms.
    ws.max_message_size(256 * 1024)
        .on_upgrade(move |socket| {
            ws::handle_socket(socket, state.rooms.clone(), player_id, state.pool.clone())
        })
}

/// GET /api/runs/:id — un Run complet pour le Replay (log + texte cible).
/// 404 indistinctement : inconnu, à un autre joueur, ou non rejouable (ADR 0001).
async fn run_detail(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
    axum::extract::Path(run_id): axum::extract::Path<String>,
) -> Result<Json<RunDetailResponse>, StatusCode> {
    store::run_detail(&state.pool, &run_id, &player_id)
        .await
        .map_err(internal)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// GET /api/runs/:id/analysis — Weak spots du Run (moteur 1..N logs, ici N=1).
/// Mêmes règles d'accès que /api/runs/:id (404 indistinct).
async fn run_analysis(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
    axum::extract::Path(run_id): axum::extract::Path<String>,
) -> Result<Json<AnalysisResponse>, StatusCode> {
    let run = store::run_detail(&state.pool, &run_id, &player_id)
        .await
        .map_err(internal)?
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(crate::domain::analysis::analyze(&[(
        run.target_text.as_str(),
        run.keystrokes.as_slice(),
    )])))
}

/// Nombre de Runs récents agrégés pour le profil « Mes faiblesses » (#6).
const PROFILE_RUNS: i64 = 20;

/// GET /api/profile/analysis — Weak spots agrégés sur les derniers Runs du joueur.
/// Même moteur que /api/runs/:id/analysis (analyze accepte 1..N logs).
async fn profile_analysis(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
) -> Result<Json<AnalysisResponse>, StatusCode> {
    let runs = store::recent_logs(&state.pool, &player_id, PROFILE_RUNS)
        .await
        .map_err(internal)?;
    let refs: Vec<(&str, &[domain::types::Keystroke])> =
        runs.iter().map(|(t, k)| (t.as_str(), k.as_slice())).collect();
    Ok(Json(crate::domain::analysis::analyze(&refs)))
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
