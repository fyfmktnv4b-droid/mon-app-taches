-- Mon App Tâches — migration 0007 : heure de la notification du dimanche
--
-- Ajoute à user_settings :
--   - weekly_review_time : l'heure « Heure du bilan » des Réglages, même type
--     que morning_reminder_time (time, nullable, sans défaut). NULL = 20:00.
--   - une contrainte : NULL, ou entre 20:00 et 23:00 (bornes comprises).
--     Mêmes bornes dans l'app (settingsLogic.js) et dans send-reminders
--     (reminderLogic.js) : les tests le vérifient.
--
-- Idempotente : la relancer ne change rien.
-- La politique RLS « own settings » porte sur la ligne entière : elle couvre
-- cette colonne sans rien ajouter. Les lignes existantes restent à NULL :
-- aucun changement de comportement (20:00).
--
-- ORDRE : à appliquer et vérifier AVANT la fonction send-reminders et AVANT
-- l'app v42. Sans cette colonne, l'écran Réglages de l'app v42 ne s'affiche
-- pas ; la fonction, elle, envoie le bilan à 20:00 comme avant.
-- Retour en arrière : supabase/rollback/0007_rollback.sql
-- Vérification : supabase/checks/0007_verify.sql (avant ET après)

begin;

alter table user_settings
  add column if not exists weekly_review_time time;

alter table user_settings
  drop constraint if exists user_settings_weekly_review_time_range;
alter table user_settings
  add constraint user_settings_weekly_review_time_range
  check (weekly_review_time is null
         or weekly_review_time between time '20:00' and time '23:00');

comment on column user_settings.weekly_review_time is
  'Heure locale de la notification du dimanche, entre 20:00 et 23:00. NULL = 20:00.';

commit;
