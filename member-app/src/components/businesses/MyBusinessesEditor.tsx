import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EMPTY_BUSINESS_FORM,
  businessToFormValues,
  createBusiness,
  deleteBusiness,
  removeBusinessLogo,
  updateBusiness,
  uploadBusinessLogo,
  validateBusiness,
  type BusinessFormValues,
} from '../../lib/businesses'
import { BusinessForm } from './BusinessForm'
import { Avatar } from '../Avatar'
import type { BusinessRow } from '../../types/database'

type EditorProps = {
  business: BusinessRow
  authUserId: string
  onChanged: (updated: BusinessRow) => void
  onRemoved: (id: string) => void
}

/** One existing listing: logo controls + editable fields + Save / Remove. */
function BusinessEditor({ business, authUserId, onChanged, onRemoved }: EditorProps) {
  const [form, setForm] = useState<BusinessFormValues>(businessToFormValues(business))
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    setError(null)
    setSaved(false)
    const message = validateBusiness(form)
    if (message) {
      setError(message)
      return
    }
    setSaving(true)
    try {
      const updated = await updateBusiness(business.id, form)
      onChanged(updated)
      setForm(businessToFormValues(updated))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving this listing.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove "${business.name}" from the businesses directory?`)) return
    setRemoving(true)
    setError(null)
    try {
      await deleteBusiness(business)
      onRemoved(business.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong removing this listing.')
      setRemoving(false)
    }
  }

  async function handleLogoSelected(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    setError(null)
    try {
      onChanged(await uploadBusinessLogo(file, authUserId, business))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong uploading the logo.')
    } finally {
      setLogoBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemoveLogo() {
    setLogoBusy(true)
    setError(null)
    try {
      onChanged(await removeBusinessLogo(business))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong removing the logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={business.name} photoUrl={business.logo_url} size={48} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoBusy}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
            >
              {logoBusy ? 'Working…' : business.logo_url ? 'Change logo' : 'Add logo'}
            </button>
            {business.logo_url && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                disabled={logoBusy}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
              >
                Remove logo
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handleLogoSelected(e.target.files?.[0])}
          />
        </div>
        <Link
          to={`/businesses/${business.id}`}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors shrink-0"
        >
          View
        </Link>
      </div>

      <BusinessForm
        value={form}
        onChange={(v) => {
          setForm(v)
          setSaved(false)
        }}
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {saved && !error && <p className="text-sm text-[var(--color-text-muted)]">Saved.</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

type MyBusinessesEditorProps = {
  ownerId: string
  authUserId: string
  businesses: BusinessRow[]
  onChange: (next: BusinessRow[]) => void
}

/** The member's own listings: one editor card each plus an "Add a
 * business" block. Lives on the Profile page's Business tab (Phase 3c);
 * previously the whole of /businesses/mine. */
export function MyBusinessesEditor({
  ownerId,
  authUserId,
  businesses,
  onChange,
}: MyBusinessesEditorProps) {
  const [newForm, setNewForm] = useState<BusinessFormValues>(EMPTY_BUSINESS_FORM)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd() {
    setAddError(null)
    const message = validateBusiness(newForm)
    if (message) {
      setAddError(message)
      return
    }
    setAdding(true)
    try {
      const created = await createBusiness(ownerId, newForm)
      onChange([...businesses, created])
      setNewForm(EMPTY_BUSINESS_FORM)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Something went wrong adding this business.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Listings appear in the Businesses directory and on your member profile. You can add as
        many as you run.
      </p>

      {businesses.map((business) => (
        <BusinessEditor
          key={business.id}
          business={business}
          authUserId={authUserId}
          onChanged={(updated) =>
            onChange(businesses.map((b) => (b.id === updated.id ? updated : b)))
          }
          onRemoved={(id) => onChange(businesses.filter((b) => b.id !== id))}
        />
      ))}

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-4">
        <h3 className="font-heading font-semibold">Add a business</h3>
        <BusinessForm value={newForm} onChange={setNewForm} />
        {addError && <p className="text-sm text-[var(--color-accent)]">{addError}</p>}
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || newForm.name.trim().length === 0}
          className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {adding ? 'Adding…' : 'Add business'}
        </button>
        <p className="text-xs text-[var(--color-text-muted)]">
          You can add a logo after the listing is created.
        </p>
      </div>
    </div>
  )
}
