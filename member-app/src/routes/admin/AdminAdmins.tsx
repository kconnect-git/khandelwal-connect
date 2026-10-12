import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useAdmin } from '../../context/AdminContext'
import {
  ADMIN_ROLE_LABELS,
  adminGrant,
  adminListAdmins,
  adminRevoke,
  adminSearchMembers,
  adminSetRole,
} from '../../lib/admin'
import type { AdminListRow, AdminRoleName, AdminSearchMemberRow } from '../../types/database'

// Phase 5b-2: who can use the console. Every admin can see the list;
// changing it is super_admin only (the RPCs enforce that, plus "never on
// yourself" and "never leave zero super admins"). New admins are picked from
// approved members -- there is no invite-by-email path into the console.

const ROLE_OPTIONS: AdminRoleName[] = ['moderator', 'super_admin']

const ROLE_HELP: Record<AdminRoleName, string> = {
  moderator: 'Runs the approval queues, members table and business moderation.',
  super_admin:
    'Everything a moderator can do, plus revoking memberships, CSV export and managing admins.',
}

type PendingAction =
  | { kind: 'grant'; member: AdminSearchMemberRow; role: AdminRoleName }
  | { kind: 'role'; admin: AdminListRow; role: AdminRoleName }
  | { kind: 'revoke'; admin: AdminListRow }

function adminName(admin: AdminListRow): string {
  return admin.full_name ?? admin.email ?? 'Unnamed admin'
}

const SELECT_CLASS =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50'
const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'

export function AdminAdmins() {
  const { role: myRole, authUserId } = useAdmin()
  const canManage = myRole === 'super_admin'

  const [admins, setAdmins] = useState<AdminListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<PendingAction | null>(null)

  // "Add admin" search.
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<AdminSearchMemberRow[]>([])
  const [searching, setSearching] = useState(false)
  const [newRole, setNewRole] = useState<AdminRoleName>('moderator')

  const load = useCallback(async () => {
    setAdmins(await adminListAdmins())
  }, [])

  useEffect(() => {
    let cancelled = false
    load().catch((err) => {
      console.error('[AdminAdmins] failed to load', err)
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load admins.')
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    const term = search.trim()
    if (!canManage || term.length < 2) return
    let cancelled = false
    const handle = setTimeout(() => {
      setSearching(true)
      adminSearchMembers({ status: 'approved', search: term }, { limit: 8 })
        .then((rows) => {
          if (!cancelled) setResults(rows)
        })
        .catch((err) => console.error('[AdminAdmins] member search failed', err))
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [search, canManage])

  async function run(pending: PendingAction) {
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'grant') {
        await adminGrant(pending.member.id, pending.role)
        setSearch('')
      } else if (pending.kind === 'role') {
        await adminSetRole(pending.admin.auth_user_id, pending.role)
      } else {
        await adminRevoke(pending.admin.auth_user_id)
      }
      setAction(null)
      await load()
    } catch (err) {
      console.error('[AdminAdmins] change failed', err)
      setError(err instanceof Error ? err.message : 'Could not change admin access.')
      setAction(null)
    } finally {
      setBusy(false)
    }
  }

  // Stale results from a longer query are kept in state but not shown once
  // the box drops below two characters.
  const visibleResults = search.trim().length >= 2 ? results : []
  const adminPersonIds = new Set(admins?.map((admin) => admin.person_id).filter(Boolean))

  const dialog = (() => {
    if (!action) return { title: '', description: undefined, confirmLabel: 'Confirm' }
    if (action.kind === 'grant') {
      return {
        title: `Make ${action.member.full_name} a ${ADMIN_ROLE_LABELS[action.role].toLowerCase()}?`,
        description: ROLE_HELP[action.role],
        confirmLabel: 'Make admin',
      }
    }
    if (action.kind === 'role') {
      return {
        title: `Change ${adminName(action.admin)} to ${ADMIN_ROLE_LABELS[action.role].toLowerCase()}?`,
        description: ROLE_HELP[action.role],
        confirmLabel: 'Change role',
      }
    }
    return {
      title: `Remove ${adminName(action.admin)} as an admin?`,
      description: 'They keep their membership, but lose access to the admin console straight away.',
      confirmLabel: 'Remove admin',
    }
  })()

  return (
    <div className="flex flex-col gap-6">
      {!canManage && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Only a super admin can add or remove admins or change roles.
        </p>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {admins === null ? (
        !error && <p className="text-sm text-[var(--color-text-muted)]">Loading admins…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {admins.map((admin) => {
            const isMe = admin.auth_user_id === authUserId
            const editable = canManage && !isMe
            return (
              <li
                key={admin.auth_user_id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <Avatar name={adminName(admin)} photoUrl={admin.profile_photo_url} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {admin.person_id ? (
                        <Link
                          to={`/admin/members/${admin.person_id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {adminName(admin)}
                        </Link>
                      ) : (
                        adminName(admin)
                      )}
                      {isMe && (
                        <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs break-all text-[var(--color-text-muted)]">
                      {[admin.member_code, admin.email].filter(Boolean).join(' · ') ||
                        'No member profile'}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {editable ? (
                    <>
                      <select
                        aria-label={`Role for ${adminName(admin)}`}
                        value={admin.role}
                        disabled={busy}
                        onChange={(event) =>
                          setAction({
                            kind: 'role',
                            admin,
                            role: event.target.value as AdminRoleName,
                          })
                        }
                        className={SELECT_CLASS}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ADMIN_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setAction({ kind: 'revoke', admin })}
                        disabled={busy}
                        className={BUTTON}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-[var(--color-text-muted)]">
                      {ADMIN_ROLE_LABELS[admin.role]}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canManage && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Add an admin</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Search approved members by name, member ID, mobile or email.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search approved members"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <select
              aria-label="Role for the new admin"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as AdminRoleName)}
              className={SELECT_CLASS}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ADMIN_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{ROLE_HELP[newRole]}</p>

          {searching && <p className="text-sm text-[var(--color-text-muted)]">Searching…</p>}
          {!searching && search.trim().length >= 2 && visibleResults.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No approved members match.</p>
          )}
          {visibleResults.length > 0 && (
            <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
              {visibleResults.map((member) => {
                const already = adminPersonIds.has(member.id)
                return (
                  <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={member.full_name} photoUrl={member.profile_photo_url} size={28} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{member.full_name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {[member.member_code, member.current_city].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    {already ? (
                      <span className="text-xs text-[var(--color-text-muted)]">Already an admin</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAction({ kind: 'grant', member, role: newRole })}
                        disabled={busy}
                        className={BUTTON}
                      >
                        Add
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={action !== null}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        busy={busy}
        onConfirm={() => {
          if (action) run(action)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
