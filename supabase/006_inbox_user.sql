-- ════════════════════════════════════════════════════════════════════════════
--  006 — S4 stage 1: the inbox is the PERSON's, not the org's
--  Decided by Lincoln 2026-08-31 (option C).
--
--  WHY THIS EXISTS
--  001_schema.sql created `inbox` with org_id and no user column, so every row
--  was the org's and any member could read every other member's captures. The
--  Inbox is a capture tray: screenshots, half-thoughts, a photo of a broken
--  latch. It is scratch, and it is the ONE store with no second copy anywhere
--  (timesheets have the Google Sheet, photos have Drive). Stage 1 exists to
--  back it up, not to share it.
--
--  ⭐ The rule this follows, banked from the two-phone test on 28 Aug:
--     ask of every table whether a row is the ORG's or the PERSON's, and store
--     it per-person from the start so narrowing is later a POLICY change and
--     never a migration over live data.
--
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The column ───────────────────────────────────────────────────────────
alter table public.inbox
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill anything already there to the org's owner. The client has never
-- pushed a row (kr_inbox sits in KR_SYNC_NEVER as a Class B store), so this
-- should touch nothing — it is here so the migration is honest if it does.
update public.inbox i
   set user_id = o.owner_uid
  from public.orgs o
 where o.id = i.org_id
   and i.user_id is null;

-- Only now can it be required. A row with no owner would be invisible to
-- everyone under the policies below, which is a silent disappearance.
do $$
begin
  if exists (select 1 from public.inbox where user_id is null) then
    raise exception 'inbox rows with no user_id remain — resolve before enforcing not null';
  end if;
end $$;

alter table public.inbox alter column user_id set not null;

-- ── 2. The delta index ──────────────────────────────────────────────────────
-- The pull is now scoped per person, so the index has to be too, or every
-- delta page scans the whole org's captures.
create index if not exists inbox_user_delta_idx
  on public.inbox (org_id, user_id, updated_at);

-- 001's index is now redundant for the read path but harmless; left in place so
-- this migration cannot break a query written against it.

-- ── 3. The policies ─────────────────────────────────────────────────────────
-- ⭐ OPTION C: you see your own captures and nobody else's. Org membership is
-- still required, so leaving the org cuts access even to your own rows sitting
-- in it. Both conditions, never either.
--
-- Deletes still go through UPDATE (setting deleted_at), never DELETE, so there
-- is deliberately no delete policy — same as 001.
drop policy if exists inbox_select on public.inbox;
create policy inbox_select on public.inbox
  for select using (public.is_org_member(org_id) and user_id = auth.uid());

drop policy if exists inbox_insert on public.inbox;
create policy inbox_insert on public.inbox
  for insert with check (public.is_org_member(org_id) and user_id = auth.uid());

-- ⚠️ WITH CHECK as well as USING: without it a member could hand their own row
-- to someone else by updating user_id, which is a write into another person's
-- tray through the one policy that looked read-shaped.
drop policy if exists inbox_update on public.inbox;
create policy inbox_update on public.inbox
  for update using  (public.is_org_member(org_id) and user_id = auth.uid())
       with check   (public.is_org_member(org_id) and user_id = auth.uid());

-- ── 4. Grants ───────────────────────────────────────────────────────────────
-- 003_lockdown.sql already granted select/insert/update on inbox to
-- authenticated, and its `alter default privileges ... revoke all` only affects
-- tables created AFTER it. Re-stated here so this file is self-contained and so
-- the S4 trap (a new table invisible to the Data API) is visibly accounted for.
grant select, insert, update on public.inbox to authenticated;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
-- Expect: three policies, each naming both is_org_member AND user_id = auth.uid().
select policyname,
       qual        as using_clause,
       with_check  as with_check_clause
  from pg_policies
 where schemaname = 'public' and tablename = 'inbox'
 order by policyname;
