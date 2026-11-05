-- Mon App Tâches — migration 0006 : notification du dimanche
--
-- Ajoute à user_settings :
--   - weekly_review_enabled : l'interrupteur « Bilan du dimanche » des Réglages,
--     activé par défaut (lignes existantes comprises) ;
--   - last_weekly_review_sent_date : la date LOCALE du dernier envoi, réclamée
--     avant l'envoi par send-reminders : un seul envoi par dimanche.
--
-- Idempotente : la relancer ne change rien.
-- La politique RLS « own settings » porte sur la ligne entière : elle couvre
-- ces colonnes sans rien ajouter. Le trigger d'inscription n'insère que
-- user_id : les nouveaux comptes reçoivent les valeurs par défaut.
--
-- ORDRE : à appliquer et vérifier AVANT la fonction send-reminders et AVANT
-- l'app v41. Sans ces colonnes, l'écran Réglages de l'app v41 ne s'affiche pas ;
-- la fonction, elle, n'envoie simplement pas la notification du dimanche.
-- Retour en arrière : supabase/rollback/0006_rollback.sql
-- Vérification : supabase/checks/0006_verify.sql (avant ET après)

begin;

alter table user_settings
  add column if not exists weekly_review_enabled boolean not null default true,
  add column if not exists last_weekly_review_sent_date date;

comment on column user_settings.weekly_review_enabled is
  'Interrupteur « Bilan du dimanche » (activé par défaut).';
comment on column user_settings.last_weekly_review_sent_date is
  'Date LOCALE du dernier envoi : un seul envoi par dimanche.';

commit;
