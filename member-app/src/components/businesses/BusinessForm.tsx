import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { ChipInput } from '../form/ChipInput'
import {
  BUSINESS_CATEGORY_OPTIONS,
  BUSINESS_ROLE_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
  INDIAN_STATE_OPTIONS,
} from '../../lib/formOptions'
import {
  PRODUCTS_MAX,
  PRODUCT_MAX_LENGTH,
  type BusinessFormValues,
} from '../../lib/businesses'

type BusinessFormProps = {
  value: BusinessFormValues
  onChange: (value: BusinessFormValues) => void
  /** (10.4) Fields prefilled from the member's profile, marked as such. The
   * page drops a key once the member changes that field. */
  fromProfile?: ReadonlySet<keyof BusinessFormValues>
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] pt-1">
      {children}
    </p>
  )
}

/** The editable fields of one business listing. Controlled; the page owns
 * save / remove. (10.4) Ordered like the "List your business" mockup --
 * the essentials first, everything else under "More details". */
export function BusinessForm({ value, onChange, fromProfile }: BusinessFormProps) {
  function patch(p: Partial<BusinessFormValues>) {
    onChange({ ...value, ...p })
  }

  function label(text: string, key: keyof BusinessFormValues) {
    if (!fromProfile?.has(key)) return text
    return (
      <span className="flex items-baseline justify-between gap-2">
        <span>{text}</span>
        <span className="text-xs font-medium text-[var(--color-accent)]">From your profile</span>
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Business name"
          required
          value={value.name}
          onChange={(v) => patch({ name: v })}
          placeholder="e.g. Khandelwal Jewellers"
        />
        <SelectField
          label="Industry type"
          required
          value={value.category}
          onChange={(v) => patch({ category: v })}
          options={BUSINESS_CATEGORY_OPTIONS}
        />
        <SelectField
          label={label('Your role (optional)', 'owner_role')}
          value={value.owner_role}
          onChange={(v) => patch({ owner_role: v })}
          options={[{ value: '', label: 'Select…' }, ...BUSINESS_ROLE_OPTIONS]}
        />
        <TextField
          label={label('City', 'city')}
          required
          value={value.city}
          onChange={(v) => patch({ city: v })}
          placeholder="e.g. Jaipur"
        />
        <SelectField
          label={label('State', 'state')}
          required
          value={value.state}
          onChange={(v) => patch({ state: v })}
          options={[{ value: '', label: 'Select…' }, ...INDIAN_STATE_OPTIONS]}
        />
        <TextField
          label={label('Phone or WhatsApp', 'contact_phone')}
          required
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
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.show_phone}
          onChange={(e) => patch({ show_phone: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="flex flex-col">
          <span>Show this number on the listing</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            Off: no WhatsApp or Call buttons. Members reach you through your member profile instead.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--color-text-muted)]">Short description (optional)</span>
        <textarea
          value={value.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={3}
          maxLength={600}
          placeholder="What does your business do?"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y"
        />
      </label>
      {/* (10.3) Replaces the single "Primary product / service" box. */}
      <ChipInput
        label="Products & services (optional)"
        value={value.products}
        onChange={(products) => patch({ products })}
        placeholder="Add one and tap Add"
        max={PRODUCTS_MAX}
        maxLength={PRODUCT_MAX_LENGTH}
      />
      <TextField
        label="Website (optional)"
        value={value.website}
        onChange={(v) => patch({ website: v })}
        placeholder="https://"
      />

      <SubHeading>More details (optional)</SubHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Brand name"
          value={value.brand_name}
          onChange={(v) => patch({ brand_name: v })}
        />
        <SelectField
          label="Business type"
          value={value.business_type}
          onChange={(v) => patch({ business_type: v })}
          options={[{ value: '', label: 'Select…' }, ...BUSINESS_TYPE_OPTIONS]}
        />
      </div>
      <TextField
        label="Office address line 1"
        value={value.address_line1}
        onChange={(v) => patch({ address_line1: v })}
      />
      <TextField
        label="Office address line 2"
        value={value.address_line2}
        onChange={(v) => patch({ address_line2: v })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Business email"
          type="email"
          value={value.business_email}
          onChange={(v) => patch({ business_email: v })}
          placeholder="hello@example.com"
        />
        <TextField
          label="Facebook"
          value={value.facebook_url}
          onChange={(v) => patch({ facebook_url: v })}
          placeholder="facebook.com/yourpage"
        />
        <TextField
          label="Instagram"
          value={value.instagram_url}
          onChange={(v) => patch({ instagram_url: v })}
          placeholder="instagram.com/yourhandle"
        />
        <TextField
          label="LinkedIn"
          value={value.linkedin_url}
          onChange={(v) => patch({ linkedin_url: v })}
          placeholder="linkedin.com/company/…"
        />
        <TextField
          label="YouTube"
          value={value.youtube_url}
          onChange={(v) => patch({ youtube_url: v })}
          placeholder="youtube.com/@yourchannel"
        />
      </div>
    </div>
  )
}
