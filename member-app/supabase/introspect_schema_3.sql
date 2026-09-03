-- Part 3: just the columns that got cut off -- the rest of `people`, plus
-- `rsvps`, which never printed at all. Read-only. Paste the result back.

select
  c.table_name,
  format('  %-28s %-24s %s%s',
    c.column_name,
    c.data_type,
    case when c.is_nullable = 'NO' then 'NOT NULL' else '' end,
    case when c.column_default is not null then ' DEFAULT ' || c.column_default else '' end
  ) as line
from information_schema.columns c
where c.table_schema = 'public'
  and (
    (c.table_name = 'people' and c.column_name in (
      'spouse_mother_id', 'spouse_mother_name', 'spouse_mother_member_code',
      'father_mobile_number', 'father_dob',
      'mother_mobile_number', 'mother_dob',
      'spouse_mobile_number', 'spouse_dob',
      'maternal_uncle_mobile_number', 'maternal_uncle_dob',
      'spouse_father_mobile_number', 'spouse_father_dob',
      'spouse_mother_mobile_number', 'spouse_mother_dob',
      'occupation_type', 'job_title', 'company_name', 'job_location'
    ))
    or c.table_name = 'rsvps'
  )
order by c.table_name, c.ordinal_position;
