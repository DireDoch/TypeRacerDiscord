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
mod rate_limit;
mod store;
mod ws;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    async_trait,
    extract::{ws::WebSocketUpgrade, FromRequestParts, Query, State},
    http::{
        header::{AUTHORIZATION, CONTENT_SECURITY_POLICY, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS},
        request::Parts, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::sqlite::SqlitePool;
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

use discord::{AuthError, DiscordConfig, Identity};
use domain::replay::{compute_scoreboard, ScoreInput};
use domain::types::{
    AnalysisResponse, HistoryResponse, LearnProgress, RunDetailResponse, SubmitRunRequest,
    SubmitRunResponse, TokenRequest, TokenResponse,
};
use quote::{QuoteClient, QuoteResponse};
use rate_limit::{RateLimiter, API_PER_MIN, QUOTE_PER_MIN, TOKEN_PER_MIN, WS_PER_MIN};

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    identity: Arc<Identity>,
    quotes: Arc<QuoteClient>,
    rooms: ws::Rooms,
    limits: Arc<RateLimiter>,
}

#[tokio::main]
async fn main() {
    // Charge le `.env` du projet si présent — `dotenvy` cherche dans le dossier courant
    // puis remonte les parents, donc le `.env` de la RACINE est trouvé depuis `backend/`.
    // Sinon on lit l'environnement du process tel quel.
    let _ = dotenvy::dotenv();

    let pool = store::init_pool().await;
    let identity = Arc::new(Identity::new(DiscordConfig::from_env()));
    let quotes = Arc::new(QuoteClient::from_env());
    let rooms = ws::new_rooms();
    // Clôt les courses anormalement longues (issue #24) ; `quotes` sert à regénérer le
    // texte de la Room close depuis sa Source (ADR 0009).
    ws::spawn_watchdog(rooms.clone(), quotes.clone());
    let state =
        AppState { pool, identity, quotes, rooms, limits: Arc::new(RateLimiter::new()) };

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
        .route("/api/learn/progress", get(get_learn_progress).post(post_learn_progress))
        .route("/ws", get(ws_handler))
        .with_state(state)
        // Tout ce qui ne matche pas une route API → fichiers statiques (puis index.html).
        .fallback_service(spa)
        // Posées APRÈS le fallback : elles couvrent aussi les fichiers statiques, donc
        // le document HTML — le seul endroit où une CSP sert vraiment (#152).
        .layer(SetResponseHeaderLayer::overriding(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ));

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("bind {addr}: {e}"));
    println!("TypeRacerDiscord backend → http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}

/// CSP servie avec CHAQUE réponse (issue #152).
///
/// Dans l'iframe Discord, `{clientId}.discordsays.com` applique déjà la sienne — c'est
/// elle qui impose le préfixe `/.proxy/`. Celle-ci couvre l'autre porte : l'URL du tunnel,
/// atteignable directement dans un navigateur, où plus rien ne s'applique.
///
/// ⚠️ `frame-ancestors` AUTORISE Discord, et doit continuer à le faire : une politique qui
/// interdit l'encadrement (ou un `X-Frame-Options: DENY`) rend le jeu totalement injouable
/// — l'Activity N'EST qu'une iframe. C'est la façon la plus rapide de casser le produit en
/// croyant le durcir.
///
/// Le reste suit ce que le code fait déjà :
///   - `img-src` : les avatars viennent de `cdn.discordapp.com` (`discord.ts: avatarUrl`).
///   - `connect-src` : même origine (le proxy Discord réécrit `/.proxy/…` avant nous),
///     plus `wss:` par sécurité — la course entière passe par le WebSocket.
///   - `style-src 'unsafe-inline'` : les templates posent des `style="--n:…"` et
///     `style="width:…%"` (barres de progression, sections de réglages).
const CSP: &str = "default-src 'self'; \
     img-src 'self' https://cdn.discordapp.com data:; \
     connect-src 'self' wss:; \
     style-src 'self' 'unsafe-inline'; \
     frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com; \
     base-uri 'none'; \
     form-action 'none'";

async fn health() -> &'static str {
    "ok"
}

/// GET /api/quote — proxy vers API-Ninjas (clé injectée côté serveur). 502 si amont KO.
/// Authentifié : sans Bearer valide, n'importe qui sur l'URL publique viderait le quota.
/// Plafond PROPRE, plus serré que celui de l'extracteur : le quota API-Ninjas est mensuel
/// et partagé par tous les joueurs, un seul suffirait à le vider (#151).
async fn quote_handler(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
) -> Result<Json<QuoteResponse>, StatusCode> {
    if !state.limits.allow("quote", &player_id, QUOTE_PER_MIN) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    state
        .quotes
        .fetch()
        .await
        .map(Json)
        .map_err(|_| StatusCode::BAD_GATEWAY)
}

