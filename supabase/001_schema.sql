-- ═══════════════════════════════════════════════════════════════════════════
--  Groovework — M1 / S0 schema
--  Plan: ~/.claude/plans/m1-supabase-accounts-sync.md
--  Run once, in the Supabase SQL Editor, against a project in ap-southeast-2.
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Two rules govern everything below.
--
--  1. ORG-SCOPED, NEVER USER-SCOPED. Every row carries org_id. A solo user is an
--     org of one. Seats are priced per user, so entitlements must attach to the
--     org — shipping user-scoped data means a second migration the day seats sell.
--
--  2. THE SERVER OWNS TIME. updated_at is set by a trigger, never by the client.
--     Phones have wrong clocks; merge order decided by a wrong clock silently
--     loses work. This is also what makes delta sync (updated_at > watermark)
--     trustworthy.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Only the table-independent one lives up here. The two membership functions
-- read org_members, and a LANGUAGE SQL body is parsed and validated the moment
-- the function is created — so they must come AFTER that table exists. They sit
-- immediately below it.

-- Every mutable table gets this. The client never sends updated_at.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Orgs & membership ──────────────────────────────────────────────────────

create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_uid  uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null default 'worker' check (role in ('manager','worker')),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- "which orgs am I in" runs on every boot
create index if not exists org_members_user_idx on public.org_members (user_id);

-- ── Membership helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER on purpose: these functions read org_members from INSIDE the
-- policies that protect org_members. Without definer rights that is infinite
-- recursion — the classic Postgres RLS trap. Definer bypasses RLS for this one
-- narrow membership lookup and nothing else. search_path is pinned so the
-- function can't be hijacked by a caller-supplied schema.

