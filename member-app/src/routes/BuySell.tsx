import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChipSelect } from '../components/ChipSelect'
import { TabStrip } from '../components/TabStrip'
import { PostCard } from '../components/businesses/PostCard'
import { listBusinessPosts } from '../lib/businessPosts'
import { BUSINESS_CATEGORY_OPTIONS } from '../lib/formOptions'
import type { BusinessPostRow } from '../types/database'

// Phase 10.6: Buy & Sell -- requirements and offers from members. Browse
// tabs show live posts of one kind; Mine shows every post of the member's,
// whatever its state.

const PAGE_SIZE = 20

type Tab = 'requirements' | 'offers' | 'mine'

function tabFromParam(value: string | null): Tab {
  return value === 'offers' || value === 'mine' ? value : 'requirements'
}

const EMPTY_MESSAGES: Record<Tab, string> = {
  requirements: 'Nobody is looking for anything right now.',
  offers: 'No offers right now.',
  mine: 'You haven’t posted anything yet.',
}

export function BuySell() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFromParam(searchParams.get('tab'))
  // (10.8) The dashboard's "requirements match your category" lands here
  // with ?category=.
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [savedOnly, setSavedOnly] = useState(false)
  const [posts, setPosts] = useState<BusinessPostRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback(
    (offset: number) =>
      listBusinessPosts({
        kind: tab === 'offers' ? 'offer' : 'requirement',
        mine: tab === 'mine',
        category: tab === 'mine' ? undefined : category,
        savedOnly: tab !== 'mine' && savedOnly,
        limit: PAGE_SIZE,
        offset,
      }),
    [tab, category, savedOnly],
  )

  const load = useCallback(async () => {
    const page = await query(0)
    setPosts(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[BuySell] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading posts.')
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
      const page = await query(posts.length)
      setPosts((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more posts.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && posts.length < total
  const filtering = tab !== 'mine' && (category !== '' || savedOnly)

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/business"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Business
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Buy & Sell</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Requirements and offers from members
        </p>
      </div>

      <TabStrip
        tabs={[
          { key: 'requirements' as const, label: 'Requirements' },
          { key: 'offers' as const, label: 'Offers' },
          { key: 'mine' as const, label: 'Mine' },
        ]}
        active={tab}
        onChange={(key) =>
          setSearchParams(key === 'requirements' ? {} : { tab: key }, { replace: true })
        }
        label="Buy & Sell"
      />

      {tab !== 'mine' && (
        <div className="flex flex-wrap items-center gap-2">
          <ChipSelect
            label="Industry"
            value={category}
            onChange={setCategory}
            options={BUSINESS_CATEGORY_OPTIONS}
          />
          <button
            type="button"
            onClick={() => setSavedOnly(!savedOnly)}
            aria-pressed={savedOnly}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              savedOnly
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            Saved
          </button>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setCategory('')
                setSavedOnly(false)
              }}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-1 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {filtering ? 'No posts match your filters.' : EMPTY_MESSAGES[tab]}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard
                post={post}
                onChanged={() => {
                  load().catch((err) => console.error('[BuySell] failed to reload', err))
                }}
                onRemoved={(id) => {
                  setPosts((current) => current.filter((p) => p.id !== id))
                  setTotal((current) => (current === null ? null : current - 1))
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

      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          Need something, or have something to offer?
        </p>
        <Link
          to={tab === 'offers' ? '/business/market/new?kind=offer' : '/business/market/new'}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Post a requirement or offer
        </Link>
      </div>
    </div>
  )
}
