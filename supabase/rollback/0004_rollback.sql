-- Retour en arrière de supabase/migrations/0004_last_triaged_on.sql
--
-- Supprime la colonne tasks.last_triaged_on et son contenu (les dates de
-- « Récupérer »). Les tâches elles-mêmes ne sont pas touchées.
-- « if exists » : sans danger si la colonne n'existe pas ou si le script est
-- lancé deux fois.
-- ATTENTION : à ne lancer qu'après avoir remis en ligne une version de l'app
-- qui n'écrit pas cette colonne ; sinon ses écritures seraient refusées et
-- bloqueraient la file hors-ligne.
-- Rangé hors de supabase/migrations/ pour qu'aucun outil ne l'applique
-- automatiquement.

alter table tasks drop column if exists last_triaged_on;
