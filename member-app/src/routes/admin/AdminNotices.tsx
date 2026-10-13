import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TabStrip } from '../../components/TabStrip'
import { DataTable } from '../../components/admin/DataTable'
import { formatAdminDate } from '../../lib/admin'
import {
  adminDeleteNotice,
  adminListNotices,
  adminSetNoticeStatus,
  audienceSummary,
  noticeAudience,
} from '../../lib/notices'
import type { AdminNoticeRow, NoticeStatus } from '../../types/database'

// Phase 5c: the console's notices. Drafts / Published / Withdrawn tabs;
// editing happens in AdminNoticeEditor.

const PAGE_SIZE = 25

const TABS: { key: NoticeStatus; label: string }[] = [
  { key: 'draft', label: 'Drafts' },
  { key: 'published', label: 'Published' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

const EMPTY_MESSAGES: Record<NoticeStatus, string> = {
  draft: 'No drafts.',
  published: 'Nothing published yet.',
  withdrawn: 'Nothing withdrawn.',
}

function isNoticeStatus(value: string | null): value is NoticeStatus {
  return TABS.some((tab) => tab.key === value)
}

function isExpired(notice: AdminNoticeRow): boolean {
  return notice.expires_at !== null && new Date(notice.expires_at) <= new Date()
}

type PendingAction = { notice: AdminNoticeRow; kind: 'publish' | 'withdraw' | 'delete' }

export function AdminNotices() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  // Published is the default: it's what an admin most often checks on.
  const status: NoticeStatus = isNoticeStatus(statusParam) ? statusParam : 'published'

  const [rows, setRows] = useState<AdminNoticeRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    const page = await adminListNotices({ status, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [status])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminNotices] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading notices.')
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
      const page = await adminListNotices({ status, limit: PAGE_SIZE, offset: rows.length })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[AdminNotices] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more notices.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function run(pending: PendingAction) {
    setBusyId(pending.notice.id)
    setError(null)
    try {
      if (pending.kind === 'publish') await adminSetNoticeStatus(pending.notice.id, 'published')
      else if (pending.kind === 'withdraw') await adminSetNoticeStatus(pending.notice.id, 'withdrawn')
      else await adminDeleteNotice(pending.notice.id)
      setAction(null)
      await load()
    } catch (err) {
      console.error('[AdminNotices] action failed', err)
      setError(err instanceof Error ? err.message : 'Could not update this notice.')
      setAction(null)
    } finally {
      setBusyId(null)
    }
  }

  const dialog = action
    ? action.kind === 'publish'
      ? {
          title: `Publish "${action.notice.title}"?`,
          description: `It goes out to ${action.notice.reach_count} ${
            action.notice.reach_count === 1 ? 'member' : 'members'
          } straight away.`,
          confirmLabel: 'Publish',
          accent: true,
        }
      : action.kind === 'withdraw'
        ? {
            title: `Withdraw "${action.notice.title}"?`,
            description: 'Members stop seeing it immediately. This can’t be undone.',
            confirmLabel: 'Withdraw',
            accent: false,
          }
        : {
            title: `Delete the draft "${action.notice.title}"?`,
            description: undefined,
            confirmLabel: 'Delete draft',
            accent: false,
          }
    : { title: '', description: undefined, confirmLabel: 'Confirm', accent: false }

  return (
    <div className="flex flex-col gap-4">
      <TabStrip
        tabs={TABS}
        active={status}
        onChange={(key) =>
          setSearchParams(key === 'published' ? new URLSearchParams() : { status: key }, {
            replace: true,
          })
        }
        label="Notice status"
      />
      <Link
        to="/admin/notices/new"
        className="self-start rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]"
      >
        New notice
      </Link>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading notices…</p>
      ) : (
        <>
          <DataTable
            rows={rows}
            rowKey={(notice) => notice.id}
            empty={EMPTY_MESSAGES[status]}
            primary={{
              header: 'Notice',
              cell: (notice) => (
                <div className="min-w-0">
                  <Link
                    to={`/admin/notices/${notice.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {notice.title}
                  </Link>
                  {status === 'published' && isExpired(notice) && (
                    <span className="ml-2 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--color-text-muted)] uppercase">
                      Expired
                    </span>
                  )}
                  <p className="text-xs text-[var(--color-text-muted)] line-clamp-1">{notice.body}</p>
                </div>
              ),
            }}
            columns={[
              {
                key: 'audience',
                header: 'Audience',
                cell: (notice) => audienceSummary(noticeAudience(notice)),
              },
              {
                key: 'reach',
                header: status === 'draft' ? 'Would reach' : 'Read',
                align: 'right',
                cell: (notice) =>
                  status === 'draft'
                    ? `${notice.reach_count}`
                    : `${notice.read_count} / ${notice.reach_count}`,
              },
              {
                key: 'when',
                header:
                  status === 'draft' ? 'Edited' : status === 'published' ? 'Published' : 'Withdrawn',
                align: 'right',
                cell: (notice) =>
                  formatAdminDate(
                    status === 'draft'
                      ? notice.updated_at
                      : status === 'published'
                        ? notice.published_at
                        : notice.withdrawn_at,
                  ) ?? '—',
              },
              {
                key: 'expires',
                header: 'Until',
                align: 'right',
                cell: (notice) => formatAdminDate(notice.expires_at) ?? 'Withdrawn',
              },
            ]}
            actions={(notice) => {
              const busy = busyId === notice.id
              if (status === 'withdrawn') return null
              return (
                <>
                  {status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => setAction({ notice, kind: 'publish' })}
                      disabled={busy || isExpired(notice)}
                      className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                    >
                      Publish
                    </button>
                  )}
                  <Link
                    to={`/admin/notices/${notice.id}`}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)]"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      setAction({ notice, kind: status === 'draft' ? 'delete' : 'withdraw' })
                    }
                    disabled={busy}
                    className="px-1 text-sm whitespace-nowrap text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
                  >
                    {status === 'draft' ? 'Delete' : 'Withdraw'}
                  </button>
                </>
              )
            }}
          />

          {total !== null && rows.length < total && (
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

      <ConfirmDialog
        open={action !== null}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        confirmAccent={dialog.accent}
        busy={busyId !== null}
        onConfirm={() => {
          if (action) run(action)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
