import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { ChipSelect } from '../../components/ChipSelect'
import { DataTable } from '../../components/admin/DataTable'
import { StatusBadge } from '../../components/admin/StatusBadge'
import { useAdmin } from '../../context/AdminContext'
import {
  adminExportMembers,
  adminMemberFilterOptions,
  adminSearchMembers,
  formatAdminDate,
  type AdminMemberFilterOptions,
} from '../../lib/admin'
import { toCsv, downloadCsv, type CsvColumn } from '../../lib/csv'
import { OCCUPATION_OPTIONS } from '../../lib/formOptions'
import { MEMBER_STATUS_LABELS } from '../../lib/people'
import type {
  AdminMemberExportRow,
  AdminMemberFilters,
  AdminSearchMemberRow,
  MemberStatus,
} from '../../types/database'

// Phase 5b-1: every member, not just the review queue. Filters live in the
// query string so a filtered view survives a reload and can be shared with
// another admin; the CSV export takes exactly the same filters.

const PAGE_SIZE = 25

const STATUS_ORDER: MemberStatus[] = ['pending', 'info_requested', 'approved', 'rejected', 'onboarding']
const STATUS_OPTIONS = STATUS_ORDER.map((status) => ({
  value: status,
  label: MEMBER_STATUS_LABELS[status],
}))

function isMemberStatus(value: string | null): value is MemberStatus {
  return STATUS_ORDER.some((status) => status === value)
}

