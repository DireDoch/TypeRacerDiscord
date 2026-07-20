-- Persistance du texte cible verbatim (Replay depuis l'Historique).
-- Voir Docs/adr/0001-persist-target-text-verbatim.md : on stocke le texte tel que
-- tapé (les Quotes ne sont pas régénérables depuis un seed ; l'algo de génération
-- peut évoluer). NULL pour les Runs d'avant cette migration → non rejouables.

ALTER TABLE runs ADD COLUMN target_text TEXT;
