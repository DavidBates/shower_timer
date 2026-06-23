alter table public.shower_timers
  add column if not exists monitor_number integer not null default 1 check (monitor_number > 0);

alter table public.shower_sessions
  add column if not exists monitor_number integer not null default 1 check (monitor_number > 0);

create index if not exists shower_timers_monitor_number_idx on public.shower_timers(monitor_number);
create index if not exists shower_sessions_monitor_number_idx on public.shower_sessions(monitor_number);

alter table public.shower_timers
  drop constraint if exists shower_timers_card_number_key;

create unique index if not exists shower_timers_monitor_card_number_key
  on public.shower_timers(monitor_number, card_number);

insert into public.shower_timers (
  monitor_number,
  card_number,
  label,
  duration_seconds,
  remaining_seconds,
  sort_order,
  updated_at
)
select monitor_number, card_number, 'Available', 360, 360, card_number, now()
from generate_series(2, 3) as monitor_number
cross join generate_series(1, 4) as card_number
on conflict (monitor_number, card_number) do nothing;

drop policy if exists "Anyone with the link can create timers" on public.shower_timers;
create policy "Anyone with the link can create timers"
  on public.shower_timers for insert
  to anon, authenticated
  with check (
    monitor_number > 0
    and card_number > 0
    and duration_seconds between 60 and 3600
    and remaining_seconds >= 0
    and (participant_type is null or participant_type in ('boy', 'girl', 'adult_chaperone'))
  );

drop policy if exists "Anyone with the link can update timers" on public.shower_timers;
create policy "Anyone with the link can update timers"
  on public.shower_timers for update
  to anon, authenticated
  using (id is not null)
  with check (
    monitor_number > 0
    and card_number > 0
    and duration_seconds between 60 and 3600
    and remaining_seconds >= 0
    and (participant_type is null or participant_type in ('boy', 'girl', 'adult_chaperone'))
  );

drop policy if exists "Anyone with the link can create sessions" on public.shower_sessions;
create policy "Anyone with the link can create sessions"
  on public.shower_sessions for insert
  to anon, authenticated
  with check (
    monitor_number > 0
    and card_number > 0
    and workgroup_id is not null
    and participant_type in ('boy', 'girl', 'adult_chaperone')
    and duration_seconds between 60 and 3600
    and status in ('active', 'completed', 'replaced', 'cleared')
  );

drop policy if exists "Anyone with the link can finish sessions" on public.shower_sessions;
create policy "Anyone with the link can finish sessions"
  on public.shower_sessions for update
  to anon, authenticated
  using (id is not null)
  with check (
    monitor_number > 0
    and card_number > 0
    and workgroup_id is not null
    and participant_type in ('boy', 'girl', 'adult_chaperone')
    and duration_seconds between 60 and 3600
    and status in ('active', 'completed', 'replaced', 'cleared')
  );
