import type { Option } from '../../lib/formOptions'

type SelectFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: Option[]
  required?: boolean
}

export function SelectField({ label, value, onChange, options, required }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <select
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)]"
      >
        {required && <option value="">Select…</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
