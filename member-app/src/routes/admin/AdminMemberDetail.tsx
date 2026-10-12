import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { AuditList } from '../../components/admin/AuditList'
import { StatusBadge } from '../../components/admin/StatusBadge'
import { useAdmin } from '../../context/AdminContext'
import { useMemberDecision } from '../../hooks/useMemberDecision'
import {
  adminGetMember,
  adminListAuditLog,
  formatAdminDate,
  formatAdminDateTime,
  isAdminDecision,
  resendMemberStatusEmail,
} from '../../lib/admin'
import type {
  AdminMemberDetail as MemberDetail,
  AuditLogRow,
  FamilyRelationSlot,
} from '../../types/database'

// Phase 5b-1: everything about one member, for reviewing them properly
// rather than from a queue row. 5a's "View" went to the member-facing
// /members/:id, which shows only the directory tier; this is the full row
// (admin_get_member), with the decision buttons and the member's audit
// history alongside.

const SLOT_LABELS: Record<FamilyRelationSlot, string> = {
  father: 'Father',
  mother: 'Mother',
  maternal_uncle: 'Maternal uncle (mama)',
  spouse: 'Spouse',
  spouse_father: "Spouse's father",
  spouse_mother: "Spouse's mother",
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
        {title}
      </h2>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        {children}
      </div>
    </section>
  )
}

