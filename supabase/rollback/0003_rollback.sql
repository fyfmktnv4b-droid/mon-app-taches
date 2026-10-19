-- Retour en arrière de supabase/migrations/0003_data_constraints.sql
--
-- Supprime uniquement les contraintes ajoutées par 0003 ; aucune donnée
-- n'est touchée. « if exists » : sans danger même si la migration n'a été
-- appliquée qu'en partie, ou si ce script est lancé deux fois.
-- Rangé hors de supabase/migrations/ pour qu'aucun outil ne l'applique
-- automatiquement.

begin;

alter table tasks drop constraint if exists tasks_text_length;
alter table user_settings drop constraint if exists user_settings_timezone_format;
alter table push_subscriptions drop constraint if exists push_subscriptions_endpoint_host;
alter table push_subscriptions drop constraint if exists push_subscriptions_keys_length;
alter table daily_routines drop constraint if exists daily_routines_checks_shape;

commit;
