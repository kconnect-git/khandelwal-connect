import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import {
  EMPTY_BUSINESS_FORM,
  businessFormFromProfile,
  businessToFormValues,
  createBusiness,
  deleteBusiness,
  getMyBusiness,
  removeBusinessLogo,
  updateBusiness,
  uploadBusinessLogo,
  validateBusiness,
  type BusinessFormValues,
} from '../lib/businesses'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { BusinessForm } from '../components/businesses/BusinessForm'
import type { BusinessRow } from '../types/database'

// Phase 10.4: "List your business" (/businesses/new) and its edit twin
// (/businesses/:id/edit). Replaces the inline editors that used to fill
// Profile > Business. A new listing starts from the member's own profile
// (city, state, phone, role) with those fields marked; nothing is written
// back to the profile.

// (10.5) The owner's list, with each listing's review status.
const MY_BUSINESSES = '/businesses/mine'

const PRIMARY_BUTTON =
  'rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
const SECONDARY_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

/** (10.5) Where the listing stands with the admins, and what saving does. */
function ReviewBanner({ business }: { business: BusinessRow }) {
  const box = 'rounded-lg border px-4 py-3 text-sm'
  switch (business.review_status) {
    case 'pending':
      return (
        <p className={`${box} border-[var(--color-border)] bg-[var(--color-surface)]`}>
          <span className="font-medium">Pending review.</span> Members will see this listing once an
          admin approves it.
        </p>
      )
    case 'changes_requested':
      return (
        <div className={`${box} border-[var(--color-accent)]`}>
          <p className="font-medium text-[var(--color-accent)]">The admins asked for changes</p>
          {business.review_note && (
            <p className="mt-1 whitespace-pre-line">{business.review_note}</p>
          )}
          <p className="mt-2 text-[var(--color-text-muted)]">Saving sends it back for review.</p>
        </div>
      )
    case 'rejected':
      return (
        <div className={`${box} border-[var(--color-accent)]`}>
          <p className="font-medium text-[var(--color-accent)]">This listing was turned down</p>
          {business.review_note && (
            <p className="mt-1 whitespace-pre-line">{business.review_note}</p>
          )}
          <p className="mt-2 text-[var(--color-text-muted)]">
            It can’t be edited. You can remove it, or list your business again.
          </p>
        </div>
      )
    default:
      return (
        <p className="text-sm text-[var(--color-text-muted)]">
          Changing the name or industry sends the listing back for review.
        </p>
      )
  }
}

