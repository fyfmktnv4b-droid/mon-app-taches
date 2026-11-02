-- Vérification de la migration 0005 (lecture seule : ne modifie rien).
--
-- À lancer dans le SQL Editor de Supabase, avant ET après la migration.
-- Une ligne par contrôle, avec le résultat attendu APRÈS la migration :
--   colonne important_since           -> date, nullable, sans défaut
--   RLS activée sur tasks             -> oui
--   politique own tasks               -> ALL, user_id = auth.uid()
--   tâches Important sans date        -> 0 (un nombre, sans le texte des tâches)
-- Avant la migration, la première ligne affiche « absente » et la dernière
-- « colonne absente » : c'est normal.

select 'colonne important_since' as controle,
       coalesce((select data_type
                        || case when is_nullable = 'YES' then ', nullable' else ', NON NULL' end
                        || case when column_default is null then ', sans défaut'
                                else ', défaut ' || column_default end
                 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks'
                   and column_name = 'important_since'), 'absente') as resultat

union all
select 'RLS activée sur tasks',
       case when relrowsecurity then 'oui' else 'NON' end
from pg_class
where oid = 'public.tasks'::regclass

union all
select 'politique ' || policyname,
       cmd || ', ' || coalesce(qual, '(aucune condition)')
from pg_policies
where schemaname = 'public' and tablename = 'tasks'

union all
-- Lit la colonne via to_jsonb(t) pour que la requête reste valide avant la
-- migration (une référence directe à t.important_since échouerait).
select 'tâches Important non terminées sans date',
       case when not exists (select 1 from information_schema.columns
                             where table_schema = 'public' and table_name = 'tasks'
                               and column_name = 'important_since')
            then 'colonne absente'
            else (select count(*)::text from tasks t
                  where t.important = true and t.done = false
                    and to_jsonb(t) ->> 'important_since' is null)
       end;