/// POST /token — échange le code OAuth contre un access_token (secret client serveur).
/// Nommé « GET /token » par convention Discord ; implémenté en POST car il porte un corps JSON.
///
/// ponytail: plafond GLOBAL, pas par joueur — avant l'échange il n'y a pas encore
/// d'identité, et derrière le tunnel toutes les requêtes portent la même IP (127.0.0.1),
/// ce qui rendrait un plafond par IP équivalent à celui-ci en moins lisible. Il borne ce
/// que NOUS envoyons à Discord ; le jour où un reverse proxy de confiance pose un vrai
/// `X-Forwarded-For`, le passer en clé ici suffit.
async fn token(
    State(state): State<AppState>,
    Json(req): Json<TokenRequest>,
) -> Result<Json<TokenResponse>, StatusCode> {
    if !state.limits.allow("token", "", TOKEN_PER_MIN) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
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
        // Solo : personne d'autre que le joueur ne décide de la fin d'un Run (#164).
        duration_override_ms: None,
    });

    // PB précédent du bucket (avant insertion) → verdict.
    let previous = store::previous_pb(&state.pool, &player_id, &req.config)
        .await
        .map_err(internal)?;
    let is_personal_best =
        scoreboard.pb_eligible && previous.is_none_or(|p| scoreboard.wpm > p);

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
        Err(e) => {
            eprintln!("GET /ws → auth refusée ({e:?}) — un DISCORD_CLIENT_ID/SECRET réel dans .env bloque les tokens de test (?token=alice) : voir mode dev dans le README.");
            return auth_status(e).into_response();
        }
    };
    // Compte les CONNEXIONS : une partie en ouvre une, un réseau qui vacille quelques-unes
    // de plus. Chacune coûte une résolution d'identité et une place dans la Room (#151).
    if !state.limits.allow("ws", &player_id, WS_PER_MIN) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    // Un log de course fait quelques dizaines de Ko ; sans borne (64 Mio par défaut),
    // un Finish géant se recompute sous le verrou global des Rooms.
    ws.max_message_size(256 * 1024)
        .on_upgrade(move |socket| {
            ws::handle_socket(
                socket,
                state.rooms.clone(),
                player_id,
                state.pool.clone(),
                state.quotes.clone(),
            )
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

/// GET /api/learn/progress — progression « Apprendre » du joueur (0 si jamais joué).
async fn get_learn_progress(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
) -> Result<Json<LearnProgress>, StatusCode> {
    let completed = store::learn_progress(&state.pool, &player_id)
        .await
        .map_err(internal)?;
    Ok(Json(LearnProgress { completed }))
}

/// POST /api/learn/progress — enregistre une progression (le serveur garde le MAX).
/// Le seuil d'accuracy est vérifié côté client (leçons = pas des Runs, pas d'anti-triche) ;
/// on borne juste la valeur pour garder la table saine.
async fn post_learn_progress(
    State(state): State<AppState>,
    AuthPlayer(player_id): AuthPlayer,
    Json(req): Json<LearnProgress>,
) -> Result<Json<LearnProgress>, StatusCode> {
    let completed = req.completed.clamp(0, 1000);
    let completed = store::set_learn_progress(&state.pool, &player_id, completed, now_ms() as i64)
        .await
        .map_err(internal)?;
    Ok(Json(LearnProgress { completed }))
}

// ----------------------------------------------------------------------------
//  Identité & helpers d'erreur
// ----------------------------------------------------------------------------

/// Identité du joueur, résolue depuis `Authorization: Bearer <token>` (jamais via le corps).
/// Extracteur `FromRequestParts` : s'exécute AVANT le parsing du corps JSON → un token
/// absent renvoie 401 même si le corps est invalide.
///
/// C'est aussi le point de passage de TOUS les endpoints authentifiés : le plafond de
/// requêtes par joueur est posé ici une fois (#151), plutôt que dans chaque handler — un
/// endpoint ajouté demain est protégé sans rien écrire.
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
        let player_id = state.identity.resolve_player_id(token).await.map_err(|e| {
            eprintln!("{} {} → auth refusée ({e:?})", parts.method, parts.uri);
            auth_status(e)
        })?;
        if !state.limits.allow("api", &player_id, API_PER_MIN) {
            eprintln!("{} {} → plafond atteint pour {player_id}", parts.method, parts.uri);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
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

fn internal<E: std::fmt::Debug>(e: E) -> StatusCode {
    eprintln!("500 : {e:?}");
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Deux façons de casser la CSP sans s'en rendre compte : une valeur d'en-tête
    /// invalide (`from_static` panique alors AU DÉMARRAGE, pas ici), et un durcissement
    /// bien intentionné de `frame-ancestors` — qui rendrait l'Activity, donc le jeu
    /// entier, impossible à afficher dans Discord.
    #[test]
    fn la_csp_est_valide_et_laisse_discord_encadrer_le_jeu() {
        let v = HeaderValue::from_static(CSP);
        assert!(v.to_str().is_ok(), "en-tête illisible");
        assert!(CSP.contains("frame-ancestors https://discord.com"), "Discord doit rester autorisé à encadrer");
        assert!(CSP.contains("https://*.discordsays.com"), "l'iframe sert depuis discordsays.com");
        assert!(!CSP.contains("frame-ancestors 'none'"), "interdirait l'Activity");
        assert!(CSP.contains("cdn.discordapp.com"), "sans ça, plus aucun avatar");
    }
}
