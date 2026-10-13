import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TabStrip } from '../../components/TabStrip'
import { useMatrimony } from '../../context/MatrimonyContext'
import {
  SHARE_ON_ACCEPT,
  listMyInterests,
  markInterestsSeen,
  respondInterest,
  shortName,
  signedPhotoUrls,
  withdrawInterest,
} from '../../lib/matrimony'
import type { MatrimonyBox, MatrimonyInterestRow } from '../../types/database'

// Phase 6b: the member's interests, one box per tab. Opening Received or
// Matches clears that part of the badge; the "New" tags come from the
// loaded rows, so they stay for this visit while the badge clears (same
// pattern as /notices).

const TABS: { key: MatrimonyBox; label: string }[] = [
  { key: 'received', label: 'Received' },
  { key: 'sent', label: 'Sent' },
  { key: 'matches', label: 'Matches' },
]

const EMPTY: Record<MatrimonyBox, string> = {
  received: 'No one is waiting on a reply from you.',
  sent: 'You haven’t expressed interest in anyone yet.',
  matches: 'No matches yet.',
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

const SMALL_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
const SMALL_ACCENT =
  'rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'

type PendingAction = { row: MatrimonyInterestRow; kind: 'accept' | 'decline' | 'withdraw' }

function isBox(value: string | null): value is MatrimonyBox {
  return TABS.some((tab) => tab.key === value)
}

export function MatrimonyInterests() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawBox = searchParams.get('box')
  const box: MatrimonyBox = isBox(rawBox) ? rawBox : 'received'
  const { refresh: refreshBadge } = useMatrimony()

  const [rows, setRows] = useState<MatrimonyInterestRow[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const next = await listMyInterests(box)
    setRows(next)
    const paths = next.map((row) => row.main_photo_path).filter((p): p is string => Boolean(p))
    setUrls(await signedPhotoUrls(paths))
    if (box !== 'sent' && next.some((row) => row.is_new)) {
      await markInterestsSeen(box)
      refreshBadge()
    }
  }, [box, refreshBadge])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    load().catch((err) => {
      if (cancelled) return
      console.error('[MatrimonyInterests] failed to load', err)
      setError(err instanceof Error ? err.message : 'Something went wrong loading interests.')
      setRows([])
    })
    return () => {
      cancelled = true
    }
  }, [load])

  async function run(pending: PendingAction) {
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'withdraw') await withdrawInterest(pending.row.interest_id)
      else await respondInterest(pending.row.interest_id, pending.kind === 'accept')
      setAction(null)
      await load()
      refreshBadge()
    } catch (err) {
      setAction(null)
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const dialog = action
    ? {
        accept: {
          title: `Accept ${shortName(action.row)}’s interest?`,
          description: SHARE_ON_ACCEPT,
          confirm: 'Accept',
        },
        decline: {
          title: 'Decline this interest?',
          description:
            'They won’t be told you declined. Their interest will just show as having no response.',
          confirm: 'Decline',
        },
        withdraw: {
          title: 'Withdraw your interest?',
          description: 'They won’t see it any more. You can express interest again later.',
          confirm: 'Withdraw',
        },
      }[action.kind]
    : null

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/matrimony"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Matrimony
      </Link>
      <h1 className="font-heading text-2xl font-semibold">Interests</h1>

      <TabStrip
        tabs={TABS}
        active={box}
        onChange={(key) => setSearchParams(key === 'received' ? {} : { box: key }, { replace: true })}
        label="Interest boxes"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{EMPTY[box]}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const name = row.full_name ?? shortName(row)
            const place = [row.current_city, row.current_state].filter(Boolean).join(', ')
            const when = row.responded_at ?? row.created_at
            return (
              <li
                key={row.interest_id}
                className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                <Link to={`/matrimony/${row.profile_id}`} className="flex items-start gap-3">
                  <Avatar
                    name={name || '?'}
                    photoUrl={row.main_photo_path ? (urls[row.main_photo_path] ?? null) : null}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {name}
                        {row.age !== null && (
                          <span className="text-[var(--color-text-muted)]">, {row.age}</span>
                        )}
                      </p>
                      {row.is_new && (
                        <span className="shrink-0 rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-xs text-[var(--color-accent)]">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {[place, row.gotra].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {box === 'sent' && row.status === 'no_response'
                        ? `Sent ${DATE_FORMAT.format(new Date(row.created_at))} · No response`
                        : box === 'matches'
                          ? `Matched ${DATE_FORMAT.format(new Date(when))}`
                          : `${box === 'sent' ? 'Sent' : 'Received'} ${DATE_FORMAT.format(new Date(row.created_at))}`}
                    </p>
                  </div>
                </Link>

                {row.message && box !== 'matches' && (
                  <p className="border-l-2 border-[var(--color-border)] pl-3 text-sm whitespace-pre-line">
                    {row.message}
                  </p>
                )}

                {box === 'received' && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={SMALL_ACCENT}
                      disabled={busy}
                      onClick={() => setAction({ row, kind: 'accept' })}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={busy}
                      onClick={() => setAction({ row, kind: 'decline' })}
                    >
                      Decline
                    </button>
                  </div>
                )}
                {box === 'sent' && row.status === 'pending' && (
                  <button
                    type="button"
                    className={`${SMALL_BUTTON} self-start`}
                    disabled={busy}
                    onClick={() => setAction({ row, kind: 'withdraw' })}
                  >
                    Withdraw
                  </button>
                )}
                {box === 'matches' && (
                  <Link to={`/matrimony/${row.profile_id}`} className={`${SMALL_BUTTON} self-start`}>
                    View contact details
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        description={dialog?.description}
        confirmLabel={dialog?.confirm ?? ''}
        confirmAccent={action?.kind === 'accept'}
        busy={busy}
        onConfirm={() => {
          if (action) run(action)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
