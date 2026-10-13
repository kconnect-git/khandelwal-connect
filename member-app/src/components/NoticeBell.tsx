import { Link } from 'react-router-dom'
import { useNotices } from '../context/NoticesContext'

// Phase 5c: header bell -> /notices, with an unread badge. It lives in the
// header rather than the tab bar, which is already at its width limit.

export function NoticeBell() {
  const { unreadCount } = useNotices()
  const label =
    unreadCount > 0 ? `Notices, ${unreadCount} unread` : 'Notices'

  return (
    <Link
      to="/notices"
      aria-label={label}
      title={label}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-none text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  )
}
