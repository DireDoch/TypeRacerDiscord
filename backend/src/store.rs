// =============================================================================
//  store.rs — persistance SQLite (sqlx) : table UNIQUE `runs`.
//
//  Le PB n'a PAS de table (CONTEXT.md) : il se dérive par MAX(wpm) GROUP BY bucket
//  WHERE pb_eligible = 1 (index idx_runs_pb). Schéma : backend/migrations/0001_init.sql.
//  Requêtes en runtime (pas les macros compile-time) pour ne pas dépendre d'une DB
//  présente au build.
// =============================================================================

use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::{QueryBuilder, Row, Sqlite};

use crate::domain::types::{
    CharacterBreakdown, HistoryEntry, PerSecondPoint, RunConfig, RunDetailResponse, Scoreboard,
};

/// Ouvre le pool, crée le fichier au besoin et applique les migrations embarquées.
pub async fn init_pool() -> SqlitePool {
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:typeracer.db".to_string());
    let opts = SqliteConnectOptions::from_str(&url)
        .expect("DATABASE_URL invalide")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .connect_with(opts)
        .await
        .expect("connexion SQLite");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("application des migrations");
    pool
}

/// PB courant du bucket (MAX wpm parmi les Runs éligibles), ou None s'il n'y en a pas.
/// À appeler AVANT d'insérer le nouveau Run pour obtenir le « précédent ».
pub async fn previous_pb(
    pool: &SqlitePool,
    player_id: &str,
    config: &RunConfig,
) -> Result<Option<f64>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT MAX(wpm) AS pb FROM runs
         WHERE player_id = ? AND mode = ? AND mode_value = ?
           AND language = ? AND punctuation = ? AND numbers = ? AND pb_eligible = 1",
    )
    .bind(player_id)
    .bind(config.mode.as_str())
    .bind(config.mode_value)
    .bind(&config.language)
    .bind(config.punctuation as i64)
    .bind(config.numbers as i64)
    .fetch_one(pool)
    .await?;
    row.try_get::<Option<f64>, _>("pb")
}

/// Insère un Run. Le keystroke log (JSON brut, déjà validé par le recompute) est
/// persisté depuis la migration 0002, le texte cible verbatim depuis la 0003
/// (ADR 0001) — matière première du Replay et de l'analyse. `kind` : "practice"
/// ou "race".
pub async fn insert_run(
    pool: &SqlitePool,
    run_id: &str,
    player_id: &str,
    created_at: i64,
    kind: &str,
    config: &RunConfig,
    sb: &Scoreboard,
    keystroke_log_json: &str,
    target_text: &str,
) -> Result<(), sqlx::Error> {
    let per_second_json = serde_json::to_string(&sb.per_second).unwrap_or_else(|_| "[]".to_string());
    sqlx::query(
        "INSERT INTO runs
            (id, player_id, created_at, kind, mode, mode_value, language, punctuation, numbers,
             wpm, raw, accuracy, chars_correct, chars_incorrect, chars_extra, chars_missed,
             duration_ms, per_second, pb_eligible, keystroke_log, target_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(run_id)
    .bind(player_id)
    .bind(created_at)
    .bind(kind)
    .bind(config.mode.as_str())
    .bind(config.mode_value)
    .bind(&config.language)
    .bind(config.punctuation as i64)
    .bind(config.numbers as i64)
    .bind(sb.wpm)
    .bind(sb.raw)
    .bind(sb.accuracy)
    .bind(sb.characters.correct)
    .bind(sb.characters.incorrect)
    .bind(sb.characters.extra)
    .bind(sb.characters.missed)
    .bind(sb.duration_ms.round() as i64) // colonne INTEGER : ms entières
    .bind(per_second_json)
    .bind(sb.pb_eligible as i64)
    .bind(keystroke_log_json)
    .bind(target_text)
    .execute(pool)
    .await?;
    Ok(())
}

/// Historique du joueur (plus récent d'abord), filtrable par bucket partiel (mode / modeValue).
pub async fn history(
    pool: &SqlitePool,
    player_id: &str,
    mode: Option<&str>,
    mode_value: Option<i64>,
    limit: i64,
) -> Result<Vec<HistoryEntry>, sqlx::Error> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT id, created_at, kind, mode, mode_value, language, punctuation, numbers,
                wpm, raw, accuracy, chars_correct, chars_incorrect, chars_extra, chars_missed,
                duration_ms, per_second, pb_eligible,
                (keystroke_log IS NOT NULL AND target_text IS NOT NULL) AS replayable
         FROM runs WHERE player_id = ",
    );
    qb.push_bind(player_id.to_string());
    if let Some(m) = mode {
        qb.push(" AND mode = ").push_bind(m.to_string());
    }
    if let Some(mv) = mode_value {
        qb.push(" AND mode_value = ").push_bind(mv);
    }
    qb.push(" ORDER BY created_at DESC LIMIT ").push_bind(limit);

    let rows = qb.build().fetch_all(pool).await?;
    rows.iter().map(row_to_entry).collect()
}

