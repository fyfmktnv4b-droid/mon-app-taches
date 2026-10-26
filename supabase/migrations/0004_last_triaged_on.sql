-- Mon App Tâches — migration 0004 : écran « À reprendre aujourd'hui »
--
-- Ajoute tasks.last_triaged_on : la date LOCALE (de l'appareil) du jour où
-- une tâche en retard a été « Récupérée ». Tant qu'elle vaut aujourd'hui, la
-- tâche n'est plus reproposée aujourd'hui ; dès le lendemain, si elle n'est
-- pas terminée, elle l'est de nouveau. Servira aussi au bilan du dimanche.
--
-- Idempotente (« if not exists ») : la relancer ne fait rien.
-- Aucune donnée existante n'est modifiée : la colonne vaut null partout.
-- La politique RLS « own tasks » porte sur la ligne entière : elle couvre
-- cette colonne sans rien ajouter.
-- Retour en arrière : supabase/rollback/0004_rollback.sql
-- Vérification : supabase/checks/0004_verify.sql

alter table tasks add column if not exists last_triaged_on date;

comment on column tasks.last_triaged_on is
  'Date locale du dernier « Récupérer » sur l''écran À reprendre aujourd''hui (null = jamais).';