export function BusinessEditPage({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // Set by a new listing whose logo upload failed right after it was created.
  const logoFailed = (location.state as { logoError?: boolean } | null)?.logoError === true
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [business, setBusiness] = useState<BusinessRow | null>(null)
  const [form, setForm] = useState<BusinessFormValues>(EMPTY_BUSINESS_FORM)
  const [fromProfile, setFromProfile] = useState<Set<keyof BusinessFormValues>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(
    logoFailed ? 'Your listing was saved, but the logo didn’t upload. Try it again below.' : null,
  )
  // New listing: the logo is picked up front and uploaded right after the
  // row exists (its storage path needs the id). Edit: it uploads at once.
  const [pendingLogo, setPendingLogo] = useState<File | null>(null)
  const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!session) throw new Error('Please sign in again.')
        const person = await getOwnPerson(session.user.id)
        if (!person) throw new Error('Could not load your profile.')
        if (cancelled) return
        setAuthUserId(session.user.id)
        setOwnerId(person.id)

        if (mode === 'new') {
          const prefill = businessFormFromProfile(person)
          setForm(prefill.values)
          setFromProfile(prefill.fromProfile)
        } else if (id) {
          const loaded = await getMyBusiness(id)
          if (cancelled) return
          setBusiness(loaded)
          if (loaded) setForm(businessToFormValues(loaded))
        }
      } catch (err) {
        if (cancelled) return
        console.error('[BusinessEditPage] failed to load', err)
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this page.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [mode, id])

  // Free the preview's object URL when it's replaced or the page closes.
  useEffect(() => {
    return () => {
      if (pendingLogoUrl) URL.revokeObjectURL(pendingLogoUrl)
    }
  }, [pendingLogoUrl])

  function handleFormChange(next: BusinessFormValues) {
    // A field the member changes is no longer "from your profile".
    if (fromProfile.size > 0) {
      const changed = [...fromProfile].filter((key) => next[key] !== form[key])
      if (changed.length > 0) {
        setFromProfile(new Set([...fromProfile].filter((key) => !changed.includes(key))))
      }
    }
    setForm(next)
    setSaved(false)
  }

  async function handleSubmit() {
    setError(null)
    setSaved(false)
    const message = validateBusiness(form)
    if (message) {
      setError(message)
      return
    }
    setSaving(true)
    try {
      if (mode === 'new') {
        if (!ownerId || !authUserId) throw new Error('Please sign in again.')
        const created = await createBusiness(ownerId, form)
        if (pendingLogo) {
          try {
            await uploadBusinessLogo(pendingLogo, authUserId, created)
          } catch (err) {
            // The listing exists; send them to its edit page to retry the logo.
            console.error('[BusinessEditPage] logo upload failed after create', err)
            navigate(`/businesses/${created.id}/edit`, {
              replace: true,
              state: { logoError: true },
            })
            return
          }
        }
        // (10.5) A new listing waits for an admin, so it has no public page
        // yet -- show it on My businesses as Pending review.
        navigate(MY_BUSINESSES, { replace: true })
      } else if (business) {
        const updated = await updateBusiness(business.id, form)
        setBusiness(updated)
        setForm(businessToFormValues(updated))
        setSaved(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving this listing.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoSelected(file: File | undefined) {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    setError(null)
    if (mode === 'new') {
      setPendingLogo(file)
      setPendingLogoUrl(URL.createObjectURL(file))
      return
    }
    if (!business || !authUserId) return
    setLogoBusy(true)
    try {
      setBusiness(await uploadBusinessLogo(file, authUserId, business))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong uploading the logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleRemoveLogo() {
    setError(null)
    if (mode === 'new') {
      setPendingLogo(null)
      setPendingLogoUrl(null)
      return
    }
    if (!business) return
    setLogoBusy(true)
    try {
      setBusiness(await removeBusinessLogo(business))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong removing the logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleRemoveListing() {
    if (!business) return
    setRemoving(true)
    setError(null)
    try {
      await deleteBusiness(business)
      navigate(MY_BUSINESSES, { replace: true })
    } catch (err) {
      setConfirmRemove(false)
      setRemoving(false)
      setError(err instanceof Error ? err.message : 'Something went wrong removing this listing.')
    }
  }

  const backLink = (
    <Link
      to={MY_BUSINESSES}
      className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      ‹ My businesses
    </Link>
  )

  if (loading) {
    return (
      <div className="flex-1 flex flex-col gap-4 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      </div>
    )
  }

  if (loadError || (mode === 'edit' && !business)) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <h1 className="font-heading text-2xl font-semibold">Listing not found</h1>
        <p className="text-[var(--color-text-muted)]">
          {loadError ?? 'This listing does not exist, or it isn’t yours to edit.'}
        </p>
      </div>
    )
  }

  const logoUrl = mode === 'new' ? pendingLogoUrl : (business?.logo_url ?? null)
  // (10.5) A turned-down listing is final: no form, only Remove.
  const rejected = business?.review_status === 'rejected'
  const live = business?.review_status === 'approved' && !business.is_hidden

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      {backLink}
      <h1 className="font-heading text-2xl font-semibold">
        {mode === 'new' ? 'List your business' : 'Edit listing'}
      </h1>

      {mode === 'new' && fromProfile.size > 0 && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm">
          Fields marked{' '}
          <span className="font-medium text-[var(--color-accent)]">From your profile</span> are
          filled in for you. You can change them for this listing.
        </p>
      )}

      {/* (0021) Only the owner can still see a hidden listing -- tell them
          why, since it has silently vanished for everyone else. Editing it
          doesn't unhide it; an admin does. */}
      {business && <ReviewBanner business={business} />}

      {business?.is_hidden && (
        <div className="rounded-lg border border-[var(--color-accent)] px-3 py-2 text-sm">
          <p className="font-medium text-[var(--color-accent)]">
            Hidden from the businesses directory by an admin
          </p>
          {business.hidden_reason && (
            <p className="mt-1 whitespace-pre-line">{business.hidden_reason}</p>
          )}
        </div>
      )}

      {!rejected && (
        <>
          <BusinessForm value={form} onChange={handleFormChange} fromProfile={fromProfile} />

          <section className="flex flex-col gap-2">
            <span className="text-sm text-[var(--color-text-muted)]">Logo (optional)</span>
            <div className="flex items-center gap-3">
              <Avatar name={form.name || 'Business'} photoUrl={logoUrl} size={56} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={logoBusy}
                className={SECONDARY_BUTTON}
              >
                {logoBusy ? 'Working…' : logoUrl ? 'Change logo' : 'Upload a logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={logoBusy}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
                >
                  Remove logo
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleLogoSelected(e.target.files?.[0])}
              />
            </div>
          </section>
        </>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {saved && !error && <p className="text-sm text-[var(--color-text-muted)]">Saved.</p>}

      <div className="flex flex-wrap items-center gap-3">
        {!rejected && (
          <button type="button" onClick={handleSubmit} disabled={saving} className={PRIMARY_BUTTON}>
            {saving
              ? mode === 'new'
                ? 'Listing…'
                : 'Saving…'
              : mode === 'new'
                ? 'List business'
                : 'Save'}
          </button>
        )}
        {business && live && (
          <Link
            to={`/businesses/${business.id}`}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            View listing
          </Link>
        )}
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={removing}
            className={`${SECONDARY_BUTTON} ml-auto`}
          >
            Remove listing
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={business ? `Remove "${business.name}"?` : ''}
        description="It disappears from the businesses directory and your member profile. This can't be undone."
        confirmLabel="Remove listing"
        busy={removing}
        onConfirm={() => handleRemoveListing()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  )
}
