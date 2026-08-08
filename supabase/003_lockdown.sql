-- ═══════════════════════════════════════════════════════════════════════════
--  Groovework — M1 / S0 privilege lockdown
--  Run AFTER 001_schema.sql. Idempotent.
--
--  Why this exists. 002_verify found `anon` and `authenticated` holding
--  TRUNCATE, TRIGGER and REFERENCES on every table. Those are not from 001 —
--  they are inherited from the project's default privileges, which the
--  "don't automatically expose new tables" setting only strips the read/write
--  privileges from.
--
--  No data was readable: SELECT/INSERT/UPDATE/DELETE were correctly absent.
--  But TRUNCATE deserves closing on its own merits, because of a Postgres
--  fact that is easy to miss:
--
--      *** RLS POLICIES DO NOT APPLY TO TRUNCATE. ***
--
--  Every other operation on these tables is gated twice — once by GRANT, once
--  by a row policy. TRUNCATE is gated by GRANT alone. It is not reachable
--  through the Data API today, so this is not a live hole; it is the removal
--  of the one operation that has no second line of defence.
--
--  Approach: revoke everything, then re-grant exactly what the policies allow.
--  Stating the whole privilege set in one place beats trusting an inherited
--  default we did not choose.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── anon: nothing, at all ──────────────────────────────────────────────────
-- Unauthenticated requests have no business touching any application table.
revoke all privileges on all tables    in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke all privileges on all functions in schema public from anon;

-- ── authenticated: precisely the operations the policies permit ────────────
revoke all privileges on all tables    in schema public from authenticated;
revoke all privileges on all functions in schema public from authenticated;

grant select, insert, update          on public.orgs           to authenticated;
grant select, insert, update, delete  on public.org_members    to authenticated;
grant select, insert, update, delete  on public.kv             to authenticated;
grant select, insert                  on public.entries        to authenticated;
grant select, insert, update          on public.inbox          to authenticated;
grant select, insert, update          on public.task_notes     to authenticated;
grant select, insert, update          on public.subtask_photos to authenticated;
grant select, insert, update          on public.completions    to authenticated;

grant execute on function public.is_org_member(uuid)  to authenticated;
grant execute on function public.is_org_manager(uuid) to authenticated;

-- ── And stop it coming back on the next table we create ────────────────────
-- Applies to objects created by this role from here on.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on tables    from authenticated;

-- Re-run 002_verify.sql afterwards. ANON_LEAK must return zero rows.
