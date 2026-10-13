import { ChipSelect } from './ChipSelect'

// Phase 5c: pick several values from a list. The chosen values show as
// removable chips; a ChipSelect beside them offers what's left. Used by the
// notice composer's audience fields.

type Option = string | { value: string; label: string }

type MultiChipSelectProps = {
  label: string
  values: string[]
  options: Option[]
  onChange: (values: string[]) => void
}

function optionValue(option: Option): string {
  return typeof option === 'string' ? option : option.value
}

export function MultiChipSelect({ label, values, options, onChange }: MultiChipSelectProps) {
  const remaining = options.filter((option) => !values.includes(optionValue(option)))

  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)] py-1 pr-1.5 pl-3 text-sm text-white"
        >
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
            className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/20"
          >
            ×
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <ChipSelect
          label={values.length > 0 ? `+ ${label}` : label}
          value=""
          onChange={(value) => {
            if (value) onChange([...values, value])
          }}
          options={remaining}
        />
      )}
    </div>
  )
}
