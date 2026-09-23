-- A day can be a subject, and a chapter can be written about it.
--
-- Chapter headings were computed from the first and last stop of the day:
-- "Antonínovo pekařství to Vinohradský Parlament" for a day spent in a
-- castle, two galleries and an opera house. True, and no use to a reader.
-- Naming a day is a judgement about what the day is for, so it moves to
-- where the other judgements live — written, checked, and refused if it
-- states a specific it cannot hold up.
--
-- The subject id is the day index as text, so the existing unique key over
-- (trip_id, subject_kind, subject_id, kind) keeps one chapter per day for free.

alter table passages drop constraint if exists passages_subject_kind_check;
alter table passages add constraint passages_subject_kind_check check (
  subject_kind in ('place', 'corridor', 'day')
);

alter table passages drop constraint if exists passages_kind_check;
alter table passages add constraint passages_kind_check check (
  kind in ('origin', 'event', 'table', 'craft', 'nearby', 'look_for', 'passing', 'prepare', 'chapter')
);
