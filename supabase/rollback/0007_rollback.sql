-- Retour en arrière de supabase/migrations/0007_weekly_review_time.sql
--
-- Supprime la contrainte et la colonne user_settings.weekly_review_time, avec
-- leur contenu (les heures choisies). Les autres réglages ne sont pas touchés.
-- « if exists » : sans danger si rien n'existe ou si le script est lancé
-- deux fois.
-- ATTENTION : à ne lancer qu'après avoir remis en ligne une version de l'app
-- qui ne lit pas cette colonne (v41 ou avant) ; sinon l'écran Réglages ne
-- s'affiche plus. La fonction send-reminders v42, elle, repasse à 20:00.
-- Rangé hors de supabase/migrations/ pour qu'aucun outil ne l'applique
-- automatiquement.

begin;

alter table user_settings
  drop constraint if exists user_settings_weekly_review_time_range;
alter table user_settings
  drop column if exists weekly_review_time;

commit;
