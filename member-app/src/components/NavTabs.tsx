import { Link, useLocation } from 'react-router-dom'

type Tab = {
  to: string
  label: string
  icon: (props: { size: number }) => React.ReactNode
}

function HomeIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function DirectoryIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function FamilyIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  )
}

const TABS: Tab[] = [
  { to: '/dashboard', label: 'Home', icon: HomeIcon },
  { to: '/directory', label: 'Directory', icon: DirectoryIcon },
  { to: '/family-details', label: 'Family', icon: FamilyIcon },
]

function isActive(pathname: string, to: string): boolean {
  // /directory also covers /members/:id -- a member profile is reached from
  // the directory, so the tab stays lit there.
  if (to === '/directory') return pathname.startsWith('/directory') || pathname.startsWith('/members')
  return pathname.startsWith(to)
}

/** Inline nav links for the desktop header (hidden on mobile). */
export function HeaderNav() {
  const { pathname } = useLocation()

  return (
    <nav className="hidden sm:flex items-center gap-1" aria-label="Primary">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.to)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'text-[var(--color-accent)] font-medium'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Fixed bottom tab bar for mobile (hidden on sm+). */
export function BottomTabs() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-10 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.to)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
              active
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <tab.icon size={20} />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
