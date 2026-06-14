-- TypeRacerDiscord — schéma initial.
-- Table UNIQUE `runs`. Le PB n'a pas de table : dérivé par MAX(wpm) GROUP BY bucket.

CREATE TABLE IF NOT EXISTS runs (
    id            TEXT    PRIMARY KEY,          -- identifiant de Run (ex. ULID)
    player_id     TEXT    NOT NULL,             -- Discord snowflake, TOUJOURS en TEXT
    created_at    INTEGER NOT NULL,             -- epoch-ms

    -- Config bucket --------------------------------------------------------
    mode          TEXT    NOT NULL,             -- 'time' | 'words' | 'quotes' | 'zen'
    mode_value    INTEGER NOT NULL,             -- secondes | nb mots | 0 (quotes/zen)
    language      TEXT    NOT NULL DEFAULT 'english',
    punctuation   INTEGER NOT NULL DEFAULT 0,   -- 0/1
    numbers       INTEGER NOT NULL DEFAULT 0,   -- 0/1

    -- Scoreboard autoritaire ----------------------------------------------
    wpm           REAL    NOT NULL,
    raw           REAL    NOT NULL,
    accuracy      REAL    NOT NULL,             -- pourcentage 0–100
    chars_correct   INTEGER NOT NULL,
    chars_incorrect INTEGER NOT NULL,
    chars_extra     INTEGER NOT NULL,
    chars_missed    INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL,

    per_second    TEXT    NOT NULL,             -- JSON [{t,wpm,raw,errors,burst}]
    pb_eligible   INTEGER NOT NULL DEFAULT 1    -- 0 pour Zen et Time infini
);

-- Dérivation du PB et de l'historique filtré par bucket.
CREATE INDEX IF NOT EXISTS idx_runs_pb
    ON runs (player_id, mode, mode_value, language, punctuation, numbers, wpm);

-- Historique récent par joueur.
CREATE INDEX IF NOT EXISTS idx_runs_history
    ON runs (player_id, created_at);
