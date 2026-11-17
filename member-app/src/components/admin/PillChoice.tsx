// Phase 11.2: a small required single choice (Open / Granted / Dismissed)
// that sits beside ChipSelect filters. Not a TabStrip: the Access page
// already has one, and two underlined strips stacked read as one row.

type PillChoiceProps<K extends string> = {
  options: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  label: string
}

export function PillChoice<K extends string>({ options, value, onChange, label }: PillChoiceProps<K>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
