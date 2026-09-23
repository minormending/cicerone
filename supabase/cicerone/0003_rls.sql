set search_path = cicerone, public, extensions;

-- A trip holds confirmation codes, flight numbers and where somebody sleeps.
-- That is the entire reason this app has accounts, so the row policies are the
-- feature rather than the plumbing under it.

alter table trips    enable row level security;
alter table passages enable row level security;
alter table photos   enable row level security;

grant select, insert, update, delete on trips    to authenticated;
grant select, insert, update, delete on passages to authenticated;
grant select, insert, update, delete on photos   to authenticated;

-- Nothing is readable signed out. There are no public trips in v1: a
-- shareable link to a document containing somebody's hotel booking is a
-- feature that needs designing, not inheriting.
revoke all on trips, passages, photos from anon;

drop policy if exists trips_own on trips;
create policy trips_own on trips
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Passages and photos are reachable only through a trip the caller owns.
-- Written as a subquery on trips rather than a copied owner column: one place
-- decides who owns what, so the two cannot drift apart.
drop policy if exists passages_own on passages;
create policy passages_own on passages
  for all to authenticated
  using (exists (select 1 from trips t where t.id = passages.trip_id and t.owner = auth.uid()))
  with check (exists (select 1 from trips t where t.id = passages.trip_id and t.owner = auth.uid()));

drop policy if exists photos_own on photos;
create policy photos_own on photos
  for all to authenticated
  using (exists (select 1 from trips t where t.id = photos.trip_id and t.owner = auth.uid()))
  with check (exists (select 1 from trips t where t.id = photos.trip_id and t.owner = auth.uid()));
