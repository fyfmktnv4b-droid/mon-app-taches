-- Lecture seule : ne modifie rien.
--
-- Compte les tâches terminées (done = true) qui n'ont pas de date de
-- validation (completed_at vide). Depuis la version v26 de l'app, elles
-- s'affichent dans l'Historique au lieu de rester indéfiniment dans
-- « Terminé ». L'app écrit toujours les deux ensemble : seule une
-- modification faite à la main en base peut en créer. Résultat attendu : 0.

select count(*) as taches_terminees_sans_date
from tasks
where done = true
  and completed_at is null;