const FILTER_KEYS = ['status', 'state', 'city', 'gotra', 'occupation'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

const EXPORT_COLUMNS: CsvColumn<AdminMemberExportRow>[] = [
  { header: 'Member ID', value: (r) => r.member_code },
  { header: 'Status', value: (r) => MEMBER_STATUS_LABELS[r.member_status] },
  { header: 'First name', value: (r) => r.first_name },
  { header: 'Middle name', value: (r) => r.middle_name },
  { header: 'Last name', value: (r) => r.last_name },
  { header: 'Full name', value: (r) => r.full_name },
  { header: 'Gender', value: (r) => r.gender },
  { header: 'Date of birth', value: (r) => r.dob },
  { header: 'Email', value: (r) => r.email },
  { header: 'Mobile', value: (r) => r.mobile_number },
  { header: 'Gotra', value: (r) => r.gotra },
  { header: 'Native place', value: (r) => r.native_place },
  { header: 'City', value: (r) => r.current_city },
  { header: 'District', value: (r) => r.current_district },
  { header: 'State', value: (r) => r.current_state },
  { header: 'Occupation', value: (r) => r.occupation_type },
  { header: 'Job title', value: (r) => r.job_title },
  { header: 'Company', value: (r) => r.company_name },
  { header: 'Marital status', value: (r) => r.marital_status },
  { header: 'Education', value: (r) => r.education },
  // Dates only -- a timestamp with zone is noise in a spreadsheet.
  { header: 'Submitted', value: (r) => r.submitted_at?.slice(0, 10) },
  { header: 'Reviewed', value: (r) => r.reviewed_at?.slice(0, 10) },
  { header: 'Signed up', value: (r) => r.created_at.slice(0, 10) },
]

export function AdminMembers() {
  const { role } = useAdmin()
  const [searchParams, setSearchParams] = useSearchParams()

  // Parse from the query string's text, not the searchParams object (a fresh
  // object on every navigation), so `filters` only changes when they do.
  const paramsKey = searchParams.toString()
  const filters: AdminMemberFilters = useMemo(() => {
    const params = new URLSearchParams(paramsKey)
    const status = params.get('status')
    return {
      status: isMemberStatus(status) ? status : null,
      search: params.get('q') ?? '',
      state: params.get('state') || null,
      city: params.get('city') || null,
      gotra: params.get('gotra') || null,
      occupation: params.get('occupation') || null,
    }
  }, [paramsKey])
  const query = filters.search ?? ''

  const [search, setSearch] = useState(query)
  const [options, setOptions] = useState<AdminMemberFilterOptions | null>(null)
  const [rows, setRows] = useState<AdminSearchMemberRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setParam = useCallback(
    (key: FilterKey | 'q', value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Debounce typing into ?q=, so every keystroke isn't an RPC.
  useEffect(() => {
    const trimmed = search.trim()
    if (trimmed === query) return
    const handle = setTimeout(() => setParam('q', trimmed), 300)
    return () => clearTimeout(handle)
  }, [search, query, setParam])

  useEffect(() => {
    let cancelled = false
    adminMemberFilterOptions()
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      // Non-fatal: the chips just stay empty, search still works.
      .catch((err) => console.error('[AdminMembers] failed to load filter options', err))
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    const page = await adminSearchMembers(filters, { limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [filters])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminMembers] failed to load members', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading members.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await adminSearchMembers(filters, { limit: PAGE_SIZE, offset: rows.length })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[AdminMembers] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more members.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function exportCsv() {
    setExporting(true)
    setError(null)
    try {
      const exportRows = await adminExportMembers(filters)
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(`khandelwal-members-${stamp}.csv`, toCsv(exportRows, EXPORT_COLUMNS))
    } catch (err) {
      console.error('[AdminMembers] export failed', err)
      setError(err instanceof Error ? err.message : 'Could not export members.')
    } finally {
      setExporting(false)
    }
  }

  const anyFilter = FILTER_KEYS.some((key) => filters[key]) || query !== ''
  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name, member ID, mobile or email"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          label="All submitted"
          value={filters.status ?? ''}
          onChange={(value) => setParam('status', value)}
          options={STATUS_OPTIONS}
        />
        <ChipSelect
          label="State"
          value={filters.state ?? ''}
          onChange={(value) => setParam('state', value)}
          options={options?.states ?? []}
        />
        <ChipSelect
          label="City"
          value={filters.city ?? ''}
          onChange={(value) => setParam('city', value)}
          options={options?.cities ?? []}
        />
        <ChipSelect
          label="Gotra"
          value={filters.gotra ?? ''}
          onChange={(value) => setParam('gotra', value)}
          options={options?.gotras ?? []}
        />
        <ChipSelect
          label="Occupation"
          value={filters.occupation ?? ''}
          onChange={(value) => setParam('occupation', value)}
          options={OCCUPATION_OPTIONS}
        />
        {anyFilter && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setSearchParams(new URLSearchParams(), { replace: true })
            }}
            className="text-sm text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          {loading || total === null ? '' : `${total} ${total === 1 ? 'member' : 'members'}`}
        </p>
        {/* Super admins only: a bulk download of mobiles and emails. The RPC
            refuses anyone else and audits every export. */}
        {role === 'super_admin' && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || loading || total === 0}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading members…</p>
      ) : (
        <>
          <DataTable
            rows={rows}
            rowKey={(member) => member.id}
            empty={anyFilter ? 'No members match these filters.' : 'No members yet.'}
            primary={{
              header: 'Member',
              cell: (member) => (
                <Link
                  to={`/admin/members/${member.id}`}
                  className="flex items-start gap-2.5 hover:underline underline-offset-2"
                >
                  <Avatar name={member.full_name} photoUrl={member.profile_photo_url} size={32} />
                  <span className="min-w-0">
                    <span className="block font-medium">{member.full_name}</span>
                    {member.member_code && (
                      <span className="block text-xs tracking-wide text-[var(--color-text-muted)]">
                        {member.member_code}
                      </span>
                    )}
                  </span>
                </Link>
              ),
            }}
            columns={[
              {
                key: 'status',
                header: 'Status',
                cell: (member) => <StatusBadge status={member.member_status} />,
              },
              {
                key: 'contact',
                header: 'Contact',
                cell: (member) => (
                  <div className="flex flex-col">
                    <span>{member.mobile_number ?? '—'}</span>
                    {member.email && (
                      <span className="break-all text-xs text-[var(--color-text-muted)]">
                        {member.email}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'place',
                header: 'Location',
                cell: (member) =>
                  [member.current_city, member.current_state].filter(Boolean).join(', ') || '—',
              },
              { key: 'gotra', header: 'Gotra', cell: (member) => member.gotra ?? '—' },
              {
                key: 'occupation',
                header: 'Occupation',
                cell: (member) => member.occupation_type ?? '—',
              },
              {
                key: 'joined',
                header: 'Signed up',
                align: 'right',
                cell: (member) => formatAdminDate(member.created_at) ?? '—',
              },
            ]}
          />

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