create or replace function public.is_org_member(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
     where org_id = _org and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_manager(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
     where org_id = _org and user_id = auth.uid() and role = 'manager'
  );
$$;

-- ── Class A — the ~60 small singletons ─────────────────────────────────────
-- One row per kr_* key, holding the SAME JSON string the app already reads, so
-- no app logic changes. Last-write-wins per key.

create table if not exists public.kv (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (org_id, key)
);

-- ── Class B — the four large stores, one row per record ────────────────────
-- Per-record rows are what let two phones adding work at the same time MERGE
-- instead of clobber. Under Firestore this was forced by a 1 MiB document
-- ceiling; here it is simply the right shape.

-- Timesheets. APPEND-ONLY and immutable once written: there are no update or
-- delete policies below, so the database itself refuses to rewrite history.
-- id is device-generated (deviceId:timestamp) — never sort, renumber or
-- ID-match on sync; that caused data loss before.
create table if not exists public.entries (
  id         text primary key,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

-- deleted_at is a TOMBSTONE, not a removal. A deleted row still has to sync, or
-- the delete never reaches the other phone.
create table if not exists public.inbox (
  id         text primary key,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_notes (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  task_id    text not null,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (org_id, task_id)
);

-- Metadata only. Bytes live in Storage (bucket created in S4); storage_path is
-- the pointer. Retires the Apps Script → Drive read path.
create table if not exists public.subtask_photos (
  id           text primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  meta         jsonb not null,
  storage_path text,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Completions, as they happen.
-- The timesheet entry above keeps its own embedded copy of the checklist — that
-- stays the immutable record of the shift. But an entry is only written at
-- CLOCK-OUT, so on its own it means a manager sees a worker's day only once the
-- day is over. These rows are written when the task is TICKED, making the live
-- stream queryable: "what has Ethan finished today, across every job".
-- Also the natural input for the learning engine when it moves server-side.
create table if not exists public.completions (
  id         text primary key,            -- deviceId:timestamp, same scheme as entries
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  job        text not null,
  task       text not null,
  lap        int  not null default 0,     -- 0 = the single occurrence; 1..n = repeat laps
  done_at    timestamptz not null,        -- when the worker ticked it (their clock, kept as-is)
  dur_ms     bigint,                      -- measured duration for this occurrence, if known
  entry_id   text,                        -- links to entries once the shift closes
  updated_at timestamptz not null default now()
);

-- ── Delta-sync indexes ─────────────────────────────────────────────────────
-- Every pull is "give me this org's rows changed since my watermark, in order,
-- capped". These indexes are what keep that O(changed) instead of O(history) at
-- ten thousand users with years of data. No unbounded select ships.

create index if not exists kv_delta_idx             on public.kv             (org_id, updated_at);
create index if not exists inbox_delta_idx          on public.inbox          (org_id, updated_at);
create index if not exists task_notes_delta_idx     on public.task_notes     (org_id, updated_at);
create index if not exists subtask_photos_delta_idx on public.subtask_photos (org_id, updated_at);
create index if not exists entries_delta_idx        on public.entries        (org_id, created_at);
create index if not exists completions_delta_idx    on public.completions    (org_id, updated_at);
-- "what did this person do, most recent first" — the manager view's core query
create index if not exists completions_who_idx      on public.completions    (org_id, user_id, done_at desc);

-- ── updated_at triggers ────────────────────────────────────────────────────

drop trigger if exists kv_touch             on public.kv;
drop trigger if exists inbox_touch          on public.inbox;
drop trigger if exists task_notes_touch     on public.task_notes;
drop trigger if exists subtask_photos_touch on public.subtask_photos;
drop trigger if exists completions_touch    on public.completions;

create trigger kv_touch             before insert or update on public.kv
  for each row execute function public.touch_updated_at();
create trigger inbox_touch          before insert or update on public.inbox
  for each row execute function public.touch_updated_at();
create trigger task_notes_touch     before insert or update on public.task_notes
  for each row execute function public.touch_updated_at();
create trigger subtask_photos_touch before insert or update on public.subtask_photos
  for each row execute function public.touch_updated_at();
create trigger completions_touch    before insert or update on public.completions
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  The most security-critical surface in the product: a wrong policy here is
--  one customer reading another's business. Default-deny — RLS on, and nothing
--  is readable or writable except through an explicit policy below.
--  S5 proves these with an executable test suite. Until then treat them as
--  written-but-unproven.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orgs           enable row level security;
alter table public.org_members    enable row level security;
alter table public.kv             enable row level security;
alter table public.entries        enable row level security;
alter table public.inbox          enable row level security;
alter table public.task_notes     enable row level security;
alter table public.subtask_photos enable row level security;
alter table public.completions    enable row level security;

-- orgs ----------------------------------------------------------------------
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs
  for select using (public.is_org_member(id));

-- First sign-in creates your own org. You may only create one you own.
drop policy if exists orgs_insert on public.orgs;
create policy orgs_insert on public.orgs
  for insert with check (owner_uid = auth.uid());

drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs
  for update using (public.is_org_manager(id)) with check (public.is_org_manager(id));

-- org_members ---------------------------------------------------------------
-- You can always see your own membership rows (this is how the client learns
-- which orgs it belongs to before any other policy can be evaluated).
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select using (user_id = auth.uid() or public.is_org_member(org_id));

-- Bootstrapping: the org owner adds themselves as the first manager. After that
-- only an existing manager may add seats.
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members
  for insert with check (
    public.is_org_manager(org_id)
    or exists (select 1 from public.orgs o where o.id = org_id and o.owner_uid = auth.uid())
  );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete using (public.is_org_manager(org_id));

-- kv ------------------------------------------------------------------------
-- Read: any member. Write: any member — kv holds this device's working state
-- (prefs, order, planner) as well as library keys. The job library's
-- manager-writes/worker-reads authority stays enforced in the app for M1;
-- tightening specific library keys to managers is an S5 refinement once the
-- key list is settled, and is noted there rather than guessed at here.
drop policy if exists kv_select on public.kv;
create policy kv_select on public.kv
  for select using (public.is_org_member(org_id));

drop policy if exists kv_write on public.kv;
create policy kv_write on public.kv
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- entries -------------------------------------------------------------------
-- Insert and select only. No update policy and no delete policy means the
-- database refuses both — the timesheet log is immutable by construction, not
-- by convention.
drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries
  for select using (public.is_org_member(org_id));

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert with check (public.is_org_member(org_id));

-- inbox / task_notes / subtask_photos ---------------------------------------
-- Deletes go through UPDATE (setting deleted_at), never DELETE — so there is
-- deliberately no delete policy on these either.
drop policy if exists inbox_select on public.inbox;
create policy inbox_select on public.inbox
  for select using (public.is_org_member(org_id));
drop policy if exists inbox_insert on public.inbox;
create policy inbox_insert on public.inbox
  for insert with check (public.is_org_member(org_id));
drop policy if exists inbox_update on public.inbox;
create policy inbox_update on public.inbox
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists task_notes_select on public.task_notes;
create policy task_notes_select on public.task_notes
  for select using (public.is_org_member(org_id));
drop policy if exists task_notes_insert on public.task_notes;
create policy task_notes_insert on public.task_notes
  for insert with check (public.is_org_member(org_id));
drop policy if exists task_notes_update on public.task_notes;
create policy task_notes_update on public.task_notes
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists subtask_photos_select on public.subtask_photos;
create policy subtask_photos_select on public.subtask_photos
  for select using (public.is_org_member(org_id));
drop policy if exists subtask_photos_insert on public.subtask_photos;
create policy subtask_photos_insert on public.subtask_photos
  for insert with check (public.is_org_member(org_id));
drop policy if exists subtask_photos_update on public.subtask_photos;
create policy subtask_photos_update on public.subtask_photos
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- completions ---------------------------------------------------------------
-- Read: any member (this is what a manager view reads).
-- Write: you may only record YOUR OWN completions — user_id must be you. A
-- worker cannot forge work against someone else's name, and the manager's view
-- is therefore trustworthy by construction rather than by trust.
-- No delete policy: a completion is a fact that happened.
drop policy if exists completions_select on public.completions;
create policy completions_select on public.completions
  for select using (public.is_org_member(org_id));

drop policy if exists completions_insert on public.completions;
create policy completions_insert on public.completions
  for insert with check (public.is_org_member(org_id) and user_id = auth.uid());

-- Update exists only so an un-tick can correct a mistake, and only your own.
drop policy if exists completions_update on public.completions;
create policy completions_update on public.completions
  for update using (public.is_org_member(org_id) and user_id = auth.uid())
          with check (public.is_org_member(org_id) and user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
--  DATA API GRANTS
--  The project was created with "Automatically expose new tables" OFF, so a new
--  table is invisible to the Data API until it is granted explicitly. Nothing
--  below is granted to `anon` — every role here is `authenticated`, so a request
--  without a login cannot touch any table at all, whatever the policies say.
--
--  Two independent gates, deliberately: GRANT decides whether an operation is
--  permitted at all, RLS decides which rows. A mistake in one is caught by the
--  other. Note the grants mirror the policies exactly — entries has no update or
--  delete, and the tombstoned tables have no delete.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to authenticated;

grant select, insert, update          on public.orgs           to authenticated;
grant select, insert, update, delete  on public.org_members    to authenticated;
grant select, insert, update, delete  on public.kv             to authenticated;
grant select, insert                  on public.entries        to authenticated;
grant select, insert, update          on public.inbox          to authenticated;
grant select, insert, update          on public.task_notes     to authenticated;
grant select, insert, update          on public.subtask_photos to authenticated;
grant select, insert, update          on public.completions    to authenticated;

-- Policies call these, so the calling role must be able to execute them.
grant execute on function public.is_org_member(uuid)  to authenticated;
grant execute on function public.is_org_manager(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  Sanity check — run after the above and read the output.
--  Every table must show rowsecurity = true.
-- ═══════════════════════════════════════════════════════════════════════════
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' order by tablename;
--
-- And that nothing is reachable without a login — this must return ZERO rows:
--
-- select table_name, privilege_type from information_schema.role_table_grants
--  where grantee = 'anon' and table_schema = 'public';
