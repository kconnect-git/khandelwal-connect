import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuditList } from '../../components/admin/AuditList'
import { adminListAuditLog, adminOverviewStats } from '../../lib/admin'
import type { AdminOverviewStats, AuditLogRow } from '../../types/database'

// Phase 5b-1: the console landing page. Counters first -- the two "waiting
// on you" tiles link straight into the queue that clears them -- then the
// most recent admin actions.

type Tile = { label: string; value: number; to?: string; urgent?: boolean }

function tilesFor(stats: AdminOverviewStats): Tile[] {
  const byStatus = stats.members_by_status
  const pending = byStatus.pending ?? 0
  return [
    {
      label: 'Members awaiting review',
      value: pending,
      to: '/admin/approvals',
      urgent: pending > 0,
    },
    {
      label: 'Events awaiting review',
      value: stats.events_pending,
      to: '/admin/approvals?tab=events',
      urgent: stats.events_pending > 0,
    },
    {
      label: 'Waiting on member',
      value: byStatus.info_requested ?? 0,
      to: '/admin/approvals?status=info_requested',
    },
    { label: 'Approved members', value: byStatus.approved ?? 0, to: '/admin/members?status=approved' },
    { label: 'New sign-ups (7 days)', value: stats.signups_7d },
    { label: 'New sign-ups (30 days)', value: stats.signups_30d },
    { label: 'Still onboarding', value: byStatus.onboarding ?? 0, to: '/admin/members?status=onboarding' },
    { label: 'Upcoming events', value: stats.events_upcoming, to: '/events' },
    { label: 'Business listings', value: stats.businesses, to: '/admin/businesses' },
    { label: 'Active notices', value: stats.notices_active ?? 0, to: '/admin/notices?status=published' },
    {
      label: 'Hidden listings',
      value: stats.businesses_hidden ?? 0,
      to: '/admin/businesses?view=hidden',
    },
  ]
}

const TILE_CLASS =
  'rounded-xl border bg-[var(--color-surface)] px-4 py-3 transition-colors'

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <span
        className={`font-heading text-3xl font-bold leading-tight ${
          tile.urgent ? 'text-[var(--color-accent)]' : ''
        }`}
      >
        {tile.value}
      </span>
      <span className="block text-sm text-[var(--color-text-muted)]">{tile.label}</span>
    </>
  )
}

export function AdminOverview() {
  const [stats, setStats] = useState<AdminOverviewStats | null>(null)
  const [activity, setActivity] = useState<AuditLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([adminOverviewStats(), adminListAuditLog({ limit: 10 })])
      .then(([nextStats, nextActivity]) => {
        if (cancelled) return
        setStats(nextStats)
        setActivity(nextActivity)
      })
      .catch((err) => {
        console.error('[AdminOverview] failed to load', err)
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the overview.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="text-sm text-[var(--color-accent)]">{error}</p>
  if (!stats || !activity) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading overview…</p>
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tilesFor(stats).map((tile) => {
          const border = tile.urgent
            ? 'border-[var(--color-accent)]'
            : 'border-[var(--color-border)]'
          return tile.to ? (
            <Link
              key={tile.label}
              to={tile.to}
              className={`${TILE_CLASS} ${border} hover:bg-[var(--color-surface-hover)]`}
            >
              <TileBody tile={tile} />
            </Link>
          ) : (
            <div key={tile.label} className={`${TILE_CLASS} ${border}`}>
              <TileBody tile={tile} />
            </div>
          )
        })}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Recent activity</h2>
        <AuditList rows={activity} empty="No admin actions recorded yet." />
      </section>
    </div>
  )
}
