set search_path = cicerone, public, extensions;

-- What the import already knows about a place: hours, rating, what the kitchen
-- is known for. Read from Wanderlog, never derived here.
--
-- Keyed on the Google place id rather than the trip, because these facts are
-- about the real-world place and the same restaurant on two trips is the same
-- restaurant. That also means they are not owned by anybody, which is why this
-- table is readable by any signed-in user and writable through the same path
-- as everything else.
create table if not exists place_facts (
  place_id      text primary key,
  name          text not null,
  hours         jsonb,
  rating        numeric(2,1),
  rating_count  integer,
  website       text,
  -- [{name, imageKey}]
  dishes        jsonb not null default '[]'::jsonb,
  fetched_at    timestamptz not null default now()
);

alter table place_facts enable row level security;
grant select, insert, update on place_facts to authenticated;

drop policy if exists place_facts_read on place_facts;
create policy place_facts_read on place_facts
  for select to authenticated using (true);

drop policy if exists place_facts_write on place_facts;
create policy place_facts_write on place_facts
  for insert to authenticated with check (true);

drop policy if exists place_facts_update on place_facts;
create policy place_facts_update on place_facts
  for update to authenticated using (true) with check (true);

-- An image that came with the import is neither a guess nor a person's choice.
alter table photos drop constraint if exists photos_chosen_by_check;
alter table photos add constraint photos_chosen_by_check
  check (chosen_by in ('auto', 'person', 'import'));
