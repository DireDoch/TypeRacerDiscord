// =============================================================================
//  quote.rs — proxy serveur vers API-Ninjas (GET /api/quote).
//
//  Le client ne voit jamais la clé : elle est injectée côté serveur dans l'en-tête
//  `X-Api-Key`. Mode Quotes uniquement (Settings et longueurs ignorés — le Player
//  tape la Quote entière). Voir Docs/API.md « GET /api/quote ».
//
//  MODE DEV : si APININJAS_API_KEY est absente de l'env, l'endpoint renvoie 502
//  (proxy non configuré) — il n'y a pas de Quote de repli (contrairement à l'OAuth
//  qui, lui, a un mode dev).
// =============================================================================

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

const APININJAS_QUOTES: &str = "https://api.api-ninjas.com/v1/quotes";

/// Réponse de `GET /api/quote` (miroir de `Quote` dans `frontend/src/core/types.ts`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteResponse {
    /// Identifiant opaque, ré-échoié dans `POST /api/runs` (`quoteId`).
    pub id: String,
    pub text: String,
    pub author: String,
    /// Lien « en savoir plus » construit côté serveur depuis le nom d'auteur.
    pub wikipedia_url: String,
}

/// Une entrée brute de la réponse API-Ninjas (`[{ quote, author, category }]`).
#[derive(Debug, Deserialize)]
struct NinjaQuote {
    quote: String,
    author: String,
}

/// Erreur du proxy : tout échec amont (clé absente, réseau, quota) → 502.
#[derive(Debug)]
pub struct QuoteError;

/// Client réutilisable (réutilise le pool de connexions reqwest). `key` = None → 502.
pub struct QuoteClient {
    http: reqwest::Client,
    key: Option<String>,
}

impl QuoteClient {
    /// Lit `APININJAS_API_KEY` une fois au démarrage. Vide/absente ⇒ proxy non configuré.
    pub fn from_env() -> QuoteClient {
        let key = std::env::var("APININJAS_API_KEY").ok().filter(|k| !k.is_empty());
        if key.is_none() {
            eprintln!("⚠️  APININJAS_API_KEY absente → GET /api/quote renverra 502 (proxy citations non configuré).");
        }
        QuoteClient { http: reqwest::Client::new(), key }
    }

    /// Récupère une Quote aléatoire via API-Ninjas et la met au format du contrat.
    pub async fn fetch(&self) -> Result<QuoteResponse, QuoteError> {
        let key = self.key.as_ref().ok_or(QuoteError)?;
        let resp = self
            .http
            .get(APININJAS_QUOTES)
            .header("X-Api-Key", key)
            .send()
            .await
            .map_err(|_| QuoteError)?;
        if !resp.status().is_success() {
            return Err(QuoteError);
        }
        // API-Ninjas renvoie un tableau (souvent d'un seul élément).
        let quotes: Vec<NinjaQuote> = resp.json().await.map_err(|_| QuoteError)?;
        let q = quotes.into_iter().next().ok_or(QuoteError)?;

        Ok(QuoteResponse {
            id: opaque_id(&q.quote),
            wikipedia_url: wikipedia_url(&q.author),
            text: q.quote,
            author: q.author,
        })
    }
}

/// Identifiant opaque et stable dérivé du texte (`q_<hex>`), suffisant pour le ré-écho.
fn opaque_id(text: &str) -> String {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    format!("q_{:x}", h.finish())
}

/// Construit l'URL Wikipedia anglaise de l'auteur (espaces → underscores, encodage minimal).
fn wikipedia_url(author: &str) -> String {
    let slug: String = author
        .trim()
        .chars()
        .map(|c| if c == ' ' { '_' } else { c })
        .collect();
    let encoded = slug.replace('&', "%26").replace('?', "%3F").replace('#', "%23");
    format!("https://en.wikipedia.org/wiki/{encoded}")
}
