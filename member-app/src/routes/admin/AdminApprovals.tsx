import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { TabStrip } from '../../components/TabStrip'
import { MemberApprovals } from '../../components/admin/MemberApprovals'
import { EventApprovals } from '../../components/admin/EventApprovals'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { adminListEvents, adminListMembers } from '../../lib/admin'

// (5a) The admin landing page: both approval queues in one place, instead of
// two separate pages reached from the account menu. The is_admin() gate lives
// here so the panels don't each repeat it -- and every RPC re-checks it
// server-side regardless.
//
// Phase 5b turns this into one section of a proper console (an AdminLayout
// with Overview / Members / Businesses / Audit / Admins alongside it); the
// panels are already split out ready for that.

type ApprovalTab = 'members' | 'events'

function isApprovalTab(value: string | null): value is ApprovalTab {
  return value === 'members' || value === 'events'
}

export function AdminApprovals() {
  const admin = useIsAdmin(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: ApprovalTab = isApprovalTab(tabParam) ? tabParam : 'members'

  // Counts for the tab badges, so an admin can see where work is waiting
  // without opening both. One row each (the RPCs return total_count on every
  // row), refetched whenever a panel reports a decision.
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [eventCount, setEventCount] = useState<number | null>(null)

  const loadCounts = useCallback(async () => {
    const [members, events] = await Promise.all([
      adminListMembers({ status: 'pending', limit: 1 }),
      adminListEvents({ status: 'pending', limit: 1 }),
    ])
    setMemberCount(members.length > 0 ? Number(members[0].total_count) : 0)
    setEventCount(events.length > 0 ? Number(events[0].total_count) : 0)
  }, [])

  useEffect(() => {
    if (admin !== true) return
    let cancelled = false
    loadCounts().catch((err) => {
      if (cancelled) return
      // Non-fatal: the badges just stay blank, the queues below still work.
      console.error('[AdminApprovals] failed to load pending counts', err)
    })
    return () => {
      cancelled = true
    }
  }, [admin, loadCounts])

  if (admin === null) {
    return (
      <div className="flex-1 flex flex-col px-5 py-10 max-w-2xl mx-auto w-full">
        <p className="text-sm text-[var(--color-text-muted)]">Checking access…</p>
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Not authorised</h1>
        <p className="text-[var(--color-text-muted)]">This page is for admins only.</p>
        <Link
          to="/dashboard"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  const label = (base: string, count: number | null) =>
    count && count > 0 ? `${base} (${count})` : base

  return (
    // Wider than the member-facing pages (max-w-2xl): these are tables, and
    // on a laptop the columns need the room. Mobile is unaffected.
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-5xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">Approvals</h1>

      <TabStrip
        tabs={[
          { key: 'members' as const, label: label('Members', memberCount) },
          { key: 'events' as const, label: label('Events', eventCount) },
        ]}
        active={tab}
        onChange={(key) => {
          // Drop the members panel's ?status= when leaving it, so coming back
          // starts on Pending rather than wherever it was left.
          const next = new URLSearchParams()
          if (key !== 'members') next.set('tab', key)
          setSearchParams(next, { replace: true })
        }}
        label="Approval queues"
      />

      {tab === 'members' ? (
        <MemberApprovals onChanged={loadCounts} />
      ) : (
        <EventApprovals onChanged={loadCounts} />
      )}
    </div>
  )
}
