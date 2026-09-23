set search_path = cicerone, public, extensions;

-- An imported itinerary. The graph is kept opaque: nothing here is queried by
-- shape, so the domain model can move without a migration.
create table if not exists trips (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  departs_on   date,
  graph        jsonb not null,
  source       text not null default 'wanderlog' check (source in ('wanderlog', 'polarsteps')),
  -- The share key the trip came from. Re-importing updates in place.
  source_key   text not null,
  -- Bumped whenever the imported document changes, so a guide can tell
  -- whether it is describing the trip that exists now.
  imported_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists trips_owner_source_key on trips (owner, source, source_key);
create index if not exists trips_owner_updated on trips (owner, updated_at desc);

-- The guide, one row per passage.
--
-- Rows rather than one document per trip, because the routine writes a trip in
-- pieces and a re-import invalidates some subjects and not others. Per-subject
-- staleness is the cheapest correct answer to "what does a rebuild redo".
create table if not exists passages (
  id           text primary key,
  trip_id      uuid not null references trips(id) on delete cascade,
  -- 'place' or 'corridor', with the id from the trip graph.
  subject_kind text not null check (subject_kind in ('place', 'corridor')),
  subject_id   text not null,
  kind         text not null check (
    kind in ('origin', 'event', 'table', 'craft', 'look_for', 'passing', 'prepare')
  ),
  title        text not null,
  body         text not null,
  -- [{text, source, support?}] — each specific assertion and what holds it up.
  claims       jsonb not null default '[]'::jsonb,
  -- [{url, title, retrieved}]
  sources      jsonb not null default '[]'::jsonb,
  -- Computed passages are researched by nobody and need no source.
  computed     boolean not null default false,
  written_at   date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (trip_id, subject_kind, subject_id, kind)
);

create index if not exists passages_trip on passages (trip_id);
create index if not exists passages_subject on passages (trip_id, subject_kind, subject_id);

-- A photograph, and how much its caption is allowed to claim.
create table if not exists photos (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  subject_kind  text not null check (subject_kind in ('place', 'corridor')),
  subject_id    text not null,
  unsplash_id   text,
  url           text not null,
  credit_name   text,
  credit_link   text,
  -- 'named' only where the match was verified or a person vouched for it.
  claim         text not null default 'atmosphere' check (claim in ('named', 'atmosphere')),
  chosen_by     text not null default 'auto' check (chosen_by in ('auto', 'person')),
  created_at    timestamptz not null default now(),
  -- One photograph per subject. A swap replaces rather than accumulates.
  unique (trip_id, subject_kind, subject_id)
);

create index if not exists photos_trip on photos (trip_id);

-- Keeps updated_at honest without the application having to remember.
create or replace function touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_touch on trips;
create trigger trips_touch before update on trips
  for each row execute function touch_updated_at();
