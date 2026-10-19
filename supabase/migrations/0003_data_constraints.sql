-- Mon App Tâches — migration 0003 : contraintes sur les données saisies
--
-- Contexte : rapport de sécurité du 2026-10-19 (points 2, 3 et 7).
-- AVANT de lancer ce fichier : exécuter supabase/checks/0003_verify.sql, qui
-- doit ne renvoyer AUCUNE ligne. Retour en arrière :
-- supabase/rollback/0003_rollback.sql.
--
-- Tout est dans une transaction : si une seule contrainte échoue (donnée
-- existante non conforme), rien n'est appliqué.

begin;

-- Point 7 — titre de tâche : 1000 caractères maximum. Même limite côté app
-- (MAX_TASK_LENGTH dans syncLogic.js), vérifiée AVANT l'envoi : une création
-- refusée ici bloquerait sinon la file de synchronisation hors-ligne.
alter table tasks
  add constraint tasks_text_length
  check (char_length(text) <= 1000);

-- Point 3 — fuseau horaire : forme « Région/Ville » (ou « UTC »), 64
-- caractères max. Une contrainte ne peut pas consulter la liste des fuseaux
-- connus ; un nom bien formé mais inexistant reste possible, et c'est le
-- try/catch par utilisateur de send-reminders qui l'absorbe.
alter table user_settings
  add constraint user_settings_timezone_format
  check (
    char_length(timezone) <= 64
    and timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
  );

-- Point 2 — abonnements push : uniquement vers les services push des
-- navigateurs (Chrome/Android, Safari/iPhone, Firefox, Edge/Windows), pour
-- que send-reminders, qui tourne avec les droits serveur, ne puisse pas être
-- utilisé pour contacter une adresse arbitraire. Un nouveau navigateur avec
-- un autre service push demandera d'élargir cette liste.
alter table push_subscriptions
  add constraint push_subscriptions_endpoint_host
  check (
    char_length(endpoint) <= 2048
    and endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
  ),
  add constraint push_subscriptions_keys_length
  check (char_length(p256dh) <= 256 and char_length(auth_key) <= 256);

-- Point 7 — routine : un objet JSON dont les clés sont dans la même liste
-- blanche que set_routine_check (et CHECK_KEYS dans routineLogic.js) et dont
-- les valeurs sont des booléens. Ferme la porte d'une écriture directe dans
-- la table qui contournerait la fonction.
alter table daily_routines
  add constraint daily_routines_checks_shape
  check (
    jsonb_typeof(checks) = 'object'
    and (checks - array['wake', 'wash', 'meditate', 'pray', 'gym', 'steps', 'skipped']) = '{}'::jsonb
    and not jsonb_path_exists(checks, '$.* ? (@.type() != "boolean")')
  );

commit;
