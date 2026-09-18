-- The role Chambers' server queries the Neon Data API as (issue #136).
--
-- The Data API switches to whatever Postgres role the request token's `role`
-- claim names. Chambers' server signs its own short-lived tokens with
-- role = chambers_server (lib/db/data-api.ts), using a private key only the
-- server holds; the matching public key is published at
-- /data-api-jwks.json and registered with Neon. Browsers never receive one of
-- these tokens -- their session is a Better Auth cookie, which the Data API
-- does not accept.
--
-- Row-level security is not part of access control (decided on #136), but it
-- stays enabled so any other role sees nothing. chambers_server gets one policy
-- per table that admits everything, which is how "full access" is expressed
-- without needing BYPASSRLS.
--
-- The login tables (auth_*) are left out on purpose: Better Auth reads them
-- over its own connection, and nothing needs them over HTTP.
--
-- One step cannot live here: the Data API's own login role has to be allowed to
-- switch into chambers_server (`grant chambers_server to <that role>`), and
-- that role only exists once the Data API is enabled. See db/neon/README.md.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'chambers_server') then
    create role chambers_server nologin;
  end if;
end $$;

grant usage on schema public to chambers_server;

do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename not like 'auth\_%'
  loop
    execute format('grant select, insert, update, delete on public.%I to chambers_server', t.tablename);
    execute format('drop policy if exists chambers_server_all on public.%I', t.tablename);
    execute format(
      'create policy chambers_server_all on public.%I for all to chambers_server using (true) with check (true)',
      t.tablename
    );
  end loop;
end $$;
