import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotices } from '../context/NoticesContext'
import { useServiceAccess } from '../context/ServiceAccessContext'
import { listMyNotices, markNoticesRead } from '../lib/notices'
import { formatAdminDate } from '../lib/admin'
import { PAID_SERVICE_LABELS, PAID_SERVICE_PATHS } from '../lib/serviceAccess'
import type { MemberNoticeRow, MyAccessNewsRow } from '../types/database'

// Phase 5c: every notice addressed to this member, newest first. Opening the
// page marks them all read -- the "New" tags come from the state as it was
// loaded, so they stay visible for this visit while the bell clears.
//
// (11.3) "Your access" above the notices: unseen access grants, the same
// news as the Home card. Opening this page marks them seen too (which also
// clears the Home card); they stay listed, marked New, for this visit.

const PAGE_SIZE = 20

export function Notices() {
  const { refresh } = useNotices()
  const [rows, setRows] = useState<MemberNoticeRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { news, loaded: accessLoaded, dismissNews } = useServiceAccess()
  // Snapshot of the access news as first loaded, so it stays on screen after
  // it's marked seen.
  const [accessItems, setAccessItems] = useState<MyAccessNewsRow[] | null>(null)

  useEffect(() => {
    if (!accessLoaded || accessItems !== null) return
    setAccessItems(news)
    for (const item of news) dismissNews(item.service)
  }, [accessLoaded, accessItems, news, dismissNews])

  useEffect(() => {
    let cancelled = false
    listMyNotices({ limit: PAGE_SIZE })
      .then(async (page) => {
        if (cancelled) return
        setRows(page)
        setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
        if (page.some((notice) => !notice.is_read)) {
          await markNoticesRead()
          refresh()
        }
      })
      .catch((err) => {
        console.error('[Notices] failed to load', err)
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load notices.')
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function loadMore() {
    if (!rows) return
    setLoadingMore(true)
    try {
      const page = await listMyNotices({ limit: PAGE_SIZE, offset: rows.length })
      setRows([...rows, ...page])
    } catch (err) {
      console.error('[Notices] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more notices.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">Notices</h1>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {accessItems && accessItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Your access
          </h2>
          <ul className="flex flex-col gap-3">
            {accessItems.map((item) => {
              const label = PAID_SERVICE_LABELS[item.service]
              return (
                <li
                  key={item.service}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-heading text-lg font-semibold break-words">
                      {item.extended ? `${label} access extended` : `You now have ${label} access`}
                    </h3>
                    <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-white">
                      New
                    </span>
                  </div>
                  <p className="text-sm">Until {formatAdminDate(item.ends_at)}.</p>
                  <Link
                    to={PAID_SERVICE_PATHS[item.service]}
                    className="self-start text-sm font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Open {label} ›
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {rows === null ? (
        !error && <p className="text-sm text-[var(--color-text-muted)]">Loading notices…</p>
      ) : rows.length === 0 ? (
        accessItems && accessItems.length > 0 ? null : (
        <p className="text-sm text-[var(--color-text-muted)]">
          No notices yet. Announcements from the samaj will appear here.
        </p>
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((notice) => (
            <li
              key={notice.id}
              className={`flex flex-col gap-2 rounded-xl border bg-[var(--color-surface)] p-4 ${
                !notice.is_read && notice.is_active
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-border)]'
              } ${notice.is_active ? '' : 'opacity-70'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold break-words">{notice.title}</h2>
                {!notice.is_read && notice.is_active && (
                  <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-white">
                    New
                  </span>
                )}
              </div>
              <p className="text-sm whitespace-pre-line break-words">{notice.body}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {formatAdminDate(notice.published_at)}
                {notice.expires_at &&
                  (notice.is_active
                    ? ` · until ${formatAdminDate(notice.expires_at)}`
                    : ' · Expired')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
