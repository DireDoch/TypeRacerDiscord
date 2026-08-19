// =============================================================================
//  discord.rs — identité & OAuth Discord (scope `identify`).
//
//  Deux responsabilités (Docs/API.md « Identité & sécurité ») :
//   1. POST /token : échanger le `code` (Embedded App SDK) contre un access_token.
//      Le secret client reste SERVEUR.
//   2. Résoudre le player_id (snowflake) depuis l'access_token via GET /oauth2/@me.
//      Jamais fourni par le corps de requête → non forgeable.
//      `/oauth2/@me` plutôt que `/users/@me` : il renvoie AUSSI l'application émettrice
//      du token, ce qui permet de refuser un token obtenu pour une autre app Discord
//      (issue #150). Même nombre d'allers-retours, une comparaison en plus.
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
/// Doit correspondre EXACTEMENT au Redirect enregistré dans le portail développeur
/// (onglet OAuth2 → Redirects). Jamais navigué en vrai pour une Activity (le code
/// vient de `sdk.commands.authorize`, pas d'un redirect HTTP) — mais Discord exige
/// quand même ce paramètre sur `/oauth2/token`, et un portail sans Redirect enregistré
/// fait déjà échouer `authorize()` côté client avec « invalid_request: Missing
/// "redirect_uri" ». Voir README « Portail développeur ».
const REDIRECT_URI: &str = "https://127.0.0.1";
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
            ("redirect_uri", REDIRECT_URI),
        ];
        let resp = self
            .http
            .post(format!("{DISCORD_API}/oauth2/token"))
            .form(&params)
            .send()
            .await
            .map_err(|_| AuthError::Upstream)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("POST /oauth2/token → Discord a répondu {status} : {body}");
            // 4xx = code invalide → 401 ; 5xx = Discord en panne → 502.
            return Err(if status.is_client_error() {
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
        let Some(cfg) = self.config.as_ref() else {
            return Ok(access_token.to_string()); // MODE DEV
        };

        if let Some(id) = self.cache_get(access_token) {
            return Ok(id);
        }

        let resp = self
            .http
            .get(format!("{DISCORD_API}/oauth2/@me"))
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
        let id = player_id_from_oauth_me(&body, &cfg.client_id)?;

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

/// Lit le player_id dans une réponse `GET /oauth2/@me`, en refusant un token émis pour
/// une AUTRE application Discord (issue #150).
///
/// Un access_token Discord est valable sur `/users/@me` quelle que soit l'app qui l'a
/// obtenu : sans cette comparaison, la frontière n'est pas « un joueur de cette Activity »
/// mais « un utilisateur Discord quelconque ». Combiné à `JoinChannel`, dont la clé de
/// salon est déclarée par le client, ça suffit à squatter le lobby d'autrui.
///
/// Application inattendue → `Unauthorized` (le token est valide, il n'est pas pour nous).
/// Corps illisible → `Upstream` (Discord a répondu 200 avec autre chose que le contrat).
fn player_id_from_oauth_me(
    body: &serde_json::Value,
    client_id: &str,
) -> Result<String, AuthError> {
    let issuer = body.pointer("/application/id").and_then(|v| v.as_str());
    if issuer != Some(client_id) {
        eprintln!("/oauth2/@me → token émis pour l'application {issuer:?}, pas la nôtre");
        return Err(AuthError::Unauthorized);
    }
    body.pointer("/user/id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or(AuthError::Upstream)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oauth_me(app_id: &str, user_id: Option<&str>) -> serde_json::Value {
        let mut v = serde_json::json!({ "application": { "id": app_id }, "scopes": ["identify"] });
        if let Some(u) = user_id {
            v["user"] = serde_json::json!({ "id": u });
        }
        v
    }

    #[test]
    fn seul_un_token_emis_pour_notre_application_resout_un_joueur() {
        let cas: [(&str, serde_json::Value, Result<&str, AuthError>); 4] = [
            ("notre app", oauth_me("42", Some("111")), Ok("111")),
            ("autre app", oauth_me("999", Some("111")), Err(AuthError::Unauthorized)),
            ("pas d'application", serde_json::json!({ "user": { "id": "111" } }), Err(AuthError::Unauthorized)),
            ("notre app, pas d'utilisateur", oauth_me("42", None), Err(AuthError::Upstream)),
        ];
        for (nom, body, attendu) in cas {
            let obtenu = player_id_from_oauth_me(&body, "42");
            match (obtenu, attendu) {
                (Ok(id), Ok(a)) => assert_eq!(id, a, "{nom}"),
                (Err(AuthError::Unauthorized), Err(AuthError::Unauthorized)) => {}
                (Err(AuthError::Upstream), Err(AuthError::Upstream)) => {}
                (o, a) => panic!("{nom} : obtenu {o:?}, attendu {a:?}"),
            }
        }
    }
}
