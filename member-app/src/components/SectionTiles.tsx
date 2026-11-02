import { Link } from 'react-router-dom'

// (10.1) The Explore tile grid, shared with the KC Business hub so the two
// landing pages look and behave the same.

export type IconProps = { size: number }

export function Svg({ size, children }: IconProps & { children: React.ReactNode }) {
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

export type Section = {
  label: string
  blurb: string
  icon: (props: IconProps) => React.ReactNode
  tone: 'warm' | 'cool'
  /** Live sections link somewhere; the rest are shown as "Soon" and inert. */
  to?: string
}

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

export function SectionTiles({
  sections,
  newCountFor,
}: {
  sections: Section[]
  newCountFor?: (section: Section) => number
}) {
  return (
    <ul className="grid grid-cols-2 gap-3">
      {sections.map((section) => (
        <li key={section.label}>
          {section.to ? (
            <Link
              to={section.to}
              className={`${TILE} hover:bg-[var(--color-surface-hover)] transition-colors`}
            >
              <TileBody section={section} newCount={newCountFor?.(section) ?? 0} />
            </Link>
          ) : (
            <div className={TILE} aria-disabled="true">
              <TileBody section={section} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
