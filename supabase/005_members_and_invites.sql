-- ═══════════════════════════════════════════════════════════════════════════
--  Groovework — M1 / S2b: real members and an invite flow
--  Run AFTER 001–004. Idempotent.
--
--  WHY THIS EXISTS
--
--  Two things block S2b, and both are schema:
--
--  1. THERE IS NOWHERE TO PUT A PERSON'S NAME. org_members holds user_id and
--     role and nothing else, and auth.users is NOT readable through the Data
--     API. So the app cannot show you who a member is — only a UUID. Planning
--     "Ethan's day" against a UUID is not a product.
--
--  2. NOBODY CAN JOIN. org_members.user_id references auth.users, so you cannot
--     pre-create a row for someone who has not signed up yet. And a person
--     joining is neither a manager of that org nor its owner, so org_members_insert
--     (001, line ~245) refuses them. Today an org of one is the ONLY org that
--     can exist. That is why Ethan has been told not to sign in — he would
--     create a second org rather than join Lincoln's.
--
--  THE INVITE IS AUTHORISATION, so the code must be unguessable. It is generated
--  by the DATABASE, not the client — a weak client-side code would be a way into
--  someone else's org, and this is the one place that must not depend on getting
--  a JS random right.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Somewhere to put a name ─────────────────────────────────────────────
alter table public.org_members add column if not exists display_name text;

-- ── 2. Invites ─────────────────────────────────────────────────────────────
create table if not exists public.org_invites (
  -- 40 bits from the DB's CSPRNG. Long enough not to be guessed, short enough
  -- to read down the phone to someone.
  code         text primary key default upper(encode(gen_random_bytes(5), 'hex')),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  role         text not null default 'worker' check (role in ('manager','worker')),
  -- What to call them. Set at invite time so the manager can plan their day
  -- BEFORE they have ever signed in — otherwise there is a dead window where a
  -- member exists in intent but not in the app.
  display_name text,
  email        text,          -- informational only; the code is what authorises
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  claimed_by   uuid references auth.users(id) on delete set null,
  claimed_at   timestamptz
);
create index if not exists org_invites_org_idx on public.org_invites (org_id);

-- ── 3. Claiming ────────────────────────────────────────────────────────────
-- SECURITY DEFINER, and it has to be: the person claiming is not yet a member,
-- so org_members_insert would refuse them. The code is the authorisation, and
-- this function is the only thing that may act on it. Same reasoning as
-- is_org_member/is_org_manager in 001 — definer rights for one narrow job.
--
-- `for update` takes a row lock so two devices claiming the same code at once
-- cannot both succeed.
create or replace function public.claim_invite(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.org_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into inv
    from public.org_invites
   where code = upper(trim(_code))
   for update;

  if not found then raise exception 'invalid invite code'; end if;
  if inv.claimed_at is not null then raise exception 'invite already used'; end if;
  if inv.expires_at < now() then raise exception 'invite expired'; end if;

  -- Already a member of this org? Then this is a re-run, not a join. Keep it
  -- idempotent rather than erroring — a double-tap must not be a failure.
  insert into public.org_members (org_id, user_id, role, display_name)
  values (inv.org_id, auth.uid(), inv.role, inv.display_name)
  on conflict (org_id, user_id) do update
     set role         = excluded.role,
         display_name = coalesce(public.org_members.display_name, excluded.display_name);

  update public.org_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where code = inv.code;

  return inv.org_id;
end;
$$;

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
-- Only a manager of the org ever reads or writes invites. The person CLAIMING
-- one needs no select at all — claim_invite is definer and does the reading.
-- So an invite code cannot be used to enumerate anything.
alter table public.org_invites enable row level security;

drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites
  for select using (public.is_org_manager(org_id));

drop policy if exists org_invites_insert on public.org_invites;
create policy org_invites_insert on public.org_invites
  for insert with check (public.is_org_manager(org_id) and created_by = auth.uid());

drop policy if exists org_invites_delete on public.org_invites;
create policy org_invites_delete on public.org_invites
  for delete using (public.is_org_manager(org_id));

-- ── 5. Grants ──────────────────────────────────────────────────────────────
-- ⚠️ 003_lockdown.sql ends with:
--       alter default privileges in schema public revoke all on tables from authenticated;
--    so a NEW TABLE IS INVISIBLE TO THE DATA API until granted explicitly. This
--    block is not optional tidiness; without it org_invites returns 42501 and
--    the whole invite flow silently fails.
grant select, insert, delete on public.org_invites to authenticated;
grant execute on function public.claim_invite(text) to authenticated;

-- anon gets nothing, ever. Claiming requires a signed-in user by definition.
revoke all on public.org_invites          from anon;
revoke execute on function public.claim_invite(text) from anon;

-- ── Check ──────────────────────────────────────────────────────────────────
--   select count(*) from information_schema.role_table_grants
--    where grantee = 'anon' and table_name = 'org_invites';        -- expect 0
--   select column_name from information_schema.columns
--    where table_name = 'org_members' and column_name = 'display_name';  -- expect 1 row
