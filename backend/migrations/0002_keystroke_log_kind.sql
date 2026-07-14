-- Persistance du keystroke log (features replay/analyse à venir) + provenance du Run.
-- `keystroke_log` : JSON [{t,k,ctrl?}], NULL pour les Runs d'avant cette migration.
-- `kind` : 'practice' | 'race' — les Races entrent dans l'historique (pb_eligible = 0).

ALTER TABLE runs ADD COLUMN keystroke_log TEXT;
ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice';
