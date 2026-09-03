import { useEffect, useRef, useState } from 'react'

type UserMenuProps = {
  initials: string
  memberCode?: string | null
  onLogout: () => void
  loggingOut?: boolean
}

export function UserMenu({ initials, memberCode, onLogout, loggingOut }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-white text-xs font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg z-10"
        >
          {memberCode && (
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-muted)]">Member ID</p>
              <p className="text-sm font-medium tracking-wide">{memberCode}</p>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="w-full text-left px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-60 transition-colors"
          >
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  )
}
