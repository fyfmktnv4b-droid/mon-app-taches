-- Vérification de la migration 0006 (lecture seule : ne modifie rien).
--
-- À lancer dans le SQL Editor de Supabase, avant ET après la migration.
-- Une ligne par contrôle, avec le résultat attendu APRÈS la migration :
--   colonne weekly_review_enabled         -> boolean, NON NULL, défaut true
--   colonne last_weekly_review_sent_date  -> date, nullable, sans défaut
--   RLS activée sur user_settings         -> oui
--   politique own settings                -> ALL, user_id = auth.uid()
--   comptes avec l'interrupteur coupé     -> 0 juste après la migration
--   fuseau <nom>                          -> nombre de comptes par fuseau
-- Avant la migration, les deux colonnes affichent « absente » et le compte
-- « colonne absente » : c'est normal.

select 'colonne weekly_review_enabled' as controle,
       coalesce((select data_type
                        || case when is_nullable = 'YES' then ', nullable' else ', NON NULL' end
                        || case when column_default is null then ', sans défaut'
                                else ', défaut ' || column_default end
                 from information_schema.columns
                 where table_schema = 'public' and table_name = 'user_settings'
                   and column_name = 'weekly_review_enabled'), 'absente') as resultat

union all
select 'colonne last_weekly_review_sent_date',
       coalesce((select data_type
                        || case when is_nullable = 'YES' then ', nullable' else ', NON NULL' end
                        || case when column_default is null then ', sans défaut'
                                else ', défaut ' || column_default end
                 from information_schema.columns
                 where table_schema = 'public' and table_name = 'user_settings'
                   and column_name = 'last_weekly_review_sent_date'), 'absente')

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
-- migration (une référence directe à s.weekly_review_enabled échouerait).
select 'comptes avec l''interrupteur coupé',
       case when not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'user_settings'
                               and column_name = 'weekly_review_enabled')
            then 'colonne absente'
            else (select count(*)::text from user_settings s
                  where to_jsonb(s) ->> 'weekly_review_enabled' = 'false')
       end

union all
select 'fuseau ' || timezone, count(*)::text
from user_settings
group by timezone;
