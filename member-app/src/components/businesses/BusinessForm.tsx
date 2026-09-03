import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { BUSINESS_CATEGORY_OPTIONS, INDIAN_STATE_OPTIONS } from '../../lib/formOptions'
import type { BusinessFormValues } from '../../lib/businesses'

type BusinessFormProps = {
  value: BusinessFormValues
  onChange: (value: BusinessFormValues) => void
}

/** The editable fields of one business listing. Controlled; the parent
 * owns save/remove. Used by both the per-listing editor card and the
 * "Add a business" block on My businesses. */
export function BusinessForm({ value, onChange }: BusinessFormProps) {
  function patch(p: Partial<BusinessFormValues>) {
    onChange({ ...value, ...p })
  }

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Business name"
        required
        value={value.name}
        onChange={(v) => patch({ name: v })}
        placeholder="e.g. Khandelwal Jewellers"
      />
      <SelectField
        label="Category"
        required
        value={value.category}
        onChange={(v) => patch({ category: v })}
        options={BUSINESS_CATEGORY_OPTIONS}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--color-text-muted)]">Description (optional)</span>
        <textarea
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={3}
          maxLength={600}
          placeholder="What you do, who you serve, anything members should know."
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y"
        />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="City (optional)"
          value={value.city}
          onChange={(v) => patch({ city: v })}
          placeholder="e.g. Jaipur"
        />
        <SelectField
          label="State (optional)"
          value={value.state}
          onChange={(v) => patch({ state: v })}
          options={[{ value: '', label: 'Select…' }, ...INDIAN_STATE_OPTIONS]}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Contact number (optional)"
          type="tel"
          prefix="+91"
          maxLength={10}
          value={value.contact_phone.replace(/^\+91/, '')}
          onChange={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 10)
            patch({ contact_phone: digits ? `+91${digits}` : '' })
          }}
          placeholder="98765 43210"
        />
        <TextField
          label="Website (optional)"
          value={value.website}
          onChange={(v) => patch({ website: v })}
          placeholder="example.com"
        />
      </div>
    </div>
  )
}
