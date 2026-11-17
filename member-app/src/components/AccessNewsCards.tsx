import { Link } from 'react-router-dom'
import { useServiceAccess } from '../context/ServiceAccessContext'
import { PAID_SERVICE_LABELS, PAID_SERVICE_PATHS } from '../lib/serviceAccess'

// Phase 11.3: "You now have Matrimony access until 17 Dec 2026" on Home, one
// card per service with an unseen grant, until dismissed (stored on the
// grant, so it stays dismissed on every device). Stands in for a personal
// notification, which the app doesn't have yet.
//
// Not the accent: the membership card is this screen's one vermilion element.

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function AccessNewsCards() {
  const { news, dismissNews } = useServiceAccess()
  if (news.length === 0) return null

  return (
    <div className="w-full flex flex-col gap-2">
      {news.map((item) => {
        const label = PAID_SERVICE_LABELS[item.service]
        const until = DATE_FORMAT.format(new Date(item.ends_at))
        return (
          <div
            key={item.service}
            className="w-full flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm">
                <span className="font-medium">
                  {item.extended ? `${label} access extended` : `You now have ${label} access`}
                </span>
                <span className="text-[var(--color-text-muted)]"> · until {until}</span>
              </p>
              <Link
                to={PAID_SERVICE_PATHS[item.service]}
                onClick={() => dismissNews(item.service)}
                className="self-start text-sm text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
              >
                Open {label} ›
              </Link>
            </div>
            <button
              type="button"
              onClick={() => dismissNews(item.service)}
              aria-label={`Dismiss ${label} access message`}
              className="shrink-0 rounded-lg px-2 py-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