/// Un Run complet pour le Replay : config + texte cible + keystroke log.
/// `None` si le Run n'existe pas, appartient à un autre joueur, ou n'est pas
/// rejouable (colonnes NULL d'avant les migrations 0002/0003) — même réponse
/// dans les trois cas, pour ne pas révéler l'existence des Runs d'autrui.
pub async fn run_detail(
    pool: &SqlitePool,
    run_id: &str,
    player_id: &str,
) -> Result<Option<RunDetailResponse>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, mode, mode_value, language, punctuation, numbers, keystroke_log, target_text
         FROM runs WHERE id = ? AND player_id = ?",
    )
    .bind(run_id)
    .bind(player_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let (Some(log_json), Some(target_text)) = (
        row.try_get::<Option<String>, _>("keystroke_log")?,
        row.try_get::<Option<String>, _>("target_text")?,
    ) else {
        return Ok(None);
    };
    let mode_s: String = row.try_get("mode")?;
    Ok(Some(RunDetailResponse {
        run_id: row.try_get("id")?,
        config: RunConfig {
            mode: crate::domain::types::Mode::from_db(&mode_s).unwrap_or(crate::domain::types::Mode::Words),
            mode_value: row.try_get("mode_value")?,
            language: row.try_get("language")?,
            punctuation: row.try_get::<i64, _>("punctuation")? != 0,
            numbers: row.try_get::<i64, _>("numbers")? != 0,
        },
        target_text,
        keystrokes: serde_json::from_str(&log_json).unwrap_or_default(),
    }))
}

/// Matière première du profil Weak spots : (texte cible, keystroke log) des N
/// derniers Runs analysables du joueur. Ignorés d'office : Runs sans log ou sans
/// texte (d'avant les migrations 0002/0003) et Zen (texte vide — rien à attribuer).
pub async fn recent_logs(
    pool: &SqlitePool,
    player_id: &str,
    limit: i64,
) -> Result<Vec<(String, Vec<crate::domain::types::Keystroke>)>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT target_text, keystroke_log FROM runs
         WHERE player_id = ? AND keystroke_log IS NOT NULL
           AND target_text IS NOT NULL AND target_text != ''
         ORDER BY created_at DESC LIMIT ?",
    )
    .bind(player_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let text: String = row.try_get("target_text").ok()?;
            let log_json: String = row.try_get("keystroke_log").ok()?;
            Some((text, serde_json::from_str(&log_json).unwrap_or_default()))
        })
        .collect())
}

/// Progression « Apprendre » du joueur (0 si jamais joué).
pub async fn learn_progress(pool: &SqlitePool, player_id: &str) -> Result<i64, sqlx::Error> {
    let row = sqlx::query("SELECT completed FROM learn_progress WHERE player_id = ?")
        .bind(player_id)
        .fetch_optional(pool)
        .await?;
    row.map_or(Ok(0), |r| r.try_get("completed"))
}

/// Enregistre une progression « Apprendre » et renvoie la valeur stockée.
/// Le serveur garde le MAX : une re-complétion d'une vieille leçon ne recule jamais.
pub async fn set_learn_progress(
    pool: &SqlitePool,
    player_id: &str,
    completed: i64,
    now_ms: i64,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "INSERT INTO learn_progress (player_id, completed, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE
           SET completed = MAX(completed, excluded.completed), updated_at = excluded.updated_at",
    )
    .bind(player_id)
    .bind(completed)
    .bind(now_ms)
    .execute(pool)
    .await?;
    learn_progress(pool, player_id).await
}

