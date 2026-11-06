import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EventsIcon } from '../components/NavTabs'
import { SectionTiles, Svg, type IconProps, type Section } from '../components/SectionTiles'

// (10.1) KC Business hub: one landing page for every business module. Each
// Soon tile gets a `to` in the sub-phase that builds it (see
// phase-10-plan.md): the directory in 10.1, Buy & Sell in 10.6, Referrals
// in 10.7, the dashboard in 10.8.

function DirectoryIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M8 17c.6-1.8 2.2-3 4-3s3.4 1.2 4 3" />
    </Svg>
  )
}

function SwapIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 8h14" />
      <path d="m15 4 4 4-4 4" />
      <path d="M20 16H6" />
      <path d="m9 12-4 4 4 4" />
    </Svg>
  )
}

function ReferralIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M19 8v6" />
      <path d="M16 11h6" />
    </Svg>
  )
}

function BoxIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </Svg>
  )
}

function ChartIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3 3v18h18" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-8" />
    </Svg>
  )
}

function SearchIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  )
}

const SECTIONS: Section[] = [
  { label: 'Business Directory', blurb: 'Discover members and companies', icon: DirectoryIcon, tone: 'cool', to: '/businesses' },
  { label: 'Buy & Sell', blurb: 'Requirements and offers', icon: SwapIcon, tone: 'warm', to: '/business/market' },
  { label: 'Referrals', blurb: 'Give, receive and track', icon: ReferralIcon, tone: 'cool', to: '/business/referrals' },
  { label: 'Products & Services', blurb: 'Company catalogues', icon: BoxIcon, tone: 'warm' },
  { label: 'Meetings & Events', blurb: 'Network and connect', icon: EventsIcon, tone: 'cool' },
  { label: 'My Business Dashboard', blurb: 'My leads and opportunities', icon: ChartIcon, tone: 'warm', to: '/business/dashboard' },
]

export function BusinessHub() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = search.trim()
    navigate(query ? `/businesses?q=${encodeURIComponent(query)}` : '/businesses')
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      {/* Mobile reaches this page through the Explore tab, so lead back there.
          Desktop has Businesses in its header and no Explore page. */}
      <Link
        to="/explore"
        className="sm:hidden text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Explore
      </Link>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold">KC Business</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Discover. Connect. Grow.</p>
        </div>
        <form
          onSubmit={handleSubmit}
          role="search"
          className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)]"
        >
          <span className="text-[var(--color-text-muted)]">
            <SearchIcon size={18} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business, product, industry, city…"
            aria-label="Search businesses"
            className="flex-1 min-w-0 bg-transparent py-2.5 outline-none"
          />
        </form>
      </section>

      <SectionTiles sections={SECTIONS} />
    </div>
  )
}
