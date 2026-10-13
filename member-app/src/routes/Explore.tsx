import { Link } from 'react-router-dom'
import { BusinessIcon, EventsIcon, MatrimonyIcon } from '../components/NavTabs'
import { useMatrimony } from '../context/MatrimonyContext'

type IconProps = { size: number }

function Svg({ size, children }: IconProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  )
}

function TrendIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </Svg>
  )
}

function BulbIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </Svg>
  )
}

function BoltIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  )
}

type Section = {
  label: string
  blurb: string
  icon: (props: IconProps) => React.ReactNode
  tone: 'warm' | 'cool'
  /** Live sections link somewhere; the rest are shown as "Soon" and inert. */
  to?: string
}

const SECTIONS: Section[] = [
  { label: 'Business', blurb: 'Find and list community businesses', icon: BusinessIcon, tone: 'warm', to: '/businesses' },
  { label: 'Career', blurb: 'Jobs, mentors, and internships', icon: TrendIcon, tone: 'cool' },
  { label: 'Matrimonial', blurb: 'Verified profiles, family-first privacy', icon: MatrimonyIcon, tone: 'warm', to: '/matrimony' },
  { label: 'Incubation club', blurb: 'Pitch ideas, meet mentors', icon: BulbIcon, tone: 'cool' },
  { label: 'Youth club', blurb: 'Meet-ups, sports, volunteering', icon: BoltIcon, tone: 'warm' },
  { label: 'Events', blurb: 'Gatherings across all chapters', icon: EventsIcon, tone: 'cool', to: '/events' },
]

const CHIP_CLASSES: Record<Section['tone'], string> = {
  warm: 'bg-[var(--color-chip-warm-bg)] text-[var(--color-chip-warm-fg)]',
  cool: 'bg-[var(--color-chip-cool-bg)] text-[var(--color-chip-cool-fg)]',
}

/** Green "Live" / amber "Soon" pill. */
function SectionBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
        live
          ? 'bg-[var(--color-badge-live-bg)] text-[var(--color-badge-live-fg)]'
          : 'bg-[var(--color-badge-soon-bg)] text-[var(--color-badge-soon-fg)]'
      }`}
    >
      {live ? 'Live' : 'Soon'}
    </span>
  )
}

/** (6b) Accent "N new" pill, in place of Live, when a section has news. */
function NewBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-accent)] px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap">
      {count > 9 ? '9+' : count} new
    </span>
  )
}

function TileBody({ section, newCount = 0 }: { section: Section; newCount?: number }) {
  const live = section.to !== undefined
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${CHIP_CLASSES[section.tone]}`}
        >
          <section.icon size={22} />
        </span>
        {newCount > 0 ? <NewBadge count={newCount} /> : <SectionBadge live={live} />}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold leading-tight">{section.label}</h2>
        <p className="text-sm text-[var(--color-text-muted)] leading-snug">{section.blurb}</p>
      </div>
    </>
  )
}

const TILE =
  'flex h-full flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4'

/** Mobile landing for every community section. Business and Events moved off
 * the bottom bar into here so the bar stays at four tabs (five for admins). */
export function Explore() {
  const { badgeCount: matrimonyCount } = useMatrimony()
  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold">Explore</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Business, careers, rishtey, startups, and youth, all inside the Khandelwal network.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {SECTIONS.map((section) => (
          <li key={section.label}>
            {section.to ? (
              <Link
                to={section.to}
                className={`${TILE} hover:bg-[var(--color-surface-hover)] transition-colors`}
              >
                <TileBody
                  section={section}
                  newCount={section.to === '/matrimony' ? matrimonyCount : 0}
                />
              </Link>
            ) : (
              <div className={TILE} aria-disabled="true">
                <TileBody section={section} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
