-- ═══════════════════════════════════════════════════════════════════════════
--  Groovework — M1 / S0 verification
--  Read-only. Run any time; proves the schema is in the state we think it is.
--
--  EXPECTED:
--    · 8 rows  "rls"             — every table true
--    · 8 rows  "policies"        — every table has at least one
--    · 0 rows  "ANON_LEAK"       — nothing readable without a login
--  Any ANON_LEAK row is a failure and must be fixed before S2.
-- ═══════════════════════════════════════════════════════════════════════════

select 'rls' as check, tablename as object, rowsecurity::text as result
  from pg_tables
 where schemaname = 'public'

union all

select 'policies', tablename, count(*)::text
  from pg_policies
 where schemaname = 'public'
 group by tablename

union all

select 'ANON_LEAK', table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'

order by 1, 2;
