type TextFieldProps = {
  label: string
  type?: 'text' | 'date' | 'tel'
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  min?: string
  max?: string
  maxLength?: number
  /** Fixed, non-editable text shown before the input (e.g. a locked country code). */
  prefix?: string
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
  maxLength,
  prefix,
}: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
        {prefix && (
          <span className="pl-3 py-2.5 text-[var(--color-text-muted)] select-none">{prefix}</span>
        )}
        <input
          type={type}
          required={required}
          placeholder={placeholder}
          min={min}
          max={max}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 outline-none"
        />
      </div>
    </label>
  )
}
