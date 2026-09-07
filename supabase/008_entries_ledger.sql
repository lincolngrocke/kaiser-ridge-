-- ════════════════════════════════════════════════════════════════════════════
--  008 — S4 stage 3: timesheets, as an APPEND-ONLY LEDGER
--
--  THE TENSION THIS RESOLVES
--  The locked rule is that kr_entries is append-only and immutable, and 001 built
--  the table to enforce it: SELECT and INSERT only, no UPDATE policy, no DELETE.
--  But the app lets you EDIT a timesheet entry (saveEntry rewrites entries[idx])
--  and DELETE one. Under an insert-only table those corrections could never leave
--  the phone, and worse, a pull would hand back the original and overwrite the
--  correction. Sync would quietly lie about the business record.
--
--  ⭐ BOTH HOLD IF A CORRECTION IS A NEW ROW. The table stays insert-only — there
--  is still no way to rewrite or remove what was recorded — and an edit appends a
--  fresh revision of the same logical entry. The newest revision wins on read.
--  A delete is a revision with deleted = true.
--
--  What that buys beyond making sync correct: a timesheet is a business record,
--  and this keeps the full history of what was recorded and when it was changed.
--  For hours that may be billed or paid, that is worth more than tidiness.
--
--  ⭐ ORDERING IS THE SERVER'S, NEVER A PHONE'S. Revisions are ordered by
--  created_at, stamped by Postgres. The locked rule is that device clock skew must
--  not order merges, so the row id carries a unique suffix for UNIQUENESS ONLY and
--  is never compared.
--
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.entries
  add column if not exists entry_id   text,                                    -- the logical entry
  add column if not exists user_id    uuid references auth.users(id),          -- WHOSE work this is
  add column if not exists created_by uuid default auth.uid(),                 -- who recorded THIS row
  add column if not exists deleted    boolean not null default false;

-- ⭐ user_id vs created_by is not duplication. user_id is the person the hours
-- belong to; created_by is whoever wrote the row. A manager correcting a worker's
-- entry leaves both true, which is exactly what a payroll record needs.

-- ⚠️ personnel stays in the payload as a DISPLAY name only. It was the sole record
-- of who did the work (personnel: getUserName()), which is the same defect as the
-- hardcoded Ethan and is why per-user estimates cannot be built yet. user_id is
-- the fix and it must be populated from here on.

-- Existing rows: the client has never pushed one (kr_entries sits in
-- KR_SYNC_NEVER as a Class B store), so this should touch nothing.
update public.entries set entry_id = id where entry_id is null;

do $$
begin
  if exists (select 1 from public.entries where entry_id is null) then
    raise exception 'entries rows with no entry_id remain — resolve before enforcing not null';
  end if;
end $$;

alter table public.entries alter column entry_id set not null;

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- 001 already has (org_id, created_at) for the delta pull. This one answers
-- "the current state of this entry", which is the read the app actually makes.
create index if not exists entries_rev_idx
  on public.entries (org_id, entry_id, created_at desc);

-- Per-person history, the prerequisite for per-user estimates.
create index if not exists entries_user_idx
  on public.entries (org_id, user_id, created_at);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Unchanged in shape and deliberately so. SELECT across the org, because a
-- manager reviewing the team's hours is the point of the team tier. INSERT for
-- any member, because a manager must be able to record a correction against a
-- worker's entry — created_by then says who did.
--
-- ⭐ STILL NO UPDATE OR DELETE POLICY. That is the ledger. Nothing already
-- recorded can be altered or removed through the API, by anyone, ever.
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries
  for select using (public.is_org_member(org_id));

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert with check (public.is_org_member(org_id));

-- ── 4. Grants ───────────────────────────────────────────────────────────────
-- Re-stated so this file is self-contained. Note it grants SELECT and INSERT
-- only: no update, no delete, matching the policies above.
grant select, insert on public.entries to authenticated;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
select 'columns'  as check, string_agg(column_name, ', ' order by ordinal_position) as detail
  from information_schema.columns
 where table_schema = 'public' and table_name = 'entries'
union all
select 'policies', string_agg(policyname || '=' || cmd, ', ' order by policyname)
  from pg_policies where schemaname = 'public' and tablename = 'entries'
union all
select 'grants (must be SELECT, INSERT only)', string_agg(privilege_type, ', ' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'entries' and grantee = 'authenticated';
