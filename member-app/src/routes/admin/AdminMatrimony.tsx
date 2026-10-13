import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { TabStrip } from '../../components/TabStrip'
import { DataTable } from '../../components/admin/DataTable'
import { MatrimonyReports } from '../../components/admin/MatrimonyReports'
import { formatAdminDate } from '../../lib/admin'
import { adminListMatrimony } from '../../lib/matrimony'
import type { AdminMatrimonyRow, MatrimonyStatus } from '../../types/database'

// Phase 6a: the matrimony verification queue. Decisions are made on the
// detail page (/admin/matrimony/:id), not inline -- reviewing means looking
// at the photos, which only the detail page loads (and audits).

const PAGE_SIZE = 25

// (6c) + Paused, Hidden and the Reports tab, which renders its own list.
const TABS: { key: Exclude<MatrimonyStatus, 'draft'> | 'reports'; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'reports', label: 'Reports' },
  { key: 'changes_requested', label: 'Changes requested' },
  { key: 'approved', label: 'Live' },
  { key: 'paused', label: 'Paused' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'rejected', label: 'Turned down' },
]

type Tab = (typeof TABS)[number]['key']

function isTab(value: string | null): value is Tab {
  return TABS.some((tab) => tab.key === value)
}

export function AdminMatrimony() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawStatus = searchParams.get('status')
  const status: Tab = isTab(rawStatus) ? rawStatus : 'pending'

  const [rows, setRows] = useState<AdminMatrimonyRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const load = useCallback(async () => {
    if (status === 'reports') return
    const page = await adminListMatrimony({ status, search: debouncedSearch, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [status, debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminMatrimony] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading profiles.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function loadMore() {
    if (status === 'reports') return
    setLoadingMore(true)
    try {
      const page = await adminListMatrimony({
        status,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[AdminMatrimony] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more profiles.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && rows.length < total
  const showReviewed = status !== 'pending'

  const tabStrip = (
    <TabStrip
      tabs={TABS}
      active={status}
      onChange={(key) => {
        const next = new URLSearchParams(searchParams)
        if (key === 'pending') next.delete('status')
        else next.set('status', key)
        setSearchParams(next, { replace: true })
      }}
      label="Matrimony profile status"
    />
  )

  if (status === 'reports') {
    return (
      <div className="flex flex-col gap-4">
        {tabStrip}
        <MatrimonyReports />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {tabStrip}

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name or member ID"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading profiles…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'profile' : 'profiles'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            empty={
              debouncedSearch
                ? 'No profiles match.'
                : status === 'pending'
                  ? 'Nothing waiting for review.'
                  : 'No profiles here.'
            }
            primary={{
              header: 'Member',
              cell: (row) => (
                <div className="min-w-0">
                  <p className="font-medium">{row.full_name}</p>
                  {row.member_code && (
                    <p className="text-xs tracking-wide text-[var(--color-text-muted)]">
                      {row.member_code}
                    </p>
                  )}
                  {row.ineligible_reason && (
                    <p className="mt-1 text-xs text-[var(--color-accent)]">
                      Not eligible: {row.ineligible_reason}
                    </p>
                  )}
                </div>
              ),
            }}
            columns={[
              {
                key: 'who',
                header: 'Gender · age',
                cell: (row) => [row.gender, row.age].filter((v) => v !== null).join(' · ') || '—',
              },
              {
                key: 'place',
                header: 'Location',
                cell: (row) => [row.current_city, row.current_state].filter(Boolean).join(', ') || '—',
              },
              { key: 'gotra', header: 'Gotra', cell: (row) => row.gotra ?? '—' },
              { key: 'photos', header: 'Photos', align: 'right', cell: (row) => row.photo_count },
              {
                key: 'when',
                header: showReviewed ? 'Reviewed' : 'Submitted',
                align: 'right',
                cell: (row) =>
                  formatAdminDate(showReviewed ? row.reviewed_at : row.submitted_at) ?? '—',
              },
            ]}
            detail={(row) =>
              showReviewed && row.review_note ? (
                <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                  {row.reviewed_by_name ? `${row.reviewed_by_name}: ` : ''}
                  {row.review_note}
                </p>
              ) : null
            }
            actions={(row) => (
              <Link
                to={`/admin/matrimony/${row.id}`}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)]"
              >
                {status === 'pending' ? 'Review' : 'View'}
              </Link>
            )}
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
