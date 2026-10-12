import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar } from '../Avatar'
import { TabStrip } from '../TabStrip'
import { DataTable } from './DataTable'
import { adminListMembers } from '../../lib/admin'
import { useAdmin } from '../../context/AdminContext'
import { useMemberDecision } from '../../hooks/useMemberDecision'
import type { AdminMemberRow, MemberStatus } from '../../types/database'

const PAGE_SIZE = 20

// The four tabs are the reviewable statuses. 'onboarding' is deliberately not
// one: those people haven't finished the wizard, so there is nothing to
// review and admin_set_member_status refuses them anyway.
type QueueStatus = Extract<MemberStatus, 'pending' | 'info_requested' | 'approved' | 'rejected'>

const TABS: { key: QueueStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'info_requested', label: 'More info' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Not approved' },
]

const EMPTY_MESSAGES: Record<QueueStatus, string> = {
  pending: 'Nothing waiting for review.',
  info_requested: 'Nobody has been asked for more information.',
  approved: 'No approved members yet.',
  rejected: 'Nobody has been turned down.',
}

function isQueueStatus(value: string | null): value is QueueStatus {
  return TABS.some((tab) => tab.key === value)
}

const SUBMITTED_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  return SUBMITTED_FORMAT.format(new Date(iso))
}

/** Phase 5a: the member approval queue, one panel of the Approvals section.
 * AdminLayout does the UI admin gate (5b-1) -- admin_list_members /
 * admin_set_member_status re-check is_admin() on the server anyway, and
 * revoking additionally re-checks the super_admin role. The decision dialog
 * and email sequence live in useMemberDecision, shared with the member
 * detail screen. */
export function MemberApprovals({ onChanged }: { onChanged?: () => void }) {
  const { role } = useAdmin()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const status: QueueStatus = isQueueStatus(statusParam) ? statusParam : 'pending'

  const [rows, setRows] = useState<AdminMemberRow[]>([])
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
    const page = await adminListMembers({ status, search: debouncedSearch, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [status, debouncedSearch])

  const decision = useMemberDecision({
    onDecided: async () => {
      await load()
      onChanged?.()
    },
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[MemberApprovals] failed to load members', err)
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
      const page = await adminListMembers({
        status,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[MemberApprovals] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more members.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && rows.length < total
  // The two archive tabs show when a decision was made; the queues show how
  // long someone has been waiting.
  const reviewedTab = status === 'approved' || status === 'rejected'

  return (
    <div className="flex flex-col gap-5">
      <TabStrip
        tabs={TABS}
        active={status}
        onChange={(key) => {
          // Merge rather than replace: the parent's ?tab= lives in the same
          // query string and must survive a status change.
          const next = new URLSearchParams(searchParams)
          if (key === 'pending') next.delete('status')
          else next.set('status', key)
          setSearchParams(next, { replace: true })
        }}
        label="Member review queue"
      />

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name, member ID or mobile"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      {(error ?? decision.error) && (
        <p className="text-sm text-[var(--color-accent)]">{error ?? decision.error}</p>
      )}
      {decision.emailNote}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading members…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {debouncedSearch ? 'No members match your search.' : EMPTY_MESSAGES[status]}
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            {total} {total === 1 ? 'member' : 'members'}
          </p>
          <DataTable
            rows={rows}
            rowKey={(member) => member.id}
            empty={EMPTY_MESSAGES[status]}
            primary={{
              header: 'Member',
              cell: (member) => (
                <div className="flex items-start gap-2.5">
                  <Avatar name={member.full_name} photoUrl={member.profile_photo_url} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium">{member.full_name}</p>
                    {member.member_code && (
                      <p className="text-xs tracking-wide text-[var(--color-text-muted)]">
                        {member.member_code}
                      </p>
                    )}
                  </div>
                </div>
              ),
            }}
            columns={[
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
                key: 'when',
                header: reviewedTab ? 'Reviewed' : 'Submitted',
                align: 'right',
                cell: (member) =>
                  formatWhen(reviewedTab ? member.reviewed_at : member.submitted_at) ?? '—',
              },
            ]}
            detail={(member) =>
              member.admin_message ? (
                <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                  {member.admin_message}
                </p>
              ) : null
            }
            actions={(member) => {
              const busy = decision.busyId === member.id
              const canRevoke = status === 'approved' && role === 'super_admin'
              return (
                <>
                  {status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => decision.approve(member)}
                      disabled={busy}
                      className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => decision.requestInfo(member)}
                      disabled={busy}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    >
                      Request info
                    </button>
                  )}
                  {status !== 'rejected' && (status !== 'approved' || canRevoke) && (
                    <button
                      type="button"
                      onClick={() => decision.reject(member)}
                      disabled={busy}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    >
                      {status === 'approved' ? 'Revoke' : 'Turn down'}
                    </button>
                  )}
                  <Link
                    to={`/admin/members/${member.id}`}
                    className="text-sm whitespace-nowrap text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                  >
                    View
                  </Link>
                </>
              )
            }}
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

      {decision.dialog}
    </div>
  )
}
