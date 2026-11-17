import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RequestAccessControl } from '../LockedFeature'
import { useServiceAccess } from '../../context/ServiceAccessContext'
import { PAID_SERVICE_LABELS, PAID_SERVICE_PATHS } from '../../lib/serviceAccess'

// Phase 11.3: "My access" on the Profile page -- a section above the tabs,
// not a tab of its own (the tabs are profile data). Hidden entirely while
// there's nothing to say: every paywall off and no access held or asked for.

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function MyAccessSection() {
  const { services, anythingToShow } = useServiceAccess()
  // Read once per mount: "ends within a week" doesn't need to tick live.
  const [now] = useState(() => Date.now())
  if (!anythingToShow) return null

  return (
    <section className="w-full flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
        My access
      </h2>
      <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {services.map((row) => {
          const label = PAID_SERVICE_LABELS[row.service]
          let status: string
          if (row.is_admin) status = 'Included for admins'
          else if (row.ends_at) status = `Until ${DATE_FORMAT.format(new Date(row.ends_at))}`
          else if (!row.enforced) status = 'Free for everyone right now'
          else if (row.expired_at) status = `Ended ${DATE_FORMAT.format(new Date(row.expired_at))}`
          else status = 'Not included'

          // Request while locked, or to renew in the last week; never for
          // admins or while a paywall is off and nothing is held.
          const endsSoon =
            row.ends_at !== null && new Date(row.ends_at).getTime() - now < RENEW_WINDOW_MS
          const canRequest =
            !row.is_admin &&
            (row.enforced || row.ends_at !== null) &&
            (!row.has_access || endsSoon || row.open_request_at !== null)
          return (
            <li key={row.service} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <Link
                  to={PAID_SERVICE_PATHS[row.service]}
                  className="text-sm font-medium underline-offset-2 hover:underline"
                >
                  {label}
                </Link>
                <span className="text-sm text-[var(--color-text-muted)]">{status}</span>
              </div>
              {canRequest && <RequestAccessControl service={row.service} compact />}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-[var(--color-text-muted)]">
        Access is monthly and arranged with the committee by email. You can ask to renew here in
        the last week before it ends.
      </p>
    </section>
  )
}
