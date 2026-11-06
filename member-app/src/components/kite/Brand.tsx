import { Link } from 'react-router-dom'

/** The four-panel kite mark. Fixed brand colours, so it reads the same in
 * both themes. */
export function KiteMark({ className = '' }: { className?: string }) {
  return (
    <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true" className={className}>
      <path d="M13 0 25 11H13Z" fill="#F05A3C" />
      <path d="M13 0 1 11H13Z" fill="#2F62D9" />
      <path d="M1 11 13 30V11Z" fill="#F9C9BD" />
      <path d="M25 11 13 30V11Z" fill="#D23F1C" />
    </svg>
  )
}

export function KiteLogo({ label = 'KITE home' }: { label?: string }) {
  return (
    <Link
      to="/"
      aria-label={label}
      className="inline-flex items-center gap-2.5 min-h-11 font-heading font-bold text-2xl tracking-wide"
    >
      <KiteMark />
      KITE
    </Link>
  )
}

export const TAGLINE_HI = 'अपने लोग, अपना नेटवर्क'
export const FULL_NAME = 'Khandelwal International Trust & Empowerment'

/** (KITE) The pill buttons of the logged-out pages. */
export const pillPrimary =
  'inline-flex items-center justify-center min-h-13 px-7 rounded-full bg-[var(--color-accent)] text-white font-semibold hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
export const pillSecondary =
  'inline-flex items-center justify-center min-h-13 px-7 rounded-full border border-[var(--color-border)] font-medium hover:border-[var(--color-text-muted)] transition-colors'
