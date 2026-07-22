-- Solo perd son décompte de 3 s (issue #22, ADR 0004) : t=0 passe de la fin du
-- décompte à la 1re frappe, le temps de réaction sort du calcul de durée. Ce n'est
-- pas un changement d'interface mais d'unité de mesure : les WPM déjà enregistrés
-- ne sont plus comparables aux nouveaux. Backfill des Runs déjà persistés (Race est
-- déjà exclue des PB — seuls Time/Words en solo étaient pb_eligible) — l'Historique
-- et le Replay restent inchangés, seule l'éligibilité PB est corrigée.
UPDATE runs SET pb_eligible = 0 WHERE pb_eligible = 1;
