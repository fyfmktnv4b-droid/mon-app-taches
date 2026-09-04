-- Mon App Tâches — schéma initial
-- Tables, policies RLS et triggers. Voir docs/superpowers/specs/2026-09-04-mon-app-taches-design.md

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  urgent boolean,              -- null = pas encore trié
  important boolean,           -- null = pas encore trié
  done boolean not null default false,
  reminder_time time,          -- rappel ponctuel optionnel, remis à null après envoi
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()  -- géré par trigger, jamais par le client
);

alter table tasks enable row level security;

create policy "own tasks" on tasks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_set_updated_at
before update on tasks
for each row
execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  morning_reminder_time time,
  notifications_enabled boolean not null default false,
  timezone text not null default 'Europe/Paris',
  last_morning_reminder_sent_date date
);

alter table user_settings enable row level security;

create policy "own settings" on user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Crée automatiquement une ligne user_settings à l'inscription, pour
-- garantir qu'elle existe toujours (le fuseau horaire notamment est
-- nécessaire au calcul des rappels par l'Edge Function).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  device_label text,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "own subscriptions" on push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
