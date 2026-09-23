set search_path = cicerone, public, extensions;

-- What is around a stop that the itinerary does not include.
--
-- A hotel has nothing to say about itself and a great deal to say about its
-- street, and there was no kind for that: `look_for` was already taken on
-- every place by the computed light passage, which is what surfaced the gap.
alter table passages drop constraint if exists passages_kind_check;
alter table passages add constraint passages_kind_check check (
  kind in ('origin', 'event', 'table', 'craft', 'nearby', 'look_for', 'passing', 'prepare')
);
