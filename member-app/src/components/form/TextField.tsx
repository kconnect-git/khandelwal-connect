type TextFieldProps = {
  label: string
  type?: 'text' | 'date' | 'tel'
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  min?: string
  max?: string
}

export function TextField({
  label,
  type = 'text',
  value,
  onChange,
  required,
  placeholder,
  min,
  max,
}: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  )
}