/** A label/value grid. Empty values render as a dash rather than being
 *  dropped -- for review, "not filled in" is information. */
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
          <dd className="text-sm break-words">
            {value === null || value === undefined || value === '' ? '—' : value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function joinParts(...parts: (string | null)[]): string | null {
  return parts.filter(Boolean).join(', ') || null
}

const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
const ACCENT_BUTTON =
  'rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'

export function AdminMemberDetail() {
  const { id } = useParams<{ id: string }>()
  const { role } = useAdmin()
  const [member, setMember] = useState<MemberDetail | null | undefined>(undefined)
  const [history, setHistory] = useState<AuditLogRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [nextMember, nextHistory] = await Promise.all([
      adminGetMember(id),
      adminListAuditLog({ targetId: id, limit: 50 }),
    ])
    setMember(nextMember)
    setHistory(nextHistory)
  }, [id])

  useEffect(() => {
    let cancelled = false
    setError(null)
    load().catch((err) => {
      console.error('[AdminMemberDetail] failed to load', err)
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this member.')
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const decision = useMemberDecision({
    onDecided: async () => {
      setResendNote(null)
      await load()
    },
  })

  async function resend() {
    if (!member) return
    setResending(true)
    setResendNote(null)
    try {
      await resendMemberStatusEmail(member.id, member.member_status)
      setResendNote(`Email sent to ${member.email ?? member.full_name}.`)
    } catch (err) {
      setResendNote(
        `Could not send the email: ${err instanceof Error ? err.message : 'unknown error'}`,
      )
    } finally {
      setResending(false)
    }
  }

  const backLink = (
    <Link
      to="/admin/members"
      className="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
    >
      ← Members
    </Link>
  )

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-[var(--color-accent)]">{error}</p>
      </div>
    )
  }
  if (member === undefined) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading member…</p>
  }
  if (member === null) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">No member with this ID.</p>
      </div>
    )
  }

  const status = member.member_status
  const busy = decision.busyId === member.id
  // Same availability rules as the queue rows, and admin_set_member_status
  // enforces them regardless.
  const canApprove = status === 'pending' || status === 'info_requested' || status === 'rejected'
  const canRequestInfo = canApprove
  const canTurnDown = status === 'pending' || status === 'info_requested'
  const canRevoke = status === 'approved' && role === 'super_admin'

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      <div className="flex items-start gap-4">
        <Avatar name={member.full_name} photoUrl={member.profile_photo_url} size={64} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold break-words">{member.full_name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {member.member_code && (
              <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
                {member.member_code}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--color-text-muted)] break-all">
            {[member.email, member.mobile_number].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <Section title="Review">
        <div className="flex flex-col gap-4">
          <Fields
            rows={[
              ['Signed up', formatAdminDateTime(member.created_at)],
              ['Submitted for review', formatAdminDateTime(member.submitted_at)],
              [
                'Last reviewed',
                member.reviewed_at
                  ? `${formatAdminDateTime(member.reviewed_at)}${
                      member.reviewed_by_name ? ` by ${member.reviewed_by_name}` : ''
                    }`
                  : status === 'approved'
                    ? 'Approved before review existed'
                    : null,
              ],
              ['Hides mobile from members', member.hide_mobile ? 'Yes' : 'No'],
            ]}
          />
          {member.admin_message && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-[var(--color-text-muted)]">
                {status === 'rejected' ? 'Reason given' : 'Information requested'}
              </p>
              <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                {member.admin_message}
              </p>
            </div>
          )}

          {status === 'onboarding' ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              This person hasn’t finished onboarding, so there is nothing to review yet.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {canApprove && (
                <button type="button" onClick={() => decision.approve(member)} disabled={busy} className={ACCENT_BUTTON}>
                  Approve
                </button>
              )}
              {canRequestInfo && (
                <button type="button" onClick={() => decision.requestInfo(member)} disabled={busy} className={BUTTON}>
                  Request info
                </button>
              )}
              {(canTurnDown || canRevoke) && (
                <button type="button" onClick={() => decision.reject(member)} disabled={busy} className={BUTTON}>
                  {status === 'approved' ? 'Revoke' : 'Turn down'}
                </button>
              )}
              {isAdminDecision(status) && (
                <button type="button" onClick={resend} disabled={resending || busy} className={BUTTON}>
                  {resending ? 'Sending…' : 'Resend status email'}
                </button>
              )}
            </div>
          )}

          {decision.error && <p className="text-sm text-[var(--color-accent)]">{decision.error}</p>}
          {decision.emailNote}
          {resendNote && <p className="text-sm text-[var(--color-text-muted)]">{resendNote}</p>}
        </div>
      </Section>

      <Section title="Personal">
        <Fields
          rows={[
            ['First name', member.first_name],
            ['Middle name', member.middle_name],
            ['Last name', member.last_name],
            ['Gender', member.gender],
            ['Date of birth', formatAdminDate(member.dob)],
            ['Birth place', member.birth_place],
            ['Blood group', member.blood_group],
            ['Marital status', member.marital_status],
            ['Date of marriage', formatAdminDate(member.date_of_marriage)],
            ['Qualification', member.education],
          ]}
        />
      </Section>

      <Section title="Background & location">
        <Fields
          rows={[
            ['Gotra', member.gotra],
            ['Native place', member.native_place],
            ['City', member.current_city],
            ['District', member.current_district],
            ['State', member.current_state],
            ['Pincode', member.pincode],
            [
              'Address',
              joinParts(member.home_address, member.address_line2, member.address_line3),
            ],
          ]}
        />
      </Section>

      <Section title="Contact & work">
        <Fields
          rows={[
            ['Mobile', member.mobile_number],
            ['Login email', member.email],
            ['Secondary email', member.secondary_email],
            ['Secondary mobile', member.secondary_mobile],
            ['Residence phone', member.residence_phone],
            ['Occupation', member.occupation_type],
            ['Job title', member.job_title],
            ['Company', member.company_name],
            ['Job location', member.job_location],
          ]}
        />
      </Section>

      <Section title="Family">
        {member.family_relations.length === 0 && member.children.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No family details added.</p>
        ) : (
          <Fields
            rows={[
              ...member.family_relations.map((relation): [string, ReactNode] => [
                SLOT_LABELS[relation.slot],
                [relation.related_name, relation.related_member_code, relation.mobile_number]
                  .filter(Boolean)
                  .join(' · ') || null,
              ]),
              ...member.children.map((child, index): [string, ReactNode] => [
                `${child.relation ?? 'Child'} ${member.children.length > 1 ? index + 1 : ''}`.trim(),
                [child.child_name, child.child_member_code, formatAdminDate(child.child_dob)]
                  .filter(Boolean)
                  .join(' · '),
              ]),
            ]}
          />
        )}
      </Section>

      <Section title="Businesses">
        {member.businesses.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No business listings.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {member.businesses.map((business) => (
              <li key={business.id} className="text-sm">
                <span className="font-medium">{business.name}</span>
                <span className="text-[var(--color-text-muted)]">
                  {' · '}
                  {[business.category, business.city].filter(Boolean).join(' · ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
          History
        </h2>
        <AuditList rows={history} showTarget={false} empty="No admin actions on this member yet." />
      </section>

      {decision.dialog}
    </div>
  )
}