fn row_to_entry(row: &sqlx::sqlite::SqliteRow) -> Result<HistoryEntry, sqlx::Error> {
    let mode_s: String = row.try_get("mode")?;
    let per_second_s: String = row.try_get("per_second")?;
    let per_second: Vec<PerSecondPoint> = serde_json::from_str(&per_second_s).unwrap_or_default();

    Ok(HistoryEntry {
        run_id: row.try_get("id")?,
        created_at: row.try_get("created_at")?,
        kind: row.try_get("kind")?,
        config: RunConfig {
            mode: crate::domain::types::Mode::from_db(&mode_s).unwrap_or(crate::domain::types::Mode::Words),
            mode_value: row.try_get("mode_value")?,
            language: row.try_get("language")?,
            punctuation: row.try_get::<i64, _>("punctuation")? != 0,
            numbers: row.try_get::<i64, _>("numbers")? != 0,
        },
        wpm: row.try_get("wpm")?,
        raw: row.try_get("raw")?,
        accuracy: row.try_get("accuracy")?,
        characters: CharacterBreakdown {
            correct: row.try_get("chars_correct")?,
            incorrect: row.try_get("chars_incorrect")?,
            extra: row.try_get("chars_extra")?,
            missed: row.try_get("chars_missed")?,
        },
        duration_ms: row.try_get::<i64, _>("duration_ms")? as f64,
        per_second,
        pb_eligible: row.try_get::<i64, _>("pb_eligible")? != 0,
        replayable: row.try_get::<i64, _>("replayable")? != 0,
    })
}

