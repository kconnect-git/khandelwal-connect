import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TabStrip } from '../../components/TabStrip'
import { MemberApprovals } from '../../components/admin/MemberApprovals'
import { EventApprovals } from '../../components/admin/EventApprovals'
import { adminListEvents, adminListMembers } from '../../lib/admin'

// (5a) Both approval queues in one place, instead of two separate pages
// reached from the account menu. (5b-1) Now the Approvals section of the
// console: AdminLayout owns the admin gate and the page chrome, so this is
// just the Members / Events tab strip over the two panels.

type ApprovalTab = 'members' | 'events'

function isApprovalTab(value: string | null): value is ApprovalTab {
  return value === 'members' || value === 'events'
}

export function AdminApprovals() {
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
    let cancelled = false
    loadCounts().catch((err) => {
      if (cancelled) return
      // Non-fatal: the badges just stay blank, the queues below still work.
      console.error('[AdminApprovals] failed to load pending counts', err)
    })
    return () => {
      cancelled = true
    }
  }, [loadCounts])

  const label = (base: string, count: number | null) =>
    count && count > 0 ? `${base} (${count})` : base

  return (
    <div className="flex flex-col gap-5">
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
