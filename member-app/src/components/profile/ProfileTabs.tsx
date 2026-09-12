import { PROFILE_TABS, type ProfileTabKey } from '../../lib/profileTabs'

type ProfileTabsProps = {
  active: ProfileTabKey
  onChange: (tab: ProfileTabKey) => void
}

/** Horizontally scrollable tab strip. Active tab = accent text + accent
 * underline (same treatment as the header nav's active link); the strip
 * never wraps, so on a phone it scrolls sideways. */
export function ProfileTabs({ active, onChange }: ProfileTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      className="w-full flex gap-1 overflow-x-auto border-b border-[var(--color-border)] -mx-5 px-5 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PROFILE_TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`shrink-0 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-medium'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
