-- Les Quotes ne sont plus PB-eligible (issue #14, ADR 0003) : leur longueur varie
-- Run à Run sans que le Config bucket le capture, rendant les comparaisons invalides.
-- Backfill des Runs déjà persistés — l'Historique et le Replay restent inchangés.
UPDATE runs SET pb_eligible = 0 WHERE mode = 'quotes';
