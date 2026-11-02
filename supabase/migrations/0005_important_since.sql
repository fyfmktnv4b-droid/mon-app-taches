-- Mon App Tâches — migration 0005 : jour d'entrée dans « Important »
--
-- Ajoute tasks.important_since : la date LOCALE (de l'appareil) du jour où la
-- tâche est ENTRÉE dans Important (depuis « À trier » ou « Autres »). Servira
-- au bilan de la semaine : une tâche Important validée ce jour-là est « dans
-- les temps », plus tard « avec retard ». Les tâches Autres n'ont jamais de
-- retard et gardent null.
--
-- Règles tenues par l'app (syncLogic.js, importanceFields) :
--   - entrée dans Important        -> date locale du jour ;
--   - sortie vers Autres / À trier -> null ;
--   - reste Important (Récupérer, Valider, Annuler la validation) -> inchangée.
--
-- Idempotente : la colonne n'est ajoutée qu'une fois, et le rattrapage ne
-- touche que les lignes encore sans date. La relancer ne change rien.
-- La politique RLS « own tasks » porte sur la ligne entière : elle couvre
-- cette colonne sans rien ajouter.
--
-- ORDRE : cette migration doit être appliquée ET vérifiée AVANT la mise en
-- ligne de l'app v38, qui écrit la colonne : sinon chaque classement serait
-- refusé et bloquerait la file hors-ligne.
-- Retour en arrière : supabase/rollback/0005_rollback.sql
-- Vérification : supabase/checks/0005_verify.sql (avant ET après)

begin;

alter table tasks add column if not exists important_since date;

comment on column tasks.important_since is
  'Date locale du jour où la tâche est entrée dans Important (null = pas Important).';

-- Rattrapage — APPROXIMATION ASSUMÉE : pour les tâches déjà Important et non
-- terminées, le vrai jour d'entrée dans Important n'est pas connu (updated_at
-- n'est pas fiable : n'importe quelle modification le change). On prend la
-- date locale (Europe/Paris) de création, c'est-à-dire le jour le plus tôt
-- possible : ces tâches pourront donc paraître « avec retard » un peu trop
-- vite dans le premier bilan.
-- Les tâches terminées et les tâches Autres restent à null.
-- « important_since is null » : une relance ne touche pas une date déjà écrite
-- (par ce script ou par l'app v38).
update tasks
set important_since = (created_at at time zone 'Europe/Paris')::date
where important = true
  and done = false
  and important_since is null;

commit;
