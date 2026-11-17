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
  adminListAccessRequests,
} from '../../lib/serviceAccess'
import type { AccessRequestStatus, AdminAccessRequestRow, PaidService } from '../../types/database'

// Phase 11.2: the "Request access" queue, the Requests tab of /admin/access.
// Open requests are oldest first. The admin emails the member (address and
// Copy here), settles payment outside the app, then Gives access -- which
// closes the request -- or Dismisses it.

const PAGE_SIZE = 25

const STATUS_OPTIONS: { key: AccessRequestStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'granted', label: 'Granted' },
  { key: 'dismissed', label: 'Dismissed' },
]

export function AccessRequests({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<AccessRequestStatus>('open')
  const [service, setService] = useState<PaidService | ''>('')
  const [rows, setRows] = useState<AdminAccessRequestRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const page = await adminListAccessRequests({
      status,
      service: service || null,
      limit: PAGE_SIZE,
    })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [status, service])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AccessRequests] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading requests.')
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
      const page = await adminListAccessRequests({
        status,
        service: service || null,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more requests.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && rows.length < total
  const target = (row: AdminAccessRequestRow) => ({
    personId: row.person_id,
    fullName: row.full_name,
    service: row.service,
    currentEndsAt: row.access_ends_at,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <PillChoice options={STATUS_OPTIONS} value={status} onChange={setStatus} label="Request status" />
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
        <p className="text-sm text-[var(--color-text-muted)]">Loading requests…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'request' : 'requests'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            empty={
              status === 'open'
                ? 'No one is waiting for access.'
                : status === 'granted'
                  ? 'No granted requests yet.'
                  : 'No dismissed requests.'
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
                key: 'contact',
                header: 'Contact',
                cell: (row) => <AccessContact email={row.email} mobile={row.mobile_number} />,
              },
              {
                key: 'access',
                header: 'Has access until',
                cell: (row) => formatAdminDate(row.access_ends_at) ?? 'No access',
              },
              {
                key: 'when',
                header: status === 'open' ? 'Requested' : 'Handled',
                align: 'right',
                cell: (row) =>
                  status === 'open' ? (
                    formatAdminDate(row.requested_at)
                  ) : (
                    <span>
                      {formatAdminDate(row.handled_at) ?? '—'}
                      {row.handled_by_name && (
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {row.handled_by_name}
                        </span>
                      )}
                    </span>
                  ),
              },
            ]}
            detail={(row) =>
              row.message || row.handled_note ? (
                <div className="flex flex-col gap-2">
                  {row.message && (
                    <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                      {row.message}
                    </p>
                  )}
                  {row.handled_note && (
                    <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-line">
                      {row.handled_by_name ? `${row.handled_by_name}: ` : ''}
                      {row.handled_note}
                    </p>
                  )}
                </div>
              ) : null
            }
            actions={
              status === 'open'
                ? (row) => (
                    <>
                      <button
                        type="button"
                        disabled={actions.busy}
                        onClick={() => actions.grant(target(row))}
                        className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                      >
                        {row.access_ends_at ? 'Extend' : 'Give access'}
                      </button>
                      <button
                        type="button"
                        disabled={actions.busy}
                        onClick={() => actions.dismiss(row.id, target(row))}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </>
                  )
                : undefined
            }
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
