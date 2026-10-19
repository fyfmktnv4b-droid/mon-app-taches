-- Vérification AVANT la migration 0003 (lecture seule : ne modifie rien).
--
-- À lancer dans le SQL Editor de Supabase. Résultat attendu : « No rows
-- returned » (aucune ligne). Chaque ligne renvoyée est une donnée actuelle
-- qui ferait échouer la migration, avec la contrainte concernée et un
-- détail (longueur, valeur ou hôte), sans afficher le contenu des tâches.

select 'tasks_text_length' as contrainte, id::text as ligne,
       'titre de ' || char_length(text) || ' caractères (max 1000)' as detail
from tasks
where not (char_length(text) <= 1000)

union all
select 'user_settings_timezone_format', user_id::text,
       'fuseau : ' || timezone
from user_settings
where not (
  char_length(timezone) <= 64
  and timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
)

union all
select 'push_subscriptions_endpoint_host', id::text,
       'hôte : ' || coalesce(substring(endpoint from '^[a-z]+://[^/]+'), left(endpoint, 60))
from push_subscriptions
where not (
  char_length(endpoint) <= 2048
  and endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
)

union all
select 'push_subscriptions_keys_length', id::text,
       'clés de ' || char_length(p256dh) || ' / ' || char_length(auth_key) || ' caractères (max 256)'
from push_subscriptions
where not (char_length(p256dh) <= 256 and char_length(auth_key) <= 256)

union all
select 'daily_routines_checks_shape', user_id::text || ' ' || local_date::text,
       'cases : ' || checks::text
from daily_routines
where not (
  jsonb_typeof(checks) = 'object'
  and (checks - array['wake', 'wash', 'meditate', 'pray', 'gym', 'steps', 'skipped']) = '{}'::jsonb
  and not jsonb_path_exists(checks, '$.* ? (@.type() != "boolean")')
);
