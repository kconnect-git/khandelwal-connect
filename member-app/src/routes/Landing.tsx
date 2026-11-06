import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '../components/ThemeToggle'
import { FULL_NAME, KiteLogo, TAGLINE_HI, pillPrimary, pillSecondary } from '../components/kite/Brand'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// (KITE) The logged-out landing at /, from kite-landing.html. RootRedirect
// shows it to anonymous visitors only; signed-in members are sent into the
// app as before.

const wrap = 'max-w-[1240px] mx-auto px-4 sm:px-8'
const section = 'py-14 md:py-24'
const label = 'mb-3.5 text-[15px] font-semibold text-[var(--color-chip-warm-fg)]'
const h2 = 'font-heading font-bold tracking-tight text-balance text-[clamp(32px,4vw,52px)] leading-[1.08]'
const muted = 'text-[var(--color-text-muted)]'

const NAV_LINKS = [
  ['about', 'About'],
  ['pillars', 'Pillars'],
  ['mission', 'Mission'],
  ['vision', 'Vision'],
  ['values', 'Values'],
]

// Clears the sticky header when a nav link scrolls to a section -- taller on
// phones, where the section links sit in a second row.
const anchor = 'scroll-mt-32 md:scroll-mt-24'

const PILLARS: { title: string; body: string; tone: 'cool' | 'warm'; icon: ReactNode }[] = [
  {
    title: 'Family Connect',
    body: 'Preserves our family details and lineage, so that future generations know where they come from.',
    tone: 'cool',
    icon: (
      <>
        <rect x="9" y="3" width="6" height="5" rx="1" />
        <rect x="3" y="16" width="6" height="5" rx="1" />
        <rect x="15" y="16" width="6" height="5" rx="1" />
        <path d="M12 8v4M6 16v-4h12v4" />
      </>
    ),
  },
  {
    title: 'Community Connect',
    body: 'Organises our community by state and district, making it easy to find and connect with Khandelwals near you.',
    tone: 'warm',
    icon: (
      <>
        <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </>
    ),
  },
  {
    title: 'Business & Professional Connect',
    body: 'Links our entrepreneurs, professionals and job seekers, so that opportunity stays within the community and grows through it.',
    tone: 'cool',
    icon: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
      </>
    ),
  },
]

const TRUST = [
  ['Verified', 'Every member is verified before joining.'],
  ['Private', 'Personal information is protected and shared only within the community.'],
  ['Community-run', 'KITE is overseen by a community committee.'],
]

const MISSION = [
  ['Unite', 'Every Khandelwal family on one trusted, verified platform.'],
  ['Preserve', 'Our family heritage and lineage for generations to come.'],
  ['Empower', 'Our members through business networking, professional growth and opportunities for youth.'],
  ['Strengthen', 'Community bonds through events, support and active participation in every district.'],
]

const VALUES = [
  ['Trust', 'Every member is verified, and every connection is genuine.'],
  ['Privacy', "Your family's information stays within the community."],
  ['Unity', 'We are one community, whatever our geography.'],
  ['Growth', 'When one of us rises, we rise together.'],
  ['Service', 'KITE is run by the community, for the community.'],
]

