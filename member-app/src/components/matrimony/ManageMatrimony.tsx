import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  deleteMyMatrimony,
  listMyMatrimonyBlocks,
  setMatrimonyPaused,
  shortName,
  unblockMatrimonyPerson,
} from '../../lib/matrimony'
import type { MatrimonyBlockRow, MatrimonyStatus } from '../../types/database'

// Phase 6c: the owner's controls at the foot of /matrimony/profile -- pause
// or resume, the members they've blocked, and deleting the profile.

type ManageMatrimonyProps = {
  status: MatrimonyStatus
  onChanged: () => Promise<void> | void
}

const BUTTON =
  'self-start rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-60 transition-colors'

export function ManageMatrimony({ status, onChanged }: ManageMatrimonyProps) {
  const [blocks, setBlocks] = useState<MatrimonyBlockRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadBlocks = useCallback(async () => {
    setBlocks(await listMyMatrimonyBlocks())
  }, [])

  useEffect(() => {
    loadBlocks().catch((err) => console.error('[ManageMatrimony] failed to load blocks', err))
  }, [loadBlocks])

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const canPause = status === 'approved' || status === 'paused'

  return (
    <section className="flex flex-col gap-5 border-t border-[var(--color-border)] pt-6">
      <h2 className="font-heading text-lg font-semibold">Manage</h2>

      {canPause && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            {status === 'paused'
              ? 'Your profile is paused: nobody new can find you, and you can’t send or reply to interests. Your matches still work.'
              : 'Taking a break, or engaged? Pause to drop out of browsing. Your matches keep working.'}
          </p>
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await setMatrimonyPaused(status !== 'paused')
                await onChanged()
              }, 'Could not update your profile.')
            }
          >
            {status === 'paused' ? 'Resume my profile' : 'Pause my profile'}
          </button>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Blocked
          </h3>
          <ul className="flex flex-col gap-2">
            {blocks.map((block) => (
              <li
                key={block.person_id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <span>{shortName(block) || 'Member'}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await unblockMatrimonyPerson(block.person_id)
                      await loadBlocks()
                    }, 'Could not unblock.')
                  }
                  className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--color-text-muted)]">
          Deleting removes your matrimony profile, photos, interests and matches. Your main profile
          isn’t affected, and you can create a new matrimony profile later (it will need verifying
          again).
        </p>
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          Delete my matrimony profile
        </button>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete your matrimony profile?"
        description="Your profile, photos, interests and matches are removed for good. This can’t be undone."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() =>
          run(async () => {
            await deleteMyMatrimony()
            setConfirmDelete(false)
            await onChanged()
          }, 'Could not delete your profile.')
        }
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  )
}
