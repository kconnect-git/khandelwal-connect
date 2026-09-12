import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import {
  BUSINESS_CATEGORY_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  INDIAN_STATE_OPTIONS,
} from '../../lib/formOptions'
import type { BusinessFormValues } from '../../lib/businesses'

type BusinessFormProps = {
  value: BusinessFormValues
  onChange: (value: BusinessFormValues) => void
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] pt-1">
      {children}
    </p>
  )
}

/** The editable fields of one business listing. Controlled; the parent
 * owns save/remove. Used by both the per-listing editor card and the
 * "Add a business" block. Grouped: basics / office / contact & links. */
export function BusinessForm({ value, onChange }: BusinessFormProps) {
  function patch(p: Partial<BusinessFormValues>) {
    onChange({ ...value, ...p })
  }

  return (
    <div className="flex flex-col gap-3">
      <SubHeading>Basics</SubHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Company name"
          required
          value={value.name}
          onChange={(v) => patch({ name: v })}
          placeholder="e.g. Khandelwal Jewellers"
        />
        <TextField
          label="Brand name (optional)"
          value={value.brand_name}
          onChange={(v) => patch({ brand_name: v })}
        />
        <SelectField
          label="Industry type"
          required
          value={value.category}
          onChange={(v) => patch({ category: v })}
          options={BUSINESS_CATEGORY_OPTIONS}
        />
        <SelectField
          label="Business type (optional)"
          value={value.business_type}
          onChange={(v) => patch({ business_type: v })}
          options={[{ value: '', label: 'Select…' }, ...BUSINESS_TYPE_OPTIONS]}
        />
      </div>
      <TextField
        label="Primary product / service (optional)"
        value={value.primary_product}
        onChange={(v) => patch({ primary_product: v })}
        placeholder="e.g. Gold and diamond jewellery"
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

      <SubHeading>Office</SubHeading>
      <TextField
        label="Office address line 1 (optional)"
        value={value.address_line1}
        onChange={(v) => patch({ address_line1: v })}
      />
      <TextField
        label="Office address line 2 (optional)"
        value={value.address_line2}
        onChange={(v) => patch({ address_line2: v })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Office city (optional)"
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

      <SubHeading>Contact &amp; links</SubHeading>
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
          label="Business email (optional)"
          type="email"
          value={value.business_email}
          onChange={(v) => patch({ business_email: v })}
          placeholder="hello@example.com"
        />
        <TextField
          label="Website (optional)"
          value={value.website}
          onChange={(v) => patch({ website: v })}
          placeholder="example.com"
        />
        <TextField
          label="Facebook (optional)"
          value={value.facebook_url}
          onChange={(v) => patch({ facebook_url: v })}
          placeholder="facebook.com/yourpage"
        />
        <TextField
          label="Instagram (optional)"
          value={value.instagram_url}
          onChange={(v) => patch({ instagram_url: v })}
          placeholder="instagram.com/yourhandle"
        />
        <TextField
          label="LinkedIn (optional)"
          value={value.linkedin_url}
          onChange={(v) => patch({ linkedin_url: v })}
          placeholder="linkedin.com/company/…"
        />
        <TextField
          label="YouTube (optional)"
          value={value.youtube_url}
          onChange={(v) => patch({ youtube_url: v })}
          placeholder="youtube.com/@yourchannel"
        />
      </div>
    </div>
  )
}
