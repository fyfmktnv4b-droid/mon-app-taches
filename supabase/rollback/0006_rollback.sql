-- Retour en arrière de supabase/migrations/0006_weekly_review.sql
--
-- Supprime les colonnes user_settings.weekly_review_enabled et
-- last_weekly_review_sent_date, et leur contenu (les choix de l'interrupteur,
-- les dates d'envoi). Les autres réglages ne sont pas touchés.
-- « if exists » : sans danger si les colonnes n'existent pas ou si le script
-- est lancé deux fois.
-- ATTENTION : à ne lancer qu'après avoir remis en ligne une version de l'app
-- qui ne lit pas ces colonnes (v40 ou avant) ; sinon l'écran Réglages ne
-- s'affiche plus. La fonction send-reminders, elle, continue ses autres
-- rappels sans ces colonnes.
-- Rangé hors de supabase/migrations/ pour qu'aucun outil ne l'applique
-- automatiquement.

alter table user_settings
  drop column if exists weekly_review_enabled,
  drop column if exists last_weekly_review_sent_date;
