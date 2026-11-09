-- Vérification de la migration 0007 (lecture seule : ne modifie rien).
--
-- À lancer dans le SQL Editor de Supabase, avant ET après la migration.
-- Une ligne par contrôle, avec le résultat attendu APRÈS la migration :
--   colonne weekly_review_time               -> time without time zone, nullable, sans défaut
--   même type que morning_reminder_time      -> oui
--   contrainte user_settings_weekly_review_time_range
--     -> CHECK (((weekly_review_time IS NULL) OR ((weekly_review_time >= '20:00:00'::time without time zone)
--        AND (weekly_review_time <= '23:00:00'::time without time zone))))
--   RLS activée sur user_settings            -> oui
--   politique own settings                   -> ALL, user_id = auth.uid()
--   comptes avec une heure du bilan choisie  -> 0 juste après la migration
--   comptes avec une heure hors plage        -> 0
--   fuseau <nom>                             -> nombre de comptes par fuseau
-- Avant la migration, la colonne et la contrainte affichent « absente » et
-- les comptes « colonne absente » : c'est normal.

select 'colonne weekly_review_time' as controle,
       coalesce((select data_type
                        || case when is_nullable = 'YES' then ', nullable' else ', NON NULL' end
                        || case when column_default is null then ', sans défaut'
                                else ', défaut ' || column_default end
                 from information_schema.columns
                 where table_schema = 'public' and table_name = 'user_settings'
                   and column_name = 'weekly_review_time'), 'absente') as resultat

union all
select 'même type que morning_reminder_time',
       case when not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'user_settings'
                               and column_name = 'weekly_review_time')
            then 'colonne absente'
            when (select data_type from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_settings'
                    and column_name = 'weekly_review_time')
               = (select data_type from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_settings'
                    and column_name = 'morning_reminder_time')
            then 'oui' else 'NON' end

union all
select 'contrainte user_settings_weekly_review_time_range',
       coalesce((select pg_get_constraintdef(oid) from pg_constraint
                 where conrelid = 'public.user_settings'::regclass
                   and conname = 'user_settings_weekly_review_time_range'), 'absente')

union all
select 'RLS activée sur user_settings',
       case when relrowsecurity then 'oui' else 'NON' end
from pg_class
where oid = 'public.user_settings'::regclass

union all
select 'politique ' || policyname,
       cmd || ', ' || coalesce(qual, '(aucune condition)')
from pg_policies
where schemaname = 'public' and tablename = 'user_settings'

union all
-- Lit la colonne via to_jsonb(s) pour que la requête reste valide avant la
-- migration (une référence directe à s.weekly_review_time échouerait).
select 'comptes avec une heure du bilan choisie',
       case when not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'user_settings'
                               and column_name = 'weekly_review_time')
            then 'colonne absente'
            else (select count(*)::text from user_settings s
                  where to_jsonb(s) ->> 'weekly_review_time' is not null)
       end

union all
select 'comptes avec une heure hors plage',
       case when not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'user_settings'
                               and column_name = 'weekly_review_time')
            then 'colonne absente'
            else (select count(*)::text from user_settings s
                  where (to_jsonb(s) ->> 'weekly_review_time')::time
                        not between time '20:00' and time '23:00')
       end

union all
select 'fuseau ' || timezone, count(*)::text
from user_settings
group by timezone;
