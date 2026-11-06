import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '../ThemeToggle'
import { FULL_NAME, KiteLogo, TAGLINE_HI } from './Brand'

/** (KITE) The split layout around /signin, /join and /verify: the dark brand
 * panel on the left and the form. Phones drop the panel for the landing
 * page's top bar, so the page doesn't open on a black strip. */
export function AuthShell({
  back = { to: '/', label: 'Back to home' },
  children,
}: {
  back?: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <div className="min-h-svh flex flex-col md:flex-row text-[17px] leading-relaxed">
      <header className="md:hidden sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <div className="px-4 sm:px-8 flex items-center gap-3 py-3.5">
          <KiteLogo label="Back to the KITE home page" />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <aside className="hidden md:flex md:flex-[1_1_420px] flex-col justify-between gap-8 p-12 bg-[var(--color-panel-bg)] text-white">
        <KiteLogo label="Back to the KITE home page" />
        <div>
          <p lang="hi" className="mb-4 font-hindi font-semibold text-[22px] leading-snug text-[#ff8468]">
            {TAGLINE_HI}
          </p>
          <p className="max-w-[13em] font-heading font-bold text-[clamp(36px,4vw,56px)] leading-[1.05] tracking-[-0.025em]">
            No Khandelwal is a stranger to another.
          </p>
        </div>
        <p className="text-[15px] text-[var(--color-panel-muted)]">{FULL_NAME}</p>
      </aside>
      <main className="flex-1 md:flex-[1_1_480px] flex flex-col gap-8 px-4 sm:px-8 md:px-12 py-6 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={back.to}
            className="inline-flex items-center min-h-11 text-base text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← {back.label}
          </Link>
          {/* On phones the toggle is in the top bar. */}
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
        </div>
        <div className="w-full max-w-[420px] m-auto">{children}</div>
      </main>
    </div>
  )
}

export function AuthHeading({ title, intro }: { title: string; intro: ReactNode }) {
  return (
    <>
      <h1 className="font-heading font-bold text-[40px] leading-[1.1] tracking-tight">{title}</h1>
      <p className="mt-2.5 mb-7 text-[var(--color-text-muted)]">{intro}</p>
    </>
  )
}
