-- ════════════════════════════════════════════════════════════════════════════
--  007 — S4 stage 2: task_notes becomes ONE ROW PER TO-DO
--
--  WHY THIS EXISTS
--  001_schema.sql created task_notes with `primary key (org_id, task_id)` — one
--  row per JOB holding all of that job's to-dos as a single jsonb blob. That is
--  not per-record, it is per-job blob, and it reintroduces exactly the failure
--  S4 exists to end: two people adding a to-do to the same job clobber each
--  other's ENTIRE list under last-write-wins. The blast radius is a whole job's
--  to-dos rather than one to-do.
--
--  ⭐ Every to-do already carries a stable id ('tn…', assigned at capture), so
--  per-note rows need no new machinery on the client — the record-sync registry
--  built in v325 takes it as-is, and task_notes ends up the same shape as inbox.
--
--  SCOPE: this table is the ORG's, not the person's — the opposite of inbox, and
--  deliberately. A capture is scratch; a to-do is an instruction. It hangs off a
--  JOB, the library is manager-writes / worker-reads, and to-dos are already sent
--  to workers on the pin channel today. So the policies stay org-scoped and
--  there is NO user_id column.
--
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Refuse to run if the old shape holds anything ────────────────────────
-- The client has never written here (kr_task_notes sits in KR_SYNC_NEVER as a
-- Class B store), so this should be empty. If it is not, stop: silently dropping
-- someone's to-dos to fix a schema is not a trade this migration gets to make.
do $$
begin
  if to_regclass('public.task_notes') is not null
     and exists (select 1 from public.task_notes) then
    raise exception 'task_notes is not empty — migrate its rows before reshaping it';
  end if;
end $$;

-- ── 2. The new shape ────────────────────────────────────────────────────────
drop table if exists public.task_notes;

create table public.task_notes (
  id         text primary key,                 -- the to-do's own id ('tn…')
  org_id     uuid not null references public.orgs(id) on delete cascade,
  task_id    text not null,                    -- the JOB it hangs off, by name
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── 3. Delta index ──────────────────────────────────────────────────────────
create index if not exists task_notes_delta_idx
  on public.task_notes (org_id, updated_at);
-- Reading every to-do for one job is the app's other access pattern.
create index if not exists task_notes_task_idx
  on public.task_notes (org_id, task_id);

-- ── 4. The trigger ──────────────────────────────────────────────────────────
-- ⭐ THE LINCHPIN. The delta pull asks for `updated_at >= watermark`; without
-- this the timestamp would never move, every device would look synced, and
-- nothing would ever propagate. Dropping the table dropped its trigger with it.
drop trigger if exists task_notes_touch on public.task_notes;
create trigger task_notes_touch
  before insert or update on public.task_notes
  for each row execute function public.touch_updated_at();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
alter table public.task_notes enable row level security;

-- Deletes go through UPDATE (setting deleted_at), never DELETE, so there is
-- deliberately no delete policy — same as 001.
drop policy if exists task_notes_select on public.task_notes;
create policy task_notes_select on public.task_notes
  for select using (public.is_org_member(org_id));

drop policy if exists task_notes_insert on public.task_notes;
create policy task_notes_insert on public.task_notes
  for insert with check (public.is_org_member(org_id));

drop policy if exists task_notes_update on public.task_notes;
create policy task_notes_update on public.task_notes
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── 6. Grants ───────────────────────────────────────────────────────────────
-- ⚠️ REQUIRED, not belt-and-braces. 003_lockdown.sql ends with
--   alter default privileges in schema public revoke all on tables from authenticated
-- so a table created AFTER it — which this one now is, having just been dropped
-- and recreated — is INVISIBLE to the Data API until granted explicitly. This is
-- the S4 trap, and dropping a table is precisely how you walk into it.
grant select, insert, update on public.task_notes to authenticated;

-- ── 7. Verify ───────────────────────────────────────────────────────────────
select 'columns' as check, string_agg(column_name, ', ' order by ordinal_position) as detail
  from information_schema.columns
 where table_schema = 'public' and table_name = 'task_notes'
union all
select 'policies', string_agg(policyname, ', ' order by policyname)
  from pg_policies where schemaname = 'public' and tablename = 'task_notes'
union all
select 'trigger', string_agg(tgname, ', ')
  from pg_trigger where tgrelid = 'public.task_notes'::regclass and not tgisinternal
union all
select 'grants', string_agg(privilege_type, ', ' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'task_notes' and grantee = 'authenticated';
