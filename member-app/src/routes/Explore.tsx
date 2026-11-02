import { BusinessIcon, EventsIcon, MatrimonyIcon } from '../components/NavTabs'
import { SectionTiles, Svg, type IconProps, type Section } from '../components/SectionTiles'
import { useMatrimony } from '../context/MatrimonyContext'

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

const SECTIONS: Section[] = [
  { label: 'Business', blurb: 'Find and list community businesses', icon: BusinessIcon, tone: 'warm', to: '/business' },
  { label: 'Career', blurb: 'Jobs, mentors, and internships', icon: TrendIcon, tone: 'cool' },
  { label: 'Matrimonial', blurb: 'Verified profiles, family-first privacy', icon: MatrimonyIcon, tone: 'warm', to: '/matrimony' },
  { label: 'Incubation club', blurb: 'Pitch ideas, meet mentors', icon: BulbIcon, tone: 'cool' },
  { label: 'Youth club', blurb: 'Meet-ups, sports, volunteering', icon: BoltIcon, tone: 'warm' },
  { label: 'Events', blurb: 'Gatherings across all chapters', icon: EventsIcon, tone: 'cool', to: '/events' },
]

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

      <SectionTiles
        sections={SECTIONS}
        newCountFor={(section) => (section.to === '/matrimony' ? matrimonyCount : 0)}
      />
    </div>
  )
}
