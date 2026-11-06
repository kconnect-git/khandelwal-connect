import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getMyBusinesses } from '../lib/businesses'
import {
  POST_DETAILS_MAX,
  POST_KIND_LABELS,
  POST_TERMS_LABELS,
  POST_TERMS_MAX,
  POST_TITLE_MAX,
  createBusinessPost,
  postPrefill,
  postableBusinesses,
  validatePost,
  type PostFormValues,
} from '../lib/businessPosts'
import { BUSINESS_CATEGORY_OPTIONS, INDIAN_STATE_OPTIONS } from '../lib/formOptions'
import { TextField } from '../components/form/TextField'
import { SelectField } from '../components/form/SelectField'
import { FromProfileLabel } from '../components/form/FromProfileLabel'
import type { BusinessPostKind, BusinessRow } from '../types/database'

// Phase 10.6: post a requirement or an offer. Starts from the member's own
// profile (city, state, phone). Posting as one of their approved listings
// shows its name on the card and switches the contact number to the
// listing's phone; either way the number is editable and only handed to
// members who tap Respond.

const KINDS: BusinessPostKind[] = ['requirement', 'offer']

const TITLE_PLACEHOLDERS: Record<BusinessPostKind, string> = {
  requirement: 'e.g. 200 printed wedding cards',
  offer: 'e.g. Cotton sarees, wholesale lots',
}

export function BuySellNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialKind: BusinessPostKind = searchParams.get('kind') === 'offer' ? 'offer' : 'requirement'
  const [form, setForm] = useState<PostFormValues | null>(null)
  const [fromProfile, setFromProfile] = useState<Set<keyof PostFormValues>>(new Set())
  const [personalPhone, setPersonalPhone] = useState('')
  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!session) throw new Error('Please sign in again.')
        const person = await getOwnPerson(session.user.id)
        if (!person) throw new Error('Could not load your profile.')
        const mine = await getMyBusinesses(person.id)
        if (cancelled) return
        const prefill = postPrefill(person, initialKind)
        setForm(prefill.values)
        setFromProfile(prefill.fromProfile)
        setPersonalPhone(prefill.values.contact_phone)
        setBusinesses(postableBusinesses(mine))
      } catch (err) {
        if (cancelled) return
        console.error('[BuySellNew] failed to load', err)
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading this page.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [initialKind])

  function patch(p: Partial<PostFormValues>) {
    if (!form) return
    const next = { ...form, ...p }
    // A field the member changes is no longer "from your profile".
    const changed = (Object.keys(p) as (keyof PostFormValues)[]).filter((key) => fromProfile.has(key))
    if (changed.length > 0) {
      setFromProfile(new Set([...fromProfile].filter((key) => !changed.includes(key))))
    }
    setForm(next)
  }

  function handlePostAs(businessId: string) {
    if (!form) return
    const business = businesses.find((b) => b.id === businessId)
    // Follow the choice with the matching number, unless they typed their own.
    const phoneIsDefault =
      form.contact_phone === personalPhone ||
      businesses.some((b) => b.contact_phone === form.contact_phone)
    setForm({
      ...form,
      business_id: businessId,
      contact_phone: phoneIsDefault
        ? (business?.contact_phone ?? personalPhone)
        : form.contact_phone,
    })
  }

  async function handleSubmit() {
    if (!form) return
    setError(null)
    const message = validatePost(form)
    if (message) {
      setError(message)
      return
    }
    setSaving(true)
    try {
      await createBusinessPost(form)
      navigate('/business/market?tab=mine', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong posting this.')
      setSaving(false)
    }
  }

  const backLink = (
    <Link
      to="/business/market"
      className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      ‹ Buy & Sell
    </Link>
  )

  if (!form) {
    return (
      <div className="flex-1 flex flex-col gap-4 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        {loadError ? (
          <p className="text-sm text-[var(--color-accent)]">{loadError}</p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      {backLink}
      <h1 className="font-heading text-2xl font-semibold">Post a requirement or offer</h1>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind of post">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={form.kind === kind}
            onClick={() => patch({ kind })}
            className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
              form.kind === kind
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {POST_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <TextField
          label={form.kind === 'requirement' ? 'What do you need?' : 'What are you offering?'}
          required
          value={form.title}
          onChange={(v) => patch({ title: v })}
          maxLength={POST_TITLE_MAX}
          placeholder={TITLE_PLACEHOLDERS[form.kind]}
        />
        <TextField
          label={`${POST_TERMS_LABELS[form.kind]} (optional)`}
          value={form.terms}
          onChange={(v) => patch({ terms: v })}
          maxLength={POST_TERMS_MAX}
          placeholder={form.kind === 'requirement' ? 'e.g. 200 pieces, ₹15,000' : 'e.g. ₹450 a piece'}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--color-text-muted)]">Details (optional)</span>
          <textarea
            value={form.details}
            onChange={(e) => patch({ details: e.target.value })}
            rows={3}
            maxLength={POST_DETAILS_MAX}
            placeholder="Anything that helps members decide whether they can help."
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y"
          />
        </label>
        <SelectField
          label="Industry"
          required
          value={form.category}
          onChange={(v) => patch({ category: v })}
          options={[{ value: '', label: 'Select…' }, ...BUSINESS_CATEGORY_OPTIONS]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label={<FromProfileLabel text="City (optional)" marked={fromProfile.has('city')} />}
            value={form.city}
            onChange={(v) => patch({ city: v })}
            placeholder="e.g. Jaipur"
          />
          <SelectField
            label={<FromProfileLabel text="State (optional)" marked={fromProfile.has('state')} />}
            value={form.state}
            onChange={(v) => patch({ state: v })}
            options={[{ value: '', label: 'Select…' }, ...INDIAN_STATE_OPTIONS]}
          />
        </div>
        {businesses.length > 0 && (
          <SelectField
            label="Post as"
            value={form.business_id}
            onChange={handlePostAs}
            options={[
              { value: '', label: 'Just me' },
              ...businesses.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        )}
        <div className="flex flex-col gap-1">
          <TextField
            label={
              <FromProfileLabel
                text="Contact number"
                marked={fromProfile.has('contact_phone') && form.business_id === ''}
              />
            }
            required
            type="tel"
            prefix="+91"
            maxLength={10}
            value={form.contact_phone.replace(/^\+91/, '')}
            onChange={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, 10)
              patch({ contact_phone: digits ? `+91${digits}` : '' })
            }}
            placeholder="98765 43210"
          />
          <span className="text-xs text-[var(--color-text-muted)]">
            Only shown to members who tap Respond.
          </span>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        Posts stay up for 30 days. You can close or renew them from Mine.
      </p>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
      >
        {saving ? 'Posting…' : 'Post'}
      </button>
    </div>
  )
}