export function Landing() {
  useDocumentTitle(`KITE | ${FULL_NAME}`)

  // The nav's #section links glide rather than jump. Set on <html> only while
  // this page is up, so the app's own scroll jumps stay instant, and skipped
  // for people who ask for reduced motion.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    root.style.scrollBehavior = 'smooth'
    return () => {
      root.style.scrollBehavior = ''
    }
  }, [])

  const active = useActiveSection()

  return (
    <div className="min-h-svh flex flex-col text-[17px] leading-relaxed">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <nav aria-label="Main" className={`${wrap} flex flex-wrap items-center gap-x-8 gap-y-3 py-3.5`}>
          <KiteLogo />
          <div className={`hidden md:flex gap-7 text-base ${muted}`}>
            {NAV_LINKS.map(([id, text]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={active === id ? 'true' : undefined}
                className={active === id ? 'text-[var(--color-accent)]' : 'hover:text-[var(--color-text)]'}
              >
                {text}
              </a>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <ThemeToggle />
            <Link to="/signin" className="inline-flex items-center min-h-11 px-3 font-medium hover:text-[var(--color-chip-warm-fg)]">
              Sign in
            </Link>
            {/* Wrapped: pillPrimary's own inline-flex would beat `hidden`. */}
            <span className="hidden md:inline">
              <Link to="/join" className={`${pillPrimary} min-h-11 px-5 text-base`}>
                Join KITE
              </Link>
            </span>
          </div>
        </nav>
        {/* Phones: the section links as a second row, in TabStrip's look
            (sideways scroll, accent underline on the section in view). */}
        <nav
          aria-label="Sections"
          className="md:hidden flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV_LINKS.map(([id, text]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? 'true' : undefined}
              className={`shrink-0 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active === id
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-medium'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {text}
            </a>
          ))}
        </nav>
      </header>

      <main id="top" className="flex-1">
        <section
          className={`${wrap} grid gap-x-18 gap-y-8 items-center lg:grid-cols-2 pt-10 md:pt-18 pb-12 md:pb-20`}
        >
          <div>
            <p lang="hi" className="mb-5 font-hindi font-semibold text-[22px] leading-snug text-[var(--color-chip-warm-fg)]">
              {TAGLINE_HI}
            </p>
            <h1 className="font-heading font-bold text-balance text-[clamp(44px,6.4vw,84px)] leading-[1.02] tracking-[-0.03em]">
              No Khandelwal is a stranger to another.
            </h1>
            <p className={`mt-6 max-w-[34em] text-[clamp(18px,1.6vw,21px)] leading-normal ${muted}`}>
              A trusted, private and verified space for every Khandelwal family to connect, support one
              another and grow together.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/join" className={pillPrimary}>
                Join KITE
              </Link>
              <a href="#about" className={pillSecondary}>
                Learn about us
              </a>
            </div>
            <p className={`mt-6 text-[15px] ${muted}`}>
              {FULL_NAME}. Every member is verified before joining.
            </p>
          </div>
          <KiteIllustration />
        </section>

        <section id="about" className={`${anchor} border-t border-[var(--color-border)]`}>
          <div className={`${wrap} ${section} grid gap-x-22 gap-y-6 lg:grid-cols-2`}>
            <div>
              <p className={label}>About us</p>
              <h2 className={h2}>Wherever we went, we carried our sense of family with us.</h2>
            </div>
            <div className={`flex flex-col gap-4.5 text-lg ${muted}`}>
              <p>
                We, the Khandelwal community, are spread across every state of India, in towns, cities and
                villages. Wherever we went, we carried our values, our enterprise and our sense of family
                with us.
              </p>
              <p>
                But as we spread out, the bonds that once came naturally became harder to keep. Families
                lost touch, young people grew up without knowing their roots, and business opportunities
                within our own community went unseen.
              </p>
              <p className="font-medium text-[var(--color-text)]">
                KITE was created to bring us back together. It is a community-led institution, and it
                belongs to the community it serves.
              </p>
            </div>
          </div>
        </section>

        <section id="pillars" className={`${wrap} ${anchor} pb-14 md:pb-24`}>
          <h2 className="mb-8 font-heading font-bold tracking-tight text-[clamp(28px,3vw,40px)] leading-[1.1]">
            Built on three pillars
          </h2>
          <div className="grid gap-5 md:grid-cols-3">
            {PILLARS.map((p) => (
              <article
                key={p.title}
                className="p-8 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div
                  className={`flex items-center justify-center w-14 h-14 rounded-[14px] ${
                    p.tone === 'cool'
                      ? 'bg-[var(--color-chip-cool-bg)] text-[var(--color-chip-cool-fg)]'
                      : 'bg-[var(--color-chip-warm-bg)] text-[var(--color-chip-warm-fg)]'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="w-7 h-7 fill-none stroke-current [stroke-width:1.8] [stroke-linecap:round] [stroke-linejoin:round]"
                  >
                    {p.icon}
                  </svg>
                </div>
                <h3 className="mt-6 mb-2.5 font-heading font-bold text-2xl leading-tight">{p.title}</h3>
                <p className={muted}>{p.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-4 sm:px-8">
          <div className="max-w-[1176px] mx-auto p-8 md:p-16 rounded-[28px] border border-[var(--color-panel-border)] bg-[var(--color-panel-bg)] text-white">
            <h2 className="max-w-[16em] font-heading font-bold tracking-tight text-balance text-[clamp(30px,3.6vw,48px)] leading-[1.1]">
              Your family's information stays within the community.
            </h2>
            <div className="mt-10 grid gap-x-10 gap-y-7 md:grid-cols-3">
              {TRUST.map(([title, body]) => (
                <div key={title} className="pt-4.5 border-t border-[var(--color-panel-rule)]">
                  <h3 className="mb-1.5 font-body font-semibold text-lg">{title}</h3>
                  <p className="text-[var(--color-panel-muted)]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="mission" className={`${wrap} ${section} ${anchor}`}>
          <p className={label}>Our mission</p>
          <h2 className={`${h2} mb-10`}>Four commitments to our community</h2>
          <ol className="grid gap-x-14 md:grid-cols-2">
            {MISSION.map(([title, body], i) => (
              <li key={title} className="flex gap-6 py-6.5 border-t border-[var(--color-border)]">
                <span aria-hidden="true" className="font-heading font-semibold text-[22px] text-[var(--color-chip-warm-fg)]">
                  {i + 1}
                </span>
                <div>
                  <strong className="block mb-1.5 font-heading font-bold text-2xl leading-tight">{title}</strong>
                  <span className={muted}>{body}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="vision" className={`${anchor} bg-[var(--color-kite-deep)] text-white`}>
          <div className={`${wrap} py-14 md:py-28`}>
            <p className="mb-4.5 text-base font-semibold">Our vision</p>
            <h2 className="max-w-[20em] font-heading font-bold text-balance text-[clamp(34px,5vw,68px)] leading-[1.06] tracking-[-0.025em]">
              A united, empowered Khandelwal community, connected across India today and across the world
              tomorrow.
            </h2>
            <p className="mt-7 max-w-[38em] text-[clamp(18px,1.6vw,21px)] leading-normal">
              We see a future where every young person knows their roots, and where every family, business
              and professional can rely on the strength of the community behind them.
            </p>
          </div>
        </section>

        <section id="values" className={`${wrap} ${section} ${anchor}`}>
          <p className={label}>Our values</p>
          <h2 className={`${h2} mb-8`}>What we hold to</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {VALUES.map(([title, body]) => (
              <div
                key={title}
                className="p-6 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <h3 className="mb-2 font-heading font-bold text-[22px]">{title}</h3>
                <p className={`text-base ${muted}`}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--color-border)]">
          <div className="max-w-[760px] mx-auto px-4 sm:px-8 py-14 md:py-24 text-center">
            <h2 className="font-heading font-bold text-balance text-[clamp(34px,4.4vw,60px)] leading-[1.06] tracking-[-0.025em]">
              When one of us rises, we rise together.
            </h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/join" className={pillPrimary}>
                Join KITE
              </Link>
              <Link to="/signin" className={pillSecondary}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)]">
        <div className={`${wrap} flex flex-wrap justify-between gap-x-10 gap-y-3 py-8 text-[15px] ${muted}`}>
          <p>
            <strong className="font-heading text-[var(--color-text)]">KITE</strong> · {FULL_NAME}
          </p>
          <p lang="hi" className="font-hindi font-medium">
            {TAGLINE_HI}
          </p>
        </div>
      </footer>
    </div>
  )
}

/** The id of the section crossing the upper part of the screen, for
 * highlighting its nav link; null above About (the hero). */
function useActiveSection() {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const sections = NAV_LINKS.map(([id]) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id)
        }
      },
      // A thin band 30-35% down the screen: a section is "current" while it
      // covers that band.
      { rootMargin: '-30% 0px -65% 0px' },
    )
    sections.forEach((el) => observer.observe(el))

    // Back above the first section -> nothing highlighted.
    function onScroll() {
      const first = sections[0]
      if (first && first.getBoundingClientRect().top > window.innerHeight * 0.3) setActive(null)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return active
}

function KiteIllustration() {
  const ribbon = 'M0 0-20-11V11ZM0 0 20-11V11Z'
  return (
    <svg
      viewBox="0 0 480 640"
      role="img"
      aria-label="A coral and blue kite with three tail ribbons labelled Family, Community and Business"
      className="block w-full max-w-[440px] h-auto m-auto"
    >
      <path
        d="M276 171C380 300 430 430 476 640"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeDasharray="2 7"
        strokeLinecap="round"
      />
      <g transform="rotate(12 270 200)">
        <path d="M270 10 400 170H270Z" fill="var(--color-accent)" />
        <path d="M270 10 140 170H270Z" fill="var(--color-kite-blue)" />
        <path d="M140 170 270 390V170Z" fill="var(--color-kite-pale)" />
        <path d="M400 170 270 390V170Z" fill="var(--color-kite-deep)" />
      </g>
      <path
        d="M228 396C180 440 280 480 225 530S170 600 210 630"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path transform="translate(229 461)" d={ribbon} fill="var(--color-accent)" />
      <path transform="translate(225 530)" d={ribbon} fill="var(--color-kite-blue)" />
      <path transform="translate(182 588)" d={ribbon} fill="var(--color-kite-deep)" />
      <g fill="var(--color-text)" className="font-heading font-semibold text-[20px]">
        <text x="262" y="468">Family</text>
        <text x="258" y="537">Community</text>
        <text x="215" y="595">Business</text>
      </g>
    </svg>
  )
}
