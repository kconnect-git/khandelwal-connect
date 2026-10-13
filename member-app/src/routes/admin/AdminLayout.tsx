import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { ADMIN_ROLE_LABELS } from '../../lib/admin'

// Phase 5b-1: the console shell around every /admin/* page. The one UI admin
// gate lives here (it used to be AdminApprovals'), so the pages under it can
// assume an admin -- and every admin RPC re-checks on the server regardless.
//
// The section nav is not a TabStrip: Approvals has its own underlined
// Members / Events tabs underneath, and two underlined strips stacked read as
// one confusing row. (5b-2) Events has no section of its own: its queue is
// the Events tab inside Approvals.
//
// (6a) Eight sections outgrew the sideways-scrolling pill row, so it is now
// a sidebar from `md:` up and a "Section" dropdown on a phone.

const SECTIONS: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/approvals', label: 'Approvals' },
  { to: '/admin/members', label: 'Members' },
  { to: '/admin/businesses', label: 'Businesses' },
  { to: '/admin/notices', label: 'Notices' },
  { to: '/admin/matrimony', label: 'Matrimony' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/admins', label: 'Admins' },
]

/** The section the current path belongs to (detail pages included). */
function activeSection(pathname: string): string {
  const match = SECTIONS.filter((section) =>
    section.end ? pathname === section.to : pathname.startsWith(section.to),
  ).sort((a, b) => b.to.length - a.to.length)[0]
  return match?.to ?? '/admin'
}

export function AdminLayout() {
  const { role, isAdmin, loading } = useAdmin()
  const location = useLocation()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="flex-1 flex flex-col px-5 py-10 max-w-2xl mx-auto w-full">
        <p className="text-sm text-[var(--color-text-muted)]">Checking access…</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Not authorised</h1>
        <p className="text-[var(--color-text-muted)]">This page is for admins only.</p>
        <Link
          to="/"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to home
        </Link>
      </div>
    )
  }

  return (
    // Wider than the member-facing pages (max-w-2xl): these are tables, and
    // on a laptop the columns need the room -- (6a) more so beside the
    // sidebar. Mobile is unaffected.
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-6xl mx-auto w-full">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Admin</h1>
        {role && (
          <span className="text-xs tracking-wide text-[var(--color-text-muted)] uppercase">
            {ADMIN_ROLE_LABELS[role]}
          </span>
        )}
      </div>

      {/* Phone: one dropdown instead of a row of eight pills. */}
      <label className="flex items-center gap-3 md:hidden">
        <span className="text-sm text-[var(--color-text-muted)]">Section</span>
        <select
          value={activeSection(location.pathname)}
          onChange={(event) => navigate(event.target.value)}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
        >
          {SECTIONS.map((section) => (
            <option key={section.to} value={section.to}>
              {section.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-8">
        <nav aria-label="Admin sections" className="hidden w-40 shrink-0 md:block">
          <ul className="sticky top-4 flex flex-col gap-1">
            {SECTIONS.map((section) => (
              <li key={section.to}>
                <NavLink
                  to={section.to}
                  end={section.end}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-[var(--color-accent)] text-white font-medium'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
                    }`
                  }
                >
                  {section.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
