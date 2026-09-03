-- Part 2b: the function list, which got cut off after assign_member_code().
-- Read-only. Paste the result back.

select
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
order by p.proname;
