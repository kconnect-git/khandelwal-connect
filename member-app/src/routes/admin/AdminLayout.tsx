import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAdmin } from '../../context/AdminContext'
import { ADMIN_ROLE_LABELS } from '../../lib/admin'

// Phase 5b-1: the console shell around every /admin/* page. The one UI admin
// gate lives here (it used to be AdminApprovals'), so the pages under it can
// assume an admin -- and every admin RPC re-checks on the server regardless.
//
// The section nav is pill links rather than a TabStrip: Approvals has its own
// underlined Members / Events tabs underneath, and two underlined strips
// stacked read as one confusing row. (5b-2) Events has no pill of its own:
// its queue is the Events tab inside Approvals.

const SECTIONS: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/approvals', label: 'Approvals' },
  { to: '/admin/members', label: 'Members' },
  { to: '/admin/businesses', label: 'Businesses' },
  { to: '/admin/notices', label: 'Notices' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/admins', label: 'Admins' },
]

export function AdminLayout() {
  const { role, isAdmin, loading } = useAdmin()

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
    // on a laptop the columns need the room. Mobile is unaffected.
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-5xl mx-auto w-full">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Admin</h1>
        {role && (
          <span className="text-xs tracking-wide text-[var(--color-text-muted)] uppercase">
            {ADMIN_ROLE_LABELS[role]}
          </span>
        )}
      </div>

      <nav
        aria-label="Admin sections"
        className="flex gap-2 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              `shrink-0 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white font-medium'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)]'
              }`
            }
          >
            {section.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  )
}
