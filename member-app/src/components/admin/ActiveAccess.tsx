import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChipSelect } from '../ChipSelect'
import { AccessContact } from './AccessContact'
import { DataTable } from './DataTable'
import { PillChoice } from './PillChoice'
import { useAccessActions } from '../../hooks/useAccessActions'
import { formatAdminDate } from '../../lib/admin'
import {
  PAID_SERVICES,
  PAID_SERVICE_LABELS,
  adminListServiceAccess,
} from '../../lib/serviceAccess'
import type { AdminServiceAccessRow, PaidService } from '../../types/database'

// Phase 11.2: members holding access right now, the "With access" tab of
// /admin/access. Soonest to run out first, so renewals are at the top;
// "Ending in 7 days" narrows to those. Extend / Remove per row.

const PAGE_SIZE = 25
const EXPIRING_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

type Range = 'all' | 'expiring'

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS))
}

export function ActiveAccess({ onChanged }: { onChanged: () => void }) {
  const [range, setRange] = useState<Range>('all')
  const [service, setService] = useState<PaidService | ''>('')
  const [rows, setRows] = useState<AdminServiceAccessRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback(
    (offset: number) =>
      adminListServiceAccess({
        service: service || null,
        expiringDays: range === 'expiring' ? EXPIRING_DAYS : null,
        limit: PAGE_SIZE,
        offset,
      }),
    [service, range],
  )

  const load = useCallback(async () => {
    const page = await query(0)
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[ActiveAccess] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading access.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  const actions = useAccessActions({
    onChanged: async () => {
      await load()
      onChanged()
    },
  })

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await query(rows.length)
      setRows((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && rows.length < total
  const target = (row: AdminServiceAccessRow) => ({
    personId: row.person_id,
    fullName: row.full_name,
    service: row.service,
    currentEndsAt: row.ends_at,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <PillChoice
          options={[
            { key: 'all' as const, label: 'All' },
            { key: 'expiring' as const, label: `Ending in ${EXPIRING_DAYS} days` },
          ]}
          value={range}
          onChange={setRange}
          label="Which access"
        />
        <ChipSelect
          label="All services"
          value={service}
          onChange={(value) => setService(value as PaidService | '')}
          options={PAID_SERVICES.map((key) => ({ value: key, label: PAID_SERVICE_LABELS[key] }))}
        />
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {actions.feedback}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'member' : 'members'}
              {service === '' && ' (one row per service)'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(row) => `${row.person_id}:${row.service}`}
            empty={
              range === 'expiring'
                ? `No access ends in the next ${EXPIRING_DAYS} days.`
                : 'No one has paid access yet.'
            }
            primary={{
              header: 'Member',
              cell: (row) => (
                <div className="min-w-0">
                  <Link
                    to={`/admin/members/${row.person_id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {row.full_name}
                  </Link>
                  {row.member_code && (
                    <p className="text-xs tracking-wide text-[var(--color-text-muted)]">
                      {row.member_code}
                    </p>
                  )}
                </div>
              ),
            }}
            columns={[
              { key: 'service', header: 'Service', cell: (row) => PAID_SERVICE_LABELS[row.service] },
              {
                key: 'until',
                header: 'Until',
                cell: (row) => {
                  const left = daysLeft(row.ends_at)
                  return (
                    <span>
                      {formatAdminDate(row.ends_at)}
                      {left <= EXPIRING_DAYS && (
                        <span className="block text-xs text-[var(--color-accent)]">
                          {left === 0 ? 'Ends today' : `${left} ${left === 1 ? 'day' : 'days'} left`}
                        </span>
                      )}
                    </span>
                  )
                },
              },
              {
                key: 'contact',
                header: 'Contact',
                cell: (row) => <AccessContact email={row.email} mobile={row.mobile_number} />,
              },
              {
                key: 'granted',
                header: 'Last granted',
                align: 'right',
                cell: (row) => formatAdminDate(row.last_granted_at),
              },
            ]}
            actions={(row) => (
              <>
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => actions.grant(target(row))}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                >
                  Extend
                </button>
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => actions.revoke(target(row))}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                >
                  Remove
                </button>
              </>
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

      {actions.dialog}
    </div>
  )
}
