import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StatCounter } from '../components/StatCounter'
import { TabStrip } from '../components/TabStrip'
import { ReferralCard } from '../components/businesses/ReferralCard'
import { getReferralCounts, listBusinessReferrals } from '../lib/businessReferrals'
import type { BusinessReferralRow, ReferralCounts } from '../types/database'

// Phase 10.7: Referrals -- give, receive and track. Received is what other
// members referred to your businesses; Given is what you referred.

const PAGE_SIZE = 20

type Direction = 'received' | 'given'

const EMPTY_MESSAGES: Record<Direction, string> = {
  received: 'No referrals yet. When a member refers someone to your business, it shows here.',
  given: 'You haven’t referred anyone yet.',
}

export function Referrals() {
  const [searchParams, setSearchParams] = useSearchParams()
  const direction: Direction = searchParams.get('tab') === 'given' ? 'given' : 'received'
  const [counts, setCounts] = useState<ReferralCounts | null>(null)
  const [referrals, setReferrals] = useState<BusinessReferralRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [page, loadedCounts] = await Promise.all([
      listBusinessReferrals({ direction, limit: PAGE_SIZE }),
      getReferralCounts(),
    ])
    setReferrals(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
    setCounts(loadedCounts)
  }, [direction])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[Referrals] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading referrals.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const page = await listBusinessReferrals({
        direction,
        limit: PAGE_SIZE,
        offset: referrals.length,
      })
      setReferrals((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more referrals.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && referrals.length < total
  const receivedNew = counts?.received_new ?? 0

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/business"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Business
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Referrals</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Give, receive and track</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCounter value={counts?.given ?? null} label="Given" />
        <StatCounter value={counts?.received ?? null} label="Received" />
        <StatCounter
          value={counts?.closed ?? null}
          label="Closed"
          sub={counts && counts.won > 0 ? `${counts.won} business done` : undefined}
        />
      </div>

      <TabStrip
        tabs={[
          {
            key: 'received' as const,
            label: receivedNew > 0 ? `Received (${receivedNew} new)` : 'Received',
          },
          { key: 'given' as const, label: 'Given' },
        ]}
        active={direction}
        onChange={(key) => setSearchParams(key === 'given' ? { tab: 'given' } : {}, { replace: true })}
        label="Referrals"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading referrals…</p>
      ) : referrals.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{EMPTY_MESSAGES[direction]}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {referrals.map((referral) => (
            <li key={referral.id}>
              <ReferralCard
                referral={referral}
                direction={direction}
                onChanged={() => {
                  load().catch((err) => console.error('[Referrals] failed to reload', err))
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      <Link
        to="/business/referrals/new"
        className="rounded-lg bg-[var(--color-accent)] py-3 text-center text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
      >
        Give a referral
      </Link>
    </div>
  )
}
