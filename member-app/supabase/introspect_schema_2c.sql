-- Part 2c: storage buckets + their policies. Read-only. Paste the result back.

with
buckets as (
  select 1 as sect,
    format('BUCKET %s: public=%s', id, public) as line
  from storage.buckets
),
storage_pols as (
  select 2 as sect,
    format('STORAGE POLICY "%s" (%s, roles=%s): USING(%s) WITH CHECK(%s)',
      policyname, cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '')) as line
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
)
select line from (select * from buckets union all select * from storage_pols) x
order by sect, line;
