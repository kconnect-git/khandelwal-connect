import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MultiChipSelect } from '../../components/MultiChipSelect'
import { adminMemberFilterOptions, type AdminMemberFilterOptions } from '../../lib/admin'
import {
  EMPTY_AUDIENCE,
  adminCountNoticeAudience,
  adminGetNotice,
  adminSaveNotice,
  adminSetNoticeStatus,
  audienceSummary,
  dateInputFromExpiry,
  expiryFromDateInput,
  noticeAudience,
} from '../../lib/notices'
import { OCCUPATION_OPTIONS } from '../../lib/formOptions'
import type { NoticeAudience, NoticeStatus } from '../../types/database'

// Phase 5c: compose / edit one notice. /admin/notices/new starts a draft;
// /admin/notices/:id edits it. The live "will reach N members" count runs
// the same audience predicate the member reads use (notice_audience_matches).

const TITLE_MAX = 120
const BODY_MAX = 4000

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60'
const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
const ACCENT_BUTTON =
  'rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'

function todayInputValue(): string {
  return dateInputFromExpiry(new Date().toISOString())
}

export function AdminNoticeEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === undefined

  const [status, setStatus] = useState<NoticeStatus>('draft')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<NoticeAudience>(EMPTY_AUDIENCE)
  const [expiryDate, setExpiryDate] = useState('')
  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)

  const [options, setOptions] = useState<AdminMemberFilterOptions | null>(null)
  const [reach, setReach] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | null>(null)

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    adminGetNotice(id)
      .then((notice) => {
        if (cancelled) return
        if (!notice) {
          setNotFound(true)
        } else {
          setStatus(notice.status)
          setTitle(notice.title)
          setBody(notice.body)
          setAudience(noticeAudience(notice))
          setExpiryDate(dateInputFromExpiry(notice.expires_at))
        }
        setLoaded(true)
      })
      .catch((err) => {
        console.error('[AdminNoticeEditor] failed to load', err)
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this notice.')
      })
    return () => {
      cancelled = true
    }
  }, [id, isNew])

  useEffect(() => {
    let cancelled = false
    adminMemberFilterOptions()
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch((err) => console.error('[AdminNoticeEditor] failed to load audience options', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Live reach, debounced so ticking through chips doesn't fire per click.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      adminCountNoticeAudience(audience)
        .then((count) => {
          if (!cancelled) setReach(count)
        })
        .catch((err) => console.error('[AdminNoticeEditor] failed to count audience', err))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [audience])

  const readOnly = status === 'withdrawn'
  const valid = title.trim().length > 0 && body.trim().length > 0

  async function save(): Promise<string | null> {
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      const savedId = await adminSaveNotice(isNew ? null : id, {
        title,
        body,
        audience,
        expiresAt: expiryFromDateInput(expiryDate),
      })
      return savedId
    } catch (err) {
      console.error('[AdminNoticeEditor] save failed', err)
      setError(err instanceof Error ? err.message : 'Could not save this notice.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveOnly() {
    const savedId = await save()
    if (!savedId) return
    if (isNew) {
      navigate(`/admin/notices/${savedId}`, { replace: true })
    }
    setNote(status === 'published' ? 'Saved. Members see the updated notice now.' : 'Draft saved.')
  }

  async function publish() {
    const savedId = await save()
    if (!savedId) {
      setConfirm(null)
      return
    }
    setSaving(true)
    try {
      await adminSetNoticeStatus(savedId, 'published')
      navigate('/admin/notices', { replace: true })
    } catch (err) {
      console.error('[AdminNoticeEditor] publish failed', err)
      setError(err instanceof Error ? err.message : 'Could not publish this notice.')
      // The draft did save; make sure further edits go to it, not a new one.
      if (isNew) navigate(`/admin/notices/${savedId}`, { replace: true })
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  async function withdraw() {
    if (isNew) return
    setSaving(true)
    setError(null)
    try {
      await adminSetNoticeStatus(id, 'withdrawn')
      setStatus('withdrawn')
      setNote('Withdrawn. Members no longer see it.')
    } catch (err) {
      console.error('[AdminNoticeEditor] withdraw failed', err)
      setError(err instanceof Error ? err.message : 'Could not withdraw this notice.')
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  const backLink = (
    <Link
      to="/admin/notices"
      className="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
    >
      ← Notices
    </Link>
  )

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">No notice with this ID.</p>
      </div>
    )
  }
  if (!loaded) {
    return error ? (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-[var(--color-accent)]">{error}</p>
      </div>
    ) : (
      <p className="text-sm text-[var(--color-text-muted)]">Loading notice…</p>
    )
  }

  const reachLine =
    reach === null
      ? 'Counting members…'
      : `Will reach ${reach} approved ${reach === 1 ? 'member' : 'members'}`

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {backLink}

      <h2 className="font-heading text-xl font-semibold">
        {isNew
          ? 'New notice'
          : status === 'draft'
            ? 'Edit draft'
            : status === 'published'
              ? 'Edit published notice'
              : 'Withdrawn notice'}
      </h2>

      {readOnly && (
        <p className="text-sm text-[var(--color-text-muted)]">
          This notice was withdrawn and can no longer be edited. Start a new notice to send it again.
        </p>
      )}
      {status === 'published' && (
        <p className="text-sm text-[var(--color-text-muted)]">
          This notice is live. Changes reach members as soon as you save; anyone who has already
          read it won’t see it as new again.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="notice-title"
          value={title}
          maxLength={TITLE_MAX}
          disabled={readOnly}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Annual general meeting on 14 December"
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-body" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="notice-body"
          value={body}
          maxLength={BODY_MAX}
          rows={7}
          disabled={readOnly}
          onChange={(event) => setBody(event.target.value)}
          className={`${INPUT_CLASS} resize-y`}
        />
        <p className="self-end text-xs text-[var(--color-text-muted)]">
          {body.length} / {BODY_MAX}
        </p>
      </div>

      <fieldset className="flex flex-col gap-3" disabled={readOnly}>
        <legend className="text-sm font-medium">Audience</legend>
        <p className="text-xs text-[var(--color-text-muted)]">
          Leave everything empty to send to every approved member. Several values in one row mean
          any of them; filling several rows narrows it to members matching all of them.
        </p>
        <div className="flex flex-col gap-2.5">
          <MultiChipSelect
            label="State"
            values={audience.states}
            options={options?.states ?? []}
            onChange={(states) => setAudience({ ...audience, states })}
          />
          <MultiChipSelect
            label="City"
            values={audience.cities}
            options={options?.cities ?? []}
            onChange={(cities) => setAudience({ ...audience, cities })}
          />
          <MultiChipSelect
            label="Gotra"
            values={audience.gotras}
            options={options?.gotras ?? []}
            onChange={(gotras) => setAudience({ ...audience, gotras })}
          />
          <MultiChipSelect
            label="Occupation"
            values={audience.occupations}
            options={OCCUPATION_OPTIONS}
            onChange={(occupations) => setAudience({ ...audience, occupations })}
          />
        </div>
        <p
          className={`text-sm font-medium ${
            reach === 0 ? 'text-[var(--color-accent)]' : ''
          }`}
          aria-live="polite"
        >
          {reachLine}
          {reach === 0 && ' — nobody matches this audience'}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-expiry" className="text-sm font-medium">
          Show until <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="notice-expiry"
            type="date"
            value={expiryDate}
            min={todayInputValue()}
            disabled={readOnly}
            onChange={(event) => setExpiryDate(event.target.value)}
            className={`${INPUT_CLASS} w-auto`}
          />
          {expiryDate && !readOnly && (
            <button
              type="button"
              onClick={() => setExpiryDate('')}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {expiryDate
            ? 'It stops showing after the end of that day.'
            : 'Without a date it shows until you withdraw it.'}
        </p>
      </div>

      {(title.trim() || body.trim()) && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Preview · {audienceSummary(audience)}
          </h3>
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-4">
            <p className="font-heading text-lg font-semibold break-words">{title || 'Untitled'}</p>
            <p className="text-sm whitespace-pre-line break-words">{body}</p>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {note && <p className="text-sm text-[var(--color-text-muted)]">{note}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {status === 'draft' && (
            <button
              type="button"
              onClick={() => setConfirm('publish')}
              disabled={!valid || saving || reach === 0}
              className={ACCENT_BUTTON}
            >
              Publish
            </button>
          )}
          <button type="button" onClick={saveOnly} disabled={!valid || saving} className={BUTTON}>
            {saving ? 'Saving…' : status === 'draft' ? 'Save draft' : 'Save changes'}
          </button>
          {status === 'published' && (
            <button
              type="button"
              onClick={() => setConfirm('withdraw')}
              disabled={saving}
              className="px-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              Withdraw
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'publish' ? `Publish "${title.trim()}"?` : `Withdraw "${title.trim()}"?`}
        description={
          confirm === 'publish'
            ? `It goes out to ${reach ?? '…'} ${reach === 1 ? 'member' : 'members'} straight away.`
            : 'Members stop seeing it immediately. This can’t be undone.'
        }
        confirmLabel={confirm === 'publish' ? 'Publish' : 'Withdraw'}
        confirmAccent={confirm === 'publish'}
        busy={saving}
        onConfirm={() => {
          if (confirm === 'publish') publish()
          else withdraw()
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
