import { Link, useLocation } from 'react-router-dom'
import { useMatrimony } from '../context/MatrimonyContext'

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

function ProfileIcon({ size }: { size: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 19a6 6 0 0 1 11 0" />
    </svg>
  )
}

export function BusinessIcon({ size }: { size: number }) {
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
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M2 13h20" />
    </svg>
  )
}

export function MatrimonyIcon({ size }: { size: number }) {
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

export function EventsIcon({ size }: { size: number }) {
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
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ExploreIcon({ size }: { size: number }) {
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
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function AdminIcon({ size }: { size: number }) {
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
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

const HOME_TAB: Tab = { to: '/dashboard', label: 'Home', icon: HomeIcon }
const DIRECTORY_TAB: Tab = { to: '/directory', label: 'Directory', icon: DirectoryIcon }
const PROFILE_TAB: Tab = { to: '/profile', label: 'Profile', icon: ProfileIcon }
const MATRIMONY_TO = '/matrimony'

const TABS: Tab[] = [
  HOME_TAB,
  DIRECTORY_TAB,
  { to: '/businesses', label: 'Businesses', icon: BusinessIcon },
  { to: '/events', label: 'Events', icon: EventsIcon },
  // (6b) Its own header link on desktop, like Businesses / Events.
  { to: MATRIMONY_TO, label: 'Matrimony', icon: MatrimonyIcon },
  PROFILE_TAB,
]

// The bottom bar folds Businesses, Events and Matrimony (and the
// coming-soon sections) into one Explore tab -- that many tabs is too
// crowded at phone width. The desktop header has the room, so it keeps the
// full list above. (6b) "Desktop" starts at lg (1024px): with Matrimony the
// header row no longer fits on a tablet, so tablets get the bottom bar.
const EXPLORE_TAB: Tab = { to: '/explore', label: 'Explore', icon: ExploreIcon }

const MOBILE_TABS: Tab[] = [HOME_TAB, DIRECTORY_TAB, EXPLORE_TAB, PROFILE_TAB]

// (5a) Admins get a sixth tab after Profile rather than an item in the
// account menu. (5b-1) It lands on the console's Overview; every /admin/*
// path lights this one tab.
const ADMIN_TAB: Tab = { to: '/admin', label: 'Admin', icon: AdminIcon }

function tabsFor(isAdmin: boolean, tabs: Tab[] = TABS): Tab[] {
  return isAdmin ? [...tabs, ADMIN_TAB] : tabs
}

function isActive(pathname: string, to: string): boolean {
  // /directory also covers /members/:id -- a member profile is reached from
  // the directory, so the tab stays lit there. /businesses covers its own
  // /businesses/:id via the plain prefix match.
  if (to === '/directory') return pathname.startsWith('/directory') || pathname.startsWith('/members')
  // Every /admin/* page belongs to the one Admin tab.
  if (to === ADMIN_TAB.to) return pathname.startsWith('/admin')
  // Explore stays lit inside the sections it leads to.
  if (to === EXPLORE_TAB.to) {
    return ['/explore', '/businesses', '/events', MATRIMONY_TO].some((p) => pathname.startsWith(p))
  }
  return pathname.startsWith(to)
}

/** Inline nav links for the desktop header (hidden on mobile). */
export function HeaderNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const { pathname } = useLocation()
  const { badgeCount } = useMatrimony()

  return (
    <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
      {tabsFor(isAdmin).map((tab) => {
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
            {/* (6b) New interests / matches. On phones the Explore tile
                carries this badge instead. */}
            {tab.to === MATRIMONY_TO && badgeCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-xs font-semibold text-white">
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

/** Fixed bottom tab bar for mobile and tablet (hidden on lg+). */
export function BottomTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const { pathname } = useLocation()
  const tabs = tabsFor(isAdmin, MOBILE_TABS)

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-10 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.to)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            // min-w-0 + overflow-hidden matter here: a flex item defaults to
            // min-width:auto, so a label wider than its share would widen the
            // whole bar past the viewport instead of clipping.
            className={`flex-1 min-w-0 overflow-hidden flex flex-col items-center gap-0.5 py-2 text-[11px] whitespace-nowrap transition-colors ${
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
