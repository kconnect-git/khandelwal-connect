import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SelectField } from '../../components/form/SelectField'
import { TextField } from '../../components/form/TextField'
import { MatrimonyPhotoManager } from '../../components/matrimony/MatrimonyPhotoManager'
import { ManageMatrimony } from '../../components/matrimony/ManageMatrimony'
import {
  ABOUT_FAMILY_MAX,
  ABOUT_ME_MAX,
  DIET_OPTIONS,
  HABIT_OPTIONS,
  HEIGHT_OPTIONS,
  MATRIMONY_STATUS_LABELS,
  NAKSHATRA_OPTIONS,
  PARTNER_EXPECTATIONS_MAX,
  RASHI_OPTIONS,
  getMyMatrimony,
  matrimonyFormValues,
  saveMyMatrimony,
  submitMyMatrimony,
  type MatrimonyFormValues,
} from '../../lib/matrimony'
import { ageFromDob } from '../../lib/people'
import type { Option } from '../../lib/formOptions'
import type { MyMatrimony } from '../../types/database'

// Phase 6a: the member's own matrimony profile. Basics come read-only from
// the main profile; this page owns the about text, photos and opt-in
// details. Opt-in fields start on "Don't show" and stay hidden unless the
// member picks a value -- never pre-filled (project context §7).

const DONT_SHOW: Option = { value: '', label: "Don't show" }

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      {hint && <p className="text-sm text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  max,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  max: number
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={max}
        placeholder={placeholder}
        disabled={disabled}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)] resize-y disabled:opacity-60"
      />
      <span className="self-end text-xs text-[var(--color-text-muted)]">
        {value.length} / {max}
      </span>
    </label>
  )
}

