-- Progression du cursus « Apprendre » (issue #4) : une ligne par Player.
-- `completed` = nombre de leçons complétées ; la leçon d'index N (0-based) est
-- débloquée si N <= completed. Les exercices de leçon ne sont PAS des Runs :
-- rien dans `runs`, ni PB ni historique.
CREATE TABLE IF NOT EXISTS learn_progress (
  player_id  TEXT PRIMARY KEY,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
