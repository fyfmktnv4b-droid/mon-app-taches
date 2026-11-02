-- Retour en arrière de supabase/migrations/0005_important_since.sql
--
-- Supprime la colonne tasks.important_since et son contenu (les jours
-- d'entrée dans Important, y compris le rattrapage). Les tâches elles-mêmes
-- ne sont pas touchées.
-- « if exists » : sans danger si la colonne n'existe pas ou si le script est
-- lancé deux fois.
-- ATTENTION : à ne lancer qu'après avoir remis en ligne une version de l'app
-- qui n'écrit pas cette colonne (v37 ou avant) ; sinon chaque classement
-- serait refusé et bloquerait la file hors-ligne.
-- Rangé hors de supabase/migrations/ pour qu'aucun outil ne l'applique
-- automatiquement.

alter table tasks drop column if exists important_since;