// ----------------------------------------------------------------------------
//  Tests (SQLite en mémoire, 1 seule connexion pour partager la base)
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{Mode, Scoreboard};

    async fn mem_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn cfg() -> RunConfig {
        RunConfig {
            mode: Mode::Time,
            mode_value: 30,
            language: "english".into(),
            punctuation: false,
            numbers: false,
        }
    }

    fn sb(wpm: f64, pb_eligible: bool) -> Scoreboard {
        Scoreboard {
            wpm,
            raw: wpm,
            accuracy: 100.0,
            characters: CharacterBreakdown { correct: 10, incorrect: 0, extra: 0, missed: 0 },
            duration_ms: 30000.0,
            per_second: vec![PerSecondPoint { t: 1.0, wpm, raw: wpm, errors: 0, burst: wpm }],
            pb_eligible,
        }
    }

    #[tokio::test]
    async fn pb_derive_et_historique() {
        let pool = mem_pool().await;
        let c = cfg();

        // Aucun Run → pas de PB.
        assert_eq!(previous_pb(&pool, "p1", &c).await.unwrap(), None);

        insert_run(&pool, "r1", "p1", 1000, "practice", &c, &sb(50.0, true), "[]", "the cat").await.unwrap();
        insert_run(&pool, "r2", "p1", 2000, "practice", &c, &sb(70.0, true), "[]", "the cat").await.unwrap();
        // Run d'un autre joueur : ne doit pas influencer le PB de p1.
        insert_run(&pool, "r3", "p2", 3000, "practice", &c, &sb(200.0, true), "[]", "the cat").await.unwrap();

        assert_eq!(previous_pb(&pool, "p1", &c).await.unwrap(), Some(70.0));

        // Historique p1 : 2 entrées, plus récent d'abord.
        let h = history(&pool, "p1", None, None, 50).await.unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].run_id, "r2");
        assert_eq!(h[1].run_id, "r1");

        // Filtre par bucket inexistant → vide.
        let h2 = history(&pool, "p1", Some("words"), None, 50).await.unwrap();
        assert!(h2.is_empty());
    }

    #[tokio::test]
    async fn run_non_eligible_exclu_du_pb() {
        let pool = mem_pool().await;
        let c = cfg();
        insert_run(&pool, "r1", "p1", 1000, "practice", &c, &sb(999.0, false), "[]", "the cat").await.unwrap(); // non éligible
        assert_eq!(previous_pb(&pool, "p1", &c).await.unwrap(), None);
        // Mais reste dans l'historique.
        assert_eq!(history(&pool, "p1", None, None, 50).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn keystroke_log_persiste_et_kind_dans_historique() {
        let pool = mem_pool().await;
        let c = cfg();
        let log = r#"[{"t":10.0,"k":"a"}]"#;
        insert_run(&pool, "r1", "p1", 1000, "race", &c, &sb(60.0, false), log, "the cat").await.unwrap();

        // Le log brut est bien en base (relu tel quel, colonne dédiée).
        let row = sqlx::query("SELECT keystroke_log, kind FROM runs WHERE id = 'r1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.try_get::<String, _>("keystroke_log").unwrap(), log);
        assert_eq!(row.try_get::<String, _>("kind").unwrap(), "race");

        // Et le kind ressort dans l'historique.
        let h = history(&pool, "p1", None, None, 50).await.unwrap();
        assert_eq!(h[0].kind, "race");
    }

    #[tokio::test]
    async fn run_detail_pour_replay() {
        let pool = mem_pool().await;
        let c = cfg();
        let log = r#"[{"t":10.0,"k":"a"}]"#;
        insert_run(&pool, "r1", "p1", 1000, "practice", &c, &sb(60.0, true), log, "the cat")
            .await
            .unwrap();

        // Le propriétaire récupère texte cible + log typé.
        let d = run_detail(&pool, "r1", "p1").await.unwrap().unwrap();
        assert_eq!(d.target_text, "the cat");
        assert_eq!(d.keystrokes.len(), 1);
        assert_eq!(d.keystrokes[0].k, "a");
        assert!(history(&pool, "p1", None, None, 50).await.unwrap()[0].replayable);

        // Autre joueur ou Run inconnu : même réponse (pas de fuite d'existence).
        assert!(run_detail(&pool, "r1", "p2").await.unwrap().is_none());
        assert!(run_detail(&pool, "zzz", "p1").await.unwrap().is_none());

        // Vieux Run d'avant la migration 0003 : non rejouable, masqué dans l'historique.
        sqlx::query("UPDATE runs SET target_text = NULL WHERE id = 'r1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(run_detail(&pool, "r1", "p1").await.unwrap().is_none());
        assert!(!history(&pool, "p1", None, None, 50).await.unwrap()[0].replayable);
    }

    #[tokio::test]
    async fn learn_progress_par_joueur_max_seulement() {
        let pool = mem_pool().await;

        // Jamais joué → 0.
        assert_eq!(learn_progress(&pool, "p1").await.unwrap(), 0);

        assert_eq!(set_learn_progress(&pool, "p1", 2, 1000).await.unwrap(), 2);
        // Re-complétion d'une vieille leçon : jamais de recul.
        assert_eq!(set_learn_progress(&pool, "p1", 1, 2000).await.unwrap(), 2);
        assert_eq!(set_learn_progress(&pool, "p1", 3, 3000).await.unwrap(), 3);

        // Isolé par joueur.
        assert_eq!(learn_progress(&pool, "p2").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn recent_logs_filtre_les_runs_inanalysables() {
        let pool = mem_pool().await;
        let c = cfg();
        let log = r#"[{"t":10.0,"k":"a"}]"#;
        insert_run(&pool, "r1", "p1", 1000, "practice", &c, &sb(60.0, true), log, "the cat").await.unwrap();
        insert_run(&pool, "r2", "p1", 2000, "practice", &c, &sb(60.0, true), log, "").await.unwrap(); // Zen
        insert_run(&pool, "r3", "p2", 3000, "practice", &c, &sb(60.0, true), log, "abc").await.unwrap(); // autre joueur
        sqlx::query("UPDATE runs SET keystroke_log = NULL WHERE id = 'r1'").execute(&pool).await.unwrap();
        insert_run(&pool, "r4", "p1", 4000, "practice", &c, &sb(60.0, true), log, "dog run").await.unwrap();

        // Seul r4 est analysable pour p1 : r1 sans log, r2 texte vide, r3 à p2.
        let logs = recent_logs(&pool, "p1", 20).await.unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].0, "dog run");
        assert_eq!(logs[0].1.len(), 1);
    }
}
