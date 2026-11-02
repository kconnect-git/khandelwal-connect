import { useState } from 'react'

type ChipInputProps = {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  max: number
  maxLength: number
}

/** (10.3) A free-text list entered one item at a time: type, tap Add (or
 * press Enter), remove with ×. Blank and case-insensitive duplicate items are
 * ignored. Used for a listing's products & services. */
export function ChipInput({ label, value, onChange, placeholder, max, maxLength }: ChipInputProps) {
  const [draft, setDraft] = useState('')
  const full = value.length >= max

  function add() {
    const item = draft.trim()
    if (item.length === 0 || full) return
    if (!value.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
      onChange([...value, item])
    }
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter would otherwise submit the surrounding form.
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder={full ? `That's the limit of ${max}` : placeholder}
            maxLength={maxLength}
            disabled={full}
            aria-label={label}
            className="flex-1 min-w-0 bg-transparent px-3 py-2.5 outline-none disabled:cursor-not-allowed"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={full || draft.trim().length === 0}
          className="rounded-lg border border-[var(--color-border)] px-4 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-50 transition-colors"
        >
          Add
        </button>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded-full border border-[var(--color-border)] py-1 pl-3 pr-1.5 text-sm"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(value.filter((existing) => existing !== item))}
                aria-label={`Remove ${item}`}
                className="rounded-full px-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length >= max - 5 && (
        <span className="text-xs text-[var(--color-text-muted)]">
          {value.length} of {max}
        </span>
      )}
    </div>
  )
}
