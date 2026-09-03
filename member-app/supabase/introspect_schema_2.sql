-- Part 2: everything except table columns (which part 1 already covered,
-- minus the tail that got cut off -- see introspect_schema_3.sql for that).
-- Read-only. Paste the result back.

with
pks as (
  select 1 as sect, tc.table_name, 0 as seq,
    format('PK %s: %s', tc.table_name, string_agg(kcu.column_name, ', ')) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
  group by tc.table_name
),
uniques as (
  select 2 as sect, tc.table_name, 0 as seq,
    format('UNIQUE %s: %s', tc.table_name, string_agg(kcu.column_name, ', ')) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'UNIQUE'
  group by tc.table_name
),
fks as (
  select 3 as sect, tc.table_name, 0 as seq,
    format('FK %s.%s -> %s.%s', tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  join information_schema.constraint_column_usage ccu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
),
checks as (
  select 4 as sect, tc.table_name, 0 as seq,
    format('CHECK %s (%s): %s', tc.table_name, tc.constraint_name, cc.check_clause) as line
  from information_schema.table_constraints tc
  join information_schema.check_constraints cc using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'CHECK'
),
idx as (
  select 5 as sect, tablename as table_name, 0 as seq,
    format('INDEX %s ON %s: %s', indexname, tablename, indexdef) as line
  from pg_indexes
  where schemaname = 'public'
),
rls_status as (
  select 6 as sect, c.relname as table_name, 0 as seq,
    format('RLS %s: %s', c.relname, case when c.relrowsecurity then 'ENABLED' else 'DISABLED' end) as line
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
policies as (
  select 7 as sect, tablename as table_name, 0 as seq,
    format('POLICY on %s "%s" (%s, roles=%s): USING(%s) WITH CHECK(%s)',
      tablename, policyname, cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '')) as line
  from pg_policies
  where schemaname = 'public'
),
funcs as (
  select 8 as sect, p.proname as table_name, 0 as seq,
    format('FUNCTION %s(%s) RETURNS %s [%s, %s]',
      p.proname,
      pg_get_function_arguments(p.oid),
      pg_get_function_result(p.oid),
      case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end,
      l.lanname
    ) as line
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
),
buckets as (
  select 9 as sect, id as table_name, 0 as seq,
    format('BUCKET %s: public=%s', id, public) as line
  from storage.buckets
),
storage_pols as (
  select 10 as sect, 'storage.objects' as table_name, 0 as seq,
    format('STORAGE POLICY "%s" (%s, roles=%s): USING(%s) WITH CHECK(%s)',
      policyname, cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '')) as line
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
)
select line from (
  select * from pks
  union all select * from uniques
  union all select * from fks
  union all select * from checks
  union all select * from idx
  union all select * from rls_status
  union all select * from policies
  union all select * from funcs
  union all select * from buckets
  union all select * from storage_pols
) x
order by sect, table_name, seq;
