import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotices } from '../context/NoticesContext'
import { listMyNotices, markNoticesRead } from '../lib/notices'
import type { MemberNoticeRow } from '../types/database'

// Phase 5c: the dashboard's unread notices, up to three, each dismissable
// (which marks it read). Renders nothing when there is nothing unread.

const MAX_SHOWN = 3

export function NoticeStrip() {
  const { refresh } = useNotices()
  const [unread, setUnread] = useState<MemberNoticeRow[]>([])
  const [more, setMore] = useState(0)

  useEffect(() => {
    let cancelled = false
    listMyNotices({ activeOnly: true, limit: 20 })
      .then((page) => {
        if (cancelled) return
        const pending = page.filter((notice) => !notice.is_read)
        setUnread(pending.slice(0, MAX_SHOWN))
        setMore(Math.max(pending.length - MAX_SHOWN, 0))
      })
      .catch((err) => console.error('[NoticeStrip] failed to load', err))
    return () => {
      cancelled = true
    }
  }, [])

  async function dismiss(noticeId: string) {
    setUnread((current) => current.filter((notice) => notice.id !== noticeId))
    try {
      await markNoticesRead(noticeId)
      refresh()
    } catch (err) {
      // Optimistic; at worst it shows again on the next visit.
      console.error('[NoticeStrip] failed to mark read', err)
    }
  }

  if (unread.length === 0) return null

  return (
    <section className="w-full flex flex-col gap-2" aria-label="New notices">
      {unread.map((notice) => (
        <div
          key={notice.id}
          className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium break-words">{notice.title}</p>
            <button
              type="button"
              onClick={() => dismiss(notice.id)}
              className="shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)] whitespace-pre-line line-clamp-3 break-words">
            {notice.body}
          </p>
        </div>
      ))}
      <Link
        to="/notices"
        className="self-end text-sm text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
      >
        {more > 0 ? `${more} more · all notices` : 'All notices'}
      </Link>
    </section>
  )
}
