// =============================================================================
//  discord.rs — identité & OAuth Discord (scope `identify`).
//
//  Deux responsabilités (Docs/API.md « Identité & sécurité ») :
//   1. POST /token : échanger le `code` (Embedded App SDK) contre un access_token.
//      Le secret client reste SERVEUR.
//   2. Résoudre le player_id (snowflake) depuis l'access_token via GET /users/@me.
//      Jamais fourni par le corps de requête → non forgeable.
//
//  MODE DEV : si DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET sont absents de l'env,
//  on n'appelle pas Discord — le Bearer token sert directement de player_id (test
//  local au curl). Dès que les secrets sont présents, l'échange réel s'active sans
//  changer la forme des endpoints.
// =============================================================================

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DISCORD_API: &str = "https://discord.com/api";
const TOKEN_TTL: Duration = Duration::from_secs(300); // cache court (5 min)

/// Secrets Discord lus une fois au démarrage. `None` = mode dev.
#[derive(Clone)]
pub struct DiscordConfig {
    pub client_id: String,
    pub client_secret: String,
}

impl DiscordConfig {
    /// Charge depuis l'env, ou `None` si l'un des deux secrets manque (mode dev).
    pub fn from_env() -> Option<DiscordConfig> {
        let client_id = std::env::var("DISCORD_CLIENT_ID").ok()?;
        let client_secret = std::env::var("DISCORD_CLIENT_SECRET").ok()?;
        if client_id.is_empty() || client_secret.is_empty() {
            return None;
        }
        Some(DiscordConfig { client_id, client_secret })
    }
}

/// Cache access_token → player_id (évite un appel /users/@me par requête).
pub struct Identity {
    config: Option<DiscordConfig>,
    http: reqwest::Client,
    cache: Mutex<HashMap<String, (String, Instant)>>,
}

#[derive(Debug)]
pub enum AuthError {
    /// Token absent ou échec de résolution → 401.
    Unauthorized,
    /// Discord injoignable / quota → 502.
    Upstream,
    /// OAuth non configuré côté serveur (mode dev) alors qu'on tente l'échange → 503.
    NotConfigured,
}

impl Identity {
    pub fn new(config: Option<DiscordConfig>) -> Identity {
        if config.is_none() {
            eprintln!("⚠️  OAuth Discord non configuré (DISCORD_CLIENT_ID/SECRET absents) → MODE DEV : le Bearer token sert de player_id.");
        }
        Identity {
            config,
            http: reqwest::Client::new(),
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Échange le `code` d'autorisation contre un access_token (POST /oauth2/token).
    pub async fn exchange_code(&self, code: &str) -> Result<String, AuthError> {
        let cfg = self.config.as_ref().ok_or(AuthError::NotConfigured)?;
        let params = [
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code),
        ];
        let resp = self
            .http
            .post(format!("{DISCORD_API}/oauth2/token"))
            .form(&params)
            .send()
            .await
            .map_err(|_| AuthError::Upstream)?;
        if !resp.status().is_success() {
            // 4xx = code invalide → 401 ; 5xx = Discord en panne → 502.
            return Err(if resp.status().is_client_error() {
                AuthError::Unauthorized
            } else {
                AuthError::Upstream
            });
        }
        let body: serde_json::Value = resp.json().await.map_err(|_| AuthError::Upstream)?;
        body.get("access_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or(AuthError::Upstream)
    }

    /// Résout le player_id (snowflake string) depuis un access_token.
    /// Mode dev (pas de config) : le token EST l'identité.
    pub async fn resolve_player_id(&self, access_token: &str) -> Result<String, AuthError> {
        if self.config.is_none() {
            return Ok(access_token.to_string()); // MODE DEV
        }

        if let Some(id) = self.cache_get(access_token) {
            return Ok(id);
        }

        let resp = self
            .http
            .get(format!("{DISCORD_API}/users/@me"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| AuthError::Upstream)?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::Unauthorized);
        }
        if !resp.status().is_success() {
            return Err(AuthError::Upstream);
        }
        let body: serde_json::Value = resp.json().await.map_err(|_| AuthError::Upstream)?;
        let id = body
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or(AuthError::Upstream)?
            .to_string();

        self.cache_put(access_token, &id);
        Ok(id)
    }

    fn cache_get(&self, token: &str) -> Option<String> {
        let mut cache = self.cache.lock().unwrap();
        match cache.get(token) {
            Some((id, at)) if at.elapsed() < TOKEN_TTL => Some(id.clone()),
            Some(_) => {
                cache.remove(token);
                None
            }
            None => None,
        }
    }

    fn cache_put(&self, token: &str, id: &str) {
        self.cache
            .lock()
            .unwrap()
            .insert(token.to_string(), (id.to_string(), Instant::now()));
    }
}
