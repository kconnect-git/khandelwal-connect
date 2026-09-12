type TabStripProps<K extends string> = {
  tabs: { key: K; label: string }[]
  active: K
  onChange: (key: K) => void
  label: string
}

/** Generic version of the Profile page's tab strip (same look: accent text
 * + accent underline on the active tab, sideways scroll on a phone). */
export function TabStrip<K extends string>({ tabs, active, onChange, label }: TabStripProps<K>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="w-full flex gap-1 overflow-x-auto border-b border-[var(--color-border)] -mx-5 px-5 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
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
