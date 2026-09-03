-- Read-only schema dump. Run this whole block in the Supabase SQL editor,
-- then select all rows of the `line` column and paste them back.
-- Nothing here writes or deletes anything.

with
tbl_headers as (
  select 1 as sect, t.table_name, 0 as seq,
    format('--- TABLE %s ---', t.table_name) as line
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
),
cols as (
  select 1 as sect, c.table_name, c.ordinal_position as seq,
    format('  %-28s %-24s %s%s',
      c.column_name,
      c.data_type,
      case when c.is_nullable = 'NO' then 'NOT NULL' else '' end,
      case when c.column_default is not null then ' DEFAULT ' || c.column_default else '' end
    ) as line
  from information_schema.columns c
  where c.table_schema = 'public'
),
pks as (
  select 2 as sect, tc.table_name, 0 as seq,
    format('PK %s: %s', tc.table_name, string_agg(kcu.column_name, ', ')) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
  group by tc.table_name
),
uniques as (
  select 3 as sect, tc.table_name, 0 as seq,
    format('UNIQUE %s: %s', tc.table_name, string_agg(kcu.column_name, ', ')) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'UNIQUE'
  group by tc.table_name
),
fks as (
  select 4 as sect, tc.table_name, 0 as seq,
    format('FK %s.%s -> %s.%s', tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name) as line
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
  join information_schema.constraint_column_usage ccu using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
),
checks as (
  select 5 as sect, tc.table_name, 0 as seq,
    format('CHECK %s (%s): %s', tc.table_name, tc.constraint_name, cc.check_clause) as line
  from information_schema.table_constraints tc
  join information_schema.check_constraints cc using (constraint_schema, constraint_name)
  where tc.table_schema = 'public' and tc.constraint_type = 'CHECK'
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
  select * from tbl_headers
  union all select * from cols
  union all select * from pks
  union all select * from uniques
  union all select * from fks
  union all select * from checks
  union all select * from rls_status
  union all select * from policies
  union all select * from funcs
  union all select * from buckets
  union all select * from storage_pols
) x
order by sect, table_name, seq;
