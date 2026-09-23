-- cicerone: its own schema in a database several apps share.
--
-- Everything this app owns lives in `cicerone`. The shared layer in `public`
-- (profiles, apps, rate_limit) is used, never duplicated.

create schema if not exists cicerone;

grant usage on schema cicerone to anon, authenticated;

-- Nothing is granted by default. Each table opts in.
alter default privileges in schema cicerone revoke all on tables from anon, authenticated;

insert into public.apps (slug, name, schema)
values ('cicerone', 'Cicerone', 'cicerone')
on conflict (slug) do nothing;
