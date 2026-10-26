-- Vérification de la migration 0004 (lecture seule : ne modifie rien).
--
-- À lancer dans le SQL Editor de Supabase, avant ET après la migration.
-- Une ligne par contrôle, avec le résultat attendu APRÈS la migration :
--   colonne last_triaged_on      -> date
--   RLS activée sur tasks        -> oui
--   politique own tasks          -> ALL, user_id = auth.uid()
--   tâches à reprendre           -> un nombre (0 ou plus), sans le texte des tâches
-- Avant la migration, la première ligne affiche « absente » : c'est normal.

select 'colonne last_triaged_on' as controle,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks'
                   and column_name = 'last_triaged_on'), 'absente') as resultat

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
-- Même règle que l'app (date locale du fuseau enregistré dans les réglages,
-- Europe/Paris par défaut). Ne lit pas la colonne, pour marcher aussi avant
-- la migration : c'est le nombre de tâches proposées au premier passage.
select 'tâches à reprendre (avant tout Récupérer)',
       count(*)::text
from tasks t
left join user_settings s on s.user_id = t.user_id
where t.done = false
  and t.important is not null
  and (t.created_at at time zone coalesce(s.timezone, 'Europe/Paris'))::date
      < (now() at time zone coalesce(s.timezone, 'Europe/Paris'))::date;
