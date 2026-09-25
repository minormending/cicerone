set search_path = cicerone, public, extensions;

-- Passages whose subject left the trip.
--
-- A re-import that drops a stop used to leave its passages in `passages`,
-- pointing at an id that no longer existed: invisible in the book, and a
-- fault in `check` that blocked every save until somebody deleted them. The
-- routine may never delete a passage, because it cannot tell one it wrote
-- from one a person rewrote, so a changed trip stalled for good.
--
-- They come here instead. Set aside, not deleted: the stop may come back, and
-- a paragraph somebody spent an evening on is not the importer's to destroy.
-- Kept whole, so putting one back is an insert.
create table if not exists retired_passages (
  trip_id      uuid not null references trips(id) on delete cascade,
  id           text not null,
  subject_kind text not null,
  subject_id   text not null,
  kind         text not null,
  title        text not null,
  body         text not null,
  claims       jsonb not null default '[]'::jsonb,
  sources      jsonb not null default '[]'::jsonb,
  written_at   date not null,
  retired_at   timestamptz not null default now(),
  -- In words, for whoever finds it: "day 3: VINOTÉKA U LACHTANA left the trip".
  reason       text not null,
  primary key (trip_id, id)
);

create index if not exists retired_passages_trip on retired_passages (trip_id);

alter table retired_passages enable row level security;
grant select, insert, update, delete on retired_passages to authenticated;
revoke all on retired_passages from anon;

drop policy if exists retired_passages_own on retired_passages;
create policy retired_passages_own on retired_passages
  for all to authenticated
  using (exists (select 1 from trips t where t.id = retired_passages.trip_id and t.owner = auth.uid()))
  with check (exists (select 1 from trips t where t.id = retired_passages.trip_id and t.owner = auth.uid()));
