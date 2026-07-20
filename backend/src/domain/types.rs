// =============================================================================
//  domain/types.rs — types de domaine partagés.
//
//  MIROIR Rust de `frontend/src/core/types.ts` (pas de générateur ; on tient la
//  parité à la main, comme figé dans CONTEXT.md). Les noms de champs JSON sont en
//  camelCase pour matcher le contrat de Docs/API.md et le client TS.
//
//  Règles de calcul : voir domain/replay.rs (port de stats/scoreboard.ts).
// =============================================================================

use serde::{Deserialize, Serialize};

// ----------------------------------------------------------------------------
//  Mode / Setting / Config bucket
// ----------------------------------------------------------------------------

/// Le Mode décide quel texte est présenté et quand le Run se termine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Time,
    Words,
    Quotes,
    Zen,
}

impl Mode {
    /// Représentation stockée en base / utilisée dans les requêtes SQL (= valeur JSON).
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Time => "time",
            Mode::Words => "words",
            Mode::Quotes => "quotes",
            Mode::Zen => "zen",
        }
    }

    /// Reconstruit un Mode depuis la colonne `mode` (lecture d'historique).
    pub fn from_db(s: &str) -> Option<Mode> {
        match s {
            "time" => Some(Mode::Time),
            "words" => Some(Mode::Words),
            "quotes" => Some(Mode::Quotes),
            "zen" => Some(Mode::Zen),
            _ => None,
        }
    }
}

/// Configuration d'un Run = le Config bucket (ce qui rend deux Runs comparables).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfig {
    pub mode: Mode,
    /// time : secondes (0 = infini) · words : nb mots · quotes/zen : 0.
    pub mode_value: i64,
    pub language: String,
    pub punctuation: bool,
    pub numbers: bool,
}

// ----------------------------------------------------------------------------
//  Keystroke log (matière première du recompute autoritaire)
// ----------------------------------------------------------------------------

/// Touche de contrôle modifiant le buffer. Pas de navigation curseur en MVP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ControlKey {
    Backspace,
    BackspaceWord,
}

/// Un événement clavier brut : { t, k } pour un caractère, { t, k:"", ctrl } pour un contrôle.
/// `t` = ms depuis t=0 (fin du décompte).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keystroke {
    pub t: f64,
    /// Caractère imprimable (espace inclus). Vide "" pour une touche de contrôle.
    pub k: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctrl: Option<ControlKey>,
}

// ----------------------------------------------------------------------------
//  Scoreboard autoritaire (produit par le recompute)
// ----------------------------------------------------------------------------

/// Décompte final des caractères. correct/incorrect par frappe ; extra/missed à l'état final.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterBreakdown {
    pub correct: i64,
    pub incorrect: i64,
    pub extra: i64,
    pub missed: i64,
}

/// Un point de la série par seconde (colonne `per_second` de la DB).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PerSecondPoint {
    pub t: f64,
    pub wpm: f64,
    pub raw: f64,
    pub errors: i64,
    pub burst: f64,
}

/// Les chiffres de record, produits exclusivement par le recompute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scoreboard {
    pub wpm: f64,
    pub raw: f64,
    pub accuracy: f64,
    pub characters: CharacterBreakdown,
    pub duration_ms: f64,
    pub per_second: Vec<PerSecondPoint>,
    pub pb_eligible: bool,
}

// ----------------------------------------------------------------------------
//  DTOs HTTP (contrat complet : Docs/API.md)
// ----------------------------------------------------------------------------

/// POST /api/runs — corps de requête. Identité via header Authorization (pas dans le corps).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunRequest {
    pub config: RunConfig,
    pub seed: i64,
    /// Texte cible complet (mots joints par espaces). "" pour Zen.
    pub target_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote_id: Option<String>,
    pub keystrokes: Vec<Keystroke>,
    /// Instant de fin en ms depuis t=0 (Shift+Enter pour Zen / Time infini).
    pub ended_at_ms: f64,
}

/// POST /api/runs — réponse (scoreboard autoritaire + verdict PB).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunResponse {
    pub run_id: String,
    pub scoreboard: Scoreboard,
    pub is_personal_best: bool,
    pub previous_pb_wpm: Option<f64>,
}

/// GET /api/history — un Run passé (perSecond inclus pour re-tracer le graphe sans recompute).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub run_id: String,
    pub created_at: i64,
    /// "practice" | "race" — provenance du Run (les Races : historique seulement, jamais PB).
    pub kind: String,
    pub config: RunConfig,
    pub wpm: f64,
    pub raw: f64,
    pub accuracy: f64,
    pub characters: CharacterBreakdown,
    pub duration_ms: f64,
    pub per_second: Vec<PerSecondPoint>,
    pub pb_eligible: bool,
    /// true si le Run peut être rejoué : keystroke log ET texte cible en base
    /// (les Runs d'avant les migrations 0002/0003 ne le peuvent pas — ADR 0001).
    pub replayable: bool,
}

/// GET /api/runs/:id — un Run complet pour le Replay (log + texte cible).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetailResponse {
    pub run_id: String,
    pub config: RunConfig,
    /// Texte cible verbatim ("" pour Zen).
    pub target_text: String,
    pub keystrokes: Vec<Keystroke>,
}

/// Un Weak spot (CONTEXT.md) : touche ou bigramme plus lent/fautif que la moyenne
/// DU JOUEUR, avec assez d'occurrences pour être significatif.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakSpot {
    /// Le(s) caractère(s) cible(s) : 1 char pour une touche, 2 pour un bigramme.
    pub chars: String,
    /// "key" | "bigram".
    pub kind: String,
    pub occurrences: i64,
    pub mean_delay_ms: f64,
    /// 0..1 (fautes / frappes sur cette cible).
    pub error_rate: f64,
    pub slow: bool,
    pub faulty: bool,
    /// Tri décroissant côté serveur (excès de lenteur + excès d'erreurs pondéré).
    pub severity: f64,
}

/// GET /api/runs/:id/analysis — Weak spots d'un Run (ou d'un profil, plus tard).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResponse {
    pub weak_spots: Vec<WeakSpot>,
    pub global_mean_delay_ms: f64,
    /// 0..1.
    pub global_error_rate: f64,
    pub runs_analyzed: i64,
}

/// GET /api/history — réponse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryResponse {
    pub entries: Vec<HistoryEntry>,
}

/// POST /token — corps de requête (code OAuth fourni par l'Embedded App SDK).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenRequest {
    pub code: String,
}

/// POST /token — réponse (access_token Discord ; le secret client reste serveur).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
}
