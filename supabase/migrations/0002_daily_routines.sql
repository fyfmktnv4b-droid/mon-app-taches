-- Mon App Tâches — migration 0002 : routine quotidienne
--
-- Une ligne par utilisateur et par jour, les cases dans un seul jsonb.
-- La date est la date LOCALE de l'appareil (voir localDate.js), pas une date
-- UTC : entre minuit et 2h du matin les deux diffèrent, et c'est la locale
-- qui correspond à « ma journée ».

-- ---------------------------------------------------------------------------
-- daily_routines
-- ---------------------------------------------------------------------------

create table daily_routines (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),  -- géré par trigger, jamais par le client
  primary key (user_id, local_date)
);

alter table daily_routines enable row level security;

-- Même politique que tasks : chacun ne voit et n'écrit que ses propres lignes.
create policy "own routines" on daily_routines
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- set_updated_at() est déjà défini par la migration 0001.
create trigger daily_routines_set_updated_at
before update on daily_routines
for each row
execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- set_routine_check : écrire UNE case, jamais la ligne entière
-- ---------------------------------------------------------------------------
--
-- Pourquoi une fonction plutôt qu'un upsert depuis le client : un upsert
-- enverrait tout l'objet `checks`, donc l'iPhone qui coche « meditate »
-- écraserait le « pray » que le Mac vient de cocher. Ici l'opérateur `||` ne
-- remplace que la clé passée en paramètre, et les deux coches survivent sans
-- aucune logique de fusion côté client.
--
-- Deux points de sécurité, volontaires :
--
--   1. L'utilisateur n'est JAMAIS un paramètre : il est pris sur le jeton de
--      la session via auth.uid(). Le client ne peut donc pas écrire pour
--      quelqu'un d'autre, même en falsifiant son appel.
--
--   2. security invoker (le défaut de PostgreSQL, écrit ici explicitement pour
--      que ce soit lisible) : la fonction s'exécute avec les droits de
--      l'appelant, donc les policies RLS de daily_routines s'appliquent
--      normalement par-dessus. En security definer elle tournerait avec les
--      droits du propriétaire du projet et court-circuiterait l'isolation
--      entre utilisateurs — exactement ce qu'on ne veut pas ici.
--
-- Idempotente : rejouer deux fois la même coche donne le même résultat, ce qui
-- rend sûr le rejeu de la file de mutations au retour du réseau.

create function set_routine_check(
  p_local_date date,
  p_key text,
  p_value boolean
)
returns daily_routines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row daily_routines;
begin
  if v_user_id is null then
    raise exception 'session absente ou expirée';
  end if;

  -- Liste blanche : même ensemble que CHECK_KEYS dans routineLogic.js. Toute
  -- clé ajoutée d'un côté doit l'être de l'autre.
  if p_key not in ('wake', 'wash', 'meditate', 'pray', 'gym', 'steps', 'skipped') then
    raise exception 'clé de routine inconnue: %', p_key;
  end if;

  if p_value is null then
    raise exception 'valeur de routine manquante';
  end if;

  insert into daily_routines (user_id, local_date, checks)
  values (v_user_id, p_local_date, jsonb_build_object(p_key, p_value))
  on conflict (user_id, local_date)
  do update set checks = daily_routines.checks || jsonb_build_object(p_key, p_value)
  returning * into v_row;

  return v_row;
end;
$$;

-- PostgreSQL accorde EXECUTE à PUBLIC par défaut, ce qui inclut le rôle anon.
-- Un appel anonyme échouerait de toute façon (auth.uid() est null), mais autant
-- ne pas exposer la fonction du tout.
revoke execute on function set_routine_check(date, text, boolean) from public;
grant execute on function set_routine_check(date, text, boolean) to authenticated;
