import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { businessMetaLine, getBusiness, listBusinesses } from '../lib/businesses'
import { searchRegisteredMembers, type MemberCandidate } from '../lib/familyDetails'
import {
  REFERRAL_NAME_MAX,
  REFERRAL_NOTE_MAX,
  giveBusinessReferral,
  validateReferral,
  type ReferralFormValues,
} from '../lib/businessReferrals'
import { Avatar } from '../components/Avatar'
import { TextField } from '../components/form/TextField'

// Phase 10.7: give a referral. The business comes pre-picked from its
// detail page (?business=<id>) or is searched for here; the lead is typed
// in or picked from the members. The consent box is required because the
// lead's number belongs to someone else.

type PickedBusiness = { id: string; name: string; logo_url: string | null; meta: string | null }

const EMPTY_FORM: ReferralFormValues = {
  business_id: '',
  lead_name: '',
  lead_phone: '',
  lead_person_id: null,
  note: '',
  consent: false,
}

const SECTION_LABEL = 'text-sm text-[var(--color-text-muted)]'
const RESULT_ROW =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors'

export function ReferralNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetBusinessId = searchParams.get('business')
  const [ownId, setOwnId] = useState<string | null>(null)
  const [form, setForm] = useState<ReferralFormValues>(EMPTY_FORM)
  const [business, setBusiness] = useState<PickedBusiness | null>(null)
  const [businessQuery, setBusinessQuery] = useState('')
  const [businessResults, setBusinessResults] = useState<PickedBusiness[]>([])
  const [leadMode, setLeadMode] = useState<'other' | 'member'>('other')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<MemberCandidate[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Who's asking (their own listings and themselves are left out of the
  // pickers), and the pre-picked business if any.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        const person = session ? await getOwnPerson(session.user.id) : null
        if (cancelled) return
        setOwnId(person?.id ?? null)
        if (presetBusinessId) {
          const loaded = await getBusiness(presetBusinessId)
          if (cancelled || !loaded || loaded.owner_id === person?.id) return
          setBusiness({
            id: loaded.id,
            name: loaded.name,
            logo_url: loaded.logo_url,
            meta: businessMetaLine(loaded),
          })
          setForm((f) => ({ ...f, business_id: loaded.id }))
        }
      } catch (err) {
        if (!cancelled) console.error('[ReferralNew] failed to load', err)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [presetBusinessId])

  // Business search, debounced.
  useEffect(() => {
    const query = businessQuery.trim()
    if (business || query.length < 2) return
    let cancelled = false
    const handle = setTimeout(() => {
      listBusinesses({ search: query, limit: 8 })
        .then((page) => {
          if (cancelled) return
          setBusinessResults(
            page
              .filter((b) => b.owner_id !== ownId)
              .map((b) => ({ id: b.id, name: b.name, logo_url: b.logo_url, meta: businessMetaLine(b) })),
          )
        })
        .catch((err) => console.error('[ReferralNew] business search failed', err))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [businessQuery, business, ownId])

  // Member search for the lead, debounced (the RPC needs 3+ characters).
  useEffect(() => {
    const query = memberQuery.trim()
    if (leadMode !== 'member' || form.lead_person_id || query.length < 3) return
    let cancelled = false
    const handle = setTimeout(() => {
      searchRegisteredMembers({ fullName: query })
        .then((rows) => {
          if (!cancelled) setMemberResults(rows.filter((m) => m.id !== ownId))
        })
        .catch((err) => console.error('[ReferralNew] member search failed', err))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [memberQuery, leadMode, form.lead_person_id, ownId])

  function patch(p: Partial<ReferralFormValues>) {
    setForm((f) => ({ ...f, ...p }))
  }

  function pickBusiness(picked: PickedBusiness) {
    setBusiness(picked)
    setBusinessResults([])
    setBusinessQuery('')
    patch({ business_id: picked.id })
  }

  function pickMember(member: MemberCandidate) {
    setMemberResults([])
    setMemberQuery('')
    patch({
      lead_person_id: member.id,
      lead_name: member.full_name,
      lead_phone: member.mobile_number ?? '',
    })
  }

  function switchLeadMode(mode: 'other' | 'member') {
    setLeadMode(mode)
    setMemberResults([])
    setMemberQuery('')
    patch({ lead_person_id: null, lead_name: '', lead_phone: '' })
  }

  async function handleSubmit() {
    setError(null)
    const message = validateReferral(form)
    if (message) {
      setError(message)
      return
    }
    setSaving(true)
    try {
      await giveBusinessReferral(form)
      navigate('/business/referrals?tab=given', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong sending this referral.')
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/business/referrals"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Referrals
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Give a referral</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Pass someone who needs something to a member’s business.
        </p>
      </div>

      {/* Business */}
      <section className="flex flex-col gap-2">
        <span className={SECTION_LABEL}>Business</span>
        {business ? (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <Avatar name={business.name} photoUrl={business.logo_url} size={40} />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="font-heading font-medium truncate">{business.name}</span>
              {business.meta && (
                <span className="text-sm text-[var(--color-text-muted)] truncate">{business.meta}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setBusiness(null)
                patch({ business_id: '' })
              }}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <TextField
              value={businessQuery}
              onChange={(v) => {
                setBusinessQuery(v)
                if (v.trim().length < 2) setBusinessResults([])
              }}
              placeholder="Search by business, owner, product or city…"
            />
            {businessResults.length > 0 && (
              <ul className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1">
                {businessResults.map((result) => (
                  <li key={result.id}>
                    <button type="button" onClick={() => pickBusiness(result)} className={RESULT_ROW}>
                      <Avatar name={result.name} photoUrl={result.logo_url} size={32} />
                      <span className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{result.name}</span>
                        {result.meta && (
                          <span className="text-xs text-[var(--color-text-muted)] truncate">{result.meta}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Lead */}
      <section className="flex flex-col gap-3">
        <span className={SECTION_LABEL}>Who are you referring?</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who are you referring?">
          {(['other', 'member'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={leadMode === mode}
              onClick={() => switchLeadMode(mode)}
              className={`rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                leadMode === mode
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {mode === 'other' ? 'Someone else' : 'A member'}
            </button>
          ))}
        </div>

        {leadMode === 'member' && !form.lead_person_id && (
          <>
            <TextField
              value={memberQuery}
              onChange={(v) => {
                setMemberQuery(v)
                if (v.trim().length < 3) setMemberResults([])
              }}
              placeholder="Search members by name (3+ letters)…"
            />
            {memberResults.length > 0 && (
              <ul className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1">
                {memberResults.map((member) => (
                  <li key={member.id}>
                    <button type="button" onClick={() => pickMember(member)} className={RESULT_ROW}>
                      <span className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{member.full_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)] truncate">
                          {[member.member_code, member.current_city].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {leadMode === 'member' && form.lead_person_id && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <span className="font-medium">{form.lead_name}</span>
            <button
              type="button"
              onClick={() => switchLeadMode('member')}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Change
            </button>
          </div>
        )}

        {(leadMode === 'other' || form.lead_person_id) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {leadMode === 'other' && (
              <TextField
                label="Their name"
                required
                value={form.lead_name}
                onChange={(v) => patch({ lead_name: v })}
                maxLength={REFERRAL_NAME_MAX}
              />
            )}
            <TextField
              label={leadMode === 'member' ? 'Their phone (optional)' : 'Their phone'}
              required={leadMode === 'other'}
              type="tel"
              prefix="+91"
              maxLength={10}
              value={form.lead_phone.replace(/^\+91/, '')}
              onChange={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 10)
                patch({ lead_phone: digits ? `+91${digits}` : '' })
              }}
              placeholder="98765 43210"
            />
          </div>
        )}
      </section>

      <label className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL}>What’s it for?</span>
        <textarea
          value={form.note}
          onChange={(e) => patch({ note: e.target.value })}
          rows={3}
          maxLength={REFERRAL_NOTE_MAX}
          placeholder="e.g. Needs 500 wedding cards printed by March"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => patch({ consent: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="flex flex-col">
          <span>I have their permission to share their details with this business</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            Only you and the business owner see the number, and it’s removed once the referral is
            closed or declined.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving}
        className="self-start rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
      >
        {saving ? 'Sending…' : 'Send referral'}
      </button>
    </div>
  )
}