function StatusBanner({ data }: { data: MyMatrimony }) {
  const profile = data.profile
  const status = profile?.status ?? 'draft'
  const messages: Record<typeof status, string> = {
    draft: 'Not submitted yet. Nobody else can see this profile.',
    pending:
      'An admin is reviewing your profile. You can keep editing while you wait.',
    changes_requested: 'An admin asked for changes before your profile can go live:',
    approved: 'Your profile is verified. Changes you make now go live without another review.',
    rejected: 'Your profile was turned down. You can delete it below and start again.',
    paused: 'Your profile is paused. Nobody new can find you; your matches still work.',
    hidden: 'An admin has hidden your profile from other members:',
  }
  const accent = status === 'changes_requested' || status === 'rejected' || status === 'hidden'
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        accent ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
      } bg-[var(--color-surface)]`}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
        {MATRIMONY_STATUS_LABELS[status]}
      </p>
      <p className="mt-1">{messages[status]}</p>
      {accent && profile?.review_note && (
        <p className="mt-2 border-l-2 border-[var(--color-border)] pl-3 whitespace-pre-line">
          {profile.review_note}
        </p>
      )}
    </div>
  )
}

export function MyMatrimonyProfile() {
  const [data, setData] = useState<MyMatrimony | null>(null)
  const [values, setValues] = useState<MatrimonyFormValues>(matrimonyFormValues(null))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Reload from the server. Form values are only re-seeded when asked, so
   *  a photo change doesn't wipe unsaved text. */
  const load = useCallback(async (reseed: boolean) => {
    const next = await getMyMatrimony()
    setData(next)
    if (reseed) setValues(matrimonyFormValues(next?.profile ?? null))
  }, [])

  useEffect(() => {
    load(true)
      .catch((err) => {
        console.error('[MyMatrimonyProfile] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading your profile.')
      })
      .finally(() => setLoading(false))
  }, [load])

  function patch(next: Partial<MatrimonyFormValues>) {
    setValues((current) => ({ ...current, ...next }))
    setNotice(null)
  }

  async function handleSave() {
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      await saveMyMatrimony(values)
      await load(true)
      setNotice('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmit() {
    setBusy('submit')
    setError(null)
    setNotice(null)
    try {
      await saveMyMatrimony(values)
      await submitMyMatrimony()
      await load(true)
      setNotice('Submitted. An admin will review your profile.')
    } catch (err) {
      // The save may have gone through even if the submit didn't.
      await load(false).catch(() => {})
      setError(err instanceof Error ? err.message : 'Could not submit your profile.')
    } finally {
      setBusy(null)
    }
  }

  const backLink = (
    <Link
      to="/matrimony"
      className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      ‹ Matrimony
    </Link>
  )

  if (loading) {
    return (
      <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">Loading your profile…</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <p className="text-sm text-[var(--color-accent)]">{error ?? 'Profile not found.'}</p>
      </div>
    )
  }

  const { basics, profile, photos, ineligible_reason: ineligible } = data
  const status = profile?.status ?? 'draft'

  // Nothing started and not eligible: explain, don't show an empty form.
  if (ineligible && !profile) {
    return (
      <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <h1 className="font-heading text-2xl font-semibold">My matrimony profile</h1>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 flex flex-col gap-3">
          <p>You can't create a matrimony profile yet.</p>
          <p className="text-sm text-[var(--color-text-muted)]">{ineligible}</p>
          <Link
            to="/profile"
            className="self-start rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
          >
            Go to my profile
          </Link>
        </div>
      </div>
    )
  }

  const locked = status === 'rejected'
  const canSubmit = status === 'draft' || status === 'changes_requested'
  const age = ageFromDob(basics.dob ?? '')
  const basicsRows: { label: string; value: string | null }[] = [
    { label: 'Name', value: basics.full_name },
    { label: 'Age', value: age === null ? null : `${age} years` },
    { label: 'Gotra', value: basics.gotra },
    {
      label: 'Lives in',
      value: [basics.current_city, basics.current_state].filter(Boolean).join(', ') || null,
    },
    { label: 'Education', value: basics.education },
    { label: 'Occupation', value: basics.occupation_type },
  ]

  return (
    <div className="flex-1 flex flex-col gap-8 px-5 py-8 max-w-2xl mx-auto w-full">
      <div className="flex flex-col gap-4">
        {backLink}
        <h1 className="font-heading text-2xl font-semibold">My matrimony profile</h1>
        <StatusBanner data={data} />
        {ineligible && (
          <p className="rounded-xl border border-[var(--color-accent)] px-4 py-3 text-sm">
            {ineligible}{' '}
            <Link to="/profile" className="underline underline-offset-2">
              Update your profile
            </Link>
          </p>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Basics"
          hint="Taken from your main profile. Your surname, contact details and family are only shared once you and someone else both say yes."
        />
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          {basicsRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 sm:flex-col sm:gap-0">
              <dt className="text-sm text-[var(--color-text-muted)]">{row.label}</dt>
              <dd className="text-right sm:text-left">{row.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <Link
          to="/profile"
          className="self-start text-sm text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
        >
          Edit these on your profile
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="About" />
        <SelectField
          label="Height"
          required
          value={values.height_cm}
          onChange={(v) => patch({ height_cm: v })}
          options={HEIGHT_OPTIONS}
          disabled={locked}
        />
        <TextAreaField
          label="About me"
          value={values.about_me}
          onChange={(v) => patch({ about_me: v })}
          max={ABOUT_ME_MAX}
          placeholder="Your work, interests, what a day looks like…"
          disabled={locked}
        />
        <TextAreaField
          label="About my family (optional)"
          value={values.about_family}
          onChange={(v) => patch({ about_family: v })}
          max={ABOUT_FAMILY_MAX}
          disabled={locked}
        />
        <TextAreaField
          label="What I'm looking for (optional)"
          value={values.partner_expectations}
          onChange={(v) => patch({ partner_expectations: v })}
          max={PARTNER_EXPECTATIONS_MAX}
          disabled={locked}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Photos"
          hint="Up to 3, optional. Only you and the admins can see them until you and someone else both say yes."
        />
        <MatrimonyPhotoManager
          photos={photos}
          disabled={locked}
          onChanged={() => load(false)}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Optional details"
          hint="None of these are shown unless you pick a value. Leave any on “Don't show” to keep it private."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SelectField
            label="Diet"
            value={values.diet}
            onChange={(v) => patch({ diet: v })}
            options={[DONT_SHOW, ...DIET_OPTIONS]}
            disabled={locked}
          />
          <SelectField
            label="Smoking"
            value={values.smoking}
            onChange={(v) => patch({ smoking: v })}
            options={[DONT_SHOW, ...HABIT_OPTIONS]}
            disabled={locked}
          />
          <SelectField
            label="Drinking"
            value={values.drinking}
            onChange={(v) => patch({ drinking: v })}
            options={[DONT_SHOW, ...HABIT_OPTIONS]}
            disabled={locked}
          />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Horoscope
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Birth time"
            type="time"
            value={values.birth_time}
            onChange={(v) => patch({ birth_time: v })}
            disabled={locked}
          />
          <TextField
            label="Birth place"
            value={values.birth_place}
            onChange={(v) => patch({ birth_place: v })}
            maxLength={100}
            disabled={locked}
          />
          <SelectField
            label="Rashi"
            value={values.rashi}
            onChange={(v) => patch({ rashi: v })}
            options={[DONT_SHOW, ...RASHI_OPTIONS]}
            disabled={locked}
          />
          <SelectField
            label="Nakshatra"
            value={values.nakshatra}
            onChange={(v) => patch({ nakshatra: v })}
            options={[DONT_SHOW, ...NAKSHATRA_OPTIONS]}
            disabled={locked}
          />
        </div>
      </section>

      {!locked && (
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
          {notice && !error && <p className="text-sm text-[var(--color-text-muted)]">{notice}</p>}
          <div className="flex flex-wrap gap-3">
            {canSubmit && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy !== null || Boolean(ineligible)}
                className="rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 px-6 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for review'}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className={
                canSubmit
                  ? 'rounded-lg border border-[var(--color-border)] py-2.5 px-6 font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-60 transition-colors'
                  : 'rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 px-6 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
              }
            >
              {busy === 'save' ? 'Saving…' : canSubmit ? 'Save draft' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {/* (6c) Pause / blocked / delete. Shown once a profile exists. After
          a delete, the reload finds none and the page starts over. */}
      {profile && (
        <ManageMatrimony
          status={profile.status}
          onChanged={async () => {
            setNotice(null)
            await load(true)
          }}
        />
      )}
    </div>
  )
}
