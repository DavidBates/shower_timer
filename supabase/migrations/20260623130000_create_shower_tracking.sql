create extension if not exists pgcrypto;

create table if not exists public.workgroups (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null unique check (sort_order > 0),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shower_timers (
  id uuid primary key default gen_random_uuid(),
  card_number integer not null unique check (card_number > 0),
  label text not null default 'Available',
  workgroup_id uuid references public.workgroups(id) on delete set null,
  participant_type text check (participant_type in ('boy', 'girl', 'adult_chaperone')),
  duration_seconds integer not null default 360 check (duration_seconds between 60 and 3600),
  remaining_seconds integer not null default 360 check (remaining_seconds >= 0),
  running boolean not null default false,
  started_at timestamptz,
  active_session_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shower_sessions (
  id uuid primary key default gen_random_uuid(),
  timer_id uuid references public.shower_timers(id) on delete set null,
  card_number integer not null check (card_number > 0),
  workgroup_id uuid not null references public.workgroups(id) on delete restrict,
  participant_type text not null check (participant_type in ('boy', 'girl', 'adult_chaperone')),
  duration_seconds integer not null default 360 check (duration_seconds between 60 and 3600),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'replaced', 'cleared')),
  created_at timestamptz not null default now()
);

create index if not exists shower_timers_workgroup_id_idx on public.shower_timers(workgroup_id);
create index if not exists shower_timers_active_session_id_idx on public.shower_timers(active_session_id);
create index if not exists shower_sessions_timer_id_idx on public.shower_sessions(timer_id);
create index if not exists shower_sessions_workgroup_id_idx on public.shower_sessions(workgroup_id);
create index if not exists shower_sessions_status_idx on public.shower_sessions(status);
create index if not exists shower_sessions_started_at_idx on public.shower_sessions(started_at desc);

insert into public.workgroups (sort_order, name)
select n, 'Workgroup ' || n
from generate_series(1, 26) as n
on conflict (sort_order) do nothing;

insert into public.shower_timers (card_number, label, duration_seconds, remaining_seconds, sort_order)
select n, 'Available', 360, 360, n
from generate_series(1, 6) as n
on conflict (card_number) do nothing;

alter table public.workgroups enable row level security;
alter table public.shower_timers enable row level security;
alter table public.shower_sessions enable row level security;

grant usage on schema public to anon, authenticated;
grant select, update on public.workgroups to anon, authenticated;
grant select, insert, update, delete on public.shower_timers to anon, authenticated;
grant select, insert, update on public.shower_sessions to anon, authenticated;

create policy "Anyone with the link can read workgroups"
  on public.workgroups for select
  to anon, authenticated
  using (true);

create policy "Anyone with the link can rename workgroups"
  on public.workgroups for update
  to anon, authenticated
  using (id is not null)
  with check (sort_order > 0 and length(trim(name)) > 0);

create policy "Anyone with the link can read timers"
  on public.shower_timers for select
  to anon, authenticated
  using (true);

create policy "Anyone with the link can create timers"
  on public.shower_timers for insert
  to anon, authenticated
  with check (
    card_number > 0
    and duration_seconds between 60 and 3600
    and remaining_seconds >= 0
    and (participant_type is null or participant_type in ('boy', 'girl', 'adult_chaperone'))
  );

create policy "Anyone with the link can update timers"
  on public.shower_timers for update
  to anon, authenticated
  using (id is not null)
  with check (
    card_number > 0
    and duration_seconds between 60 and 3600
    and remaining_seconds >= 0
    and (participant_type is null or participant_type in ('boy', 'girl', 'adult_chaperone'))
  );

create policy "Anyone with the link can delete timers"
  on public.shower_timers for delete
  to anon, authenticated
  using (id is not null);

create policy "Anyone with the link can read sessions"
  on public.shower_sessions for select
  to anon, authenticated
  using (true);

create policy "Anyone with the link can create sessions"
  on public.shower_sessions for insert
  to anon, authenticated
  with check (
    card_number > 0
    and workgroup_id is not null
    and participant_type in ('boy', 'girl', 'adult_chaperone')
    and duration_seconds between 60 and 3600
    and status in ('active', 'completed', 'replaced', 'cleared')
  );

create policy "Anyone with the link can finish sessions"
  on public.shower_sessions for update
  to anon, authenticated
  using (id is not null)
  with check (
    card_number > 0
    and workgroup_id is not null
    and participant_type in ('boy', 'girl', 'adult_chaperone')
    and duration_seconds between 60 and 3600
    and status in ('active', 'completed', 'replaced', 'cleared')
  );

alter table public.workgroups replica identity full;
alter table public.shower_timers replica identity full;
alter table public.shower_sessions replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.workgroups;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shower_timers;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shower_sessions;
exception
  when duplicate_object then null;
end $$;
