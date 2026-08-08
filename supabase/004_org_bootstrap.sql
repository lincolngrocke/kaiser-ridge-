-- ═══════════════════════════════════════════════════════════════════════════
--  Groovework — M1 / S2 org bootstrap fix
--  Run AFTER 001_schema.sql and 003_lockdown.sql. Idempotent.
--
--  THE BUG, found on the first real sign-in 2026-08-08.
--
--  001 shipped `orgs_select` as:
--
--      using (public.is_org_member(id))
--
--  which is a chicken-and-egg at the one moment that matters most — the very
--  first sign-in:
--
--    1. `orgs_insert` correctly lets a new user create the org they own.
--    2. The client asks for the row back (Prefer: return=representation) so it
--       knows the new org's id. RLS filters it out — the user is not a member
--       yet, because the membership row is the NEXT step.
--    3. The client gets `[]`, can't learn the id, and never inserts the
--       membership row.
--
--  Worse, it doesn't fail cleanly: the INSERT still commits. So every app
--  launch found no membership, tried again, and left another orphan org.
--
--  Even had step 2 worked, step 3 would have failed for the same reason —
--  `org_members_insert`'s bootstrap branch does
--  `exists (select 1 from public.orgs o where ...)`, and that subquery runs as
--  the caller, so `orgs_select` filters it too.
--
--  THE FIX. One clause. An owner can always see the org they own:
--
--      using (public.is_org_member(id) or owner_uid = auth.uid())
--
--  This is not a widening of access — `owner_uid = auth.uid()` is as tight as
--  a predicate gets, and it is plainly correct on its own merits: you should
--  be able to read the row you are recorded as owning. It closes both failure
--  points at once, and it keeps the fix in the security layer where it belongs
--  rather than papering over it with a client-generated UUID.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs
  for select using (
    public.is_org_member(id)
    or owner_uid = auth.uid()
  );

-- ── Clean up the orphans ───────────────────────────────────────────────────
-- Orgs created by the failed bootstrap: owned by someone, but with no members
-- at all. A real org always has at least its owner as a manager, so "zero
-- members" identifies exactly the orphans and cannot match a live org.
--
-- Safe to run repeatedly. Run it BEFORE the app next launches, or it will have
-- adopted one of them (which is fine — the adopted one gains a member and is
-- then correctly excluded here).
delete from public.orgs o
 where not exists (select 1 from public.org_members m where m.org_id = o.id);

-- ── Check ──────────────────────────────────────────────────────────────────
-- Expect: zero orphan orgs.
--   select count(*) from public.orgs o
--    where not exists (select 1 from public.org_members m where m.org_id = o.id);
