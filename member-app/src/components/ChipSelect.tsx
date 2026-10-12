// A filter chip that is really a <select>: muted until a value is picked,
// then filled with the accent. The first option (value '') is the label and
// means "no filter". Shared by the Directory, Businesses and the admin
// members table (it lived as two identical copies before 5b-1).

type ChipOption = string | { value: string; label: string }

type ChipSelectProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: ChipOption[]
}

export function ChipSelect({ label, value, onChange, options }: ChipSelectProps) {
  const active = value !== ''
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border px-3 py-1.5 text-sm outline-none transition-colors ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
      }`}
    >
      <option value="">{label}</option>
      {options.map((option) => {
        const { value: optionValue, label: optionLabel } =
          typeof option === 'string' ? { value: option, label: option } : option
        return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        )
      })}
    </select>
  )
}
