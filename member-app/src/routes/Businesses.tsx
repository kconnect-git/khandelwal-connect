import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { ChipSelect } from '../components/ChipSelect'
import { VerifiedTag } from '../components/businesses/VerifiedTag'
import {
  businessMetaLine,
  getBusinessFilterOptions,
  listBusinesses,
  type BusinessFilterOptions,
  type BusinessListingPage,
} from '../lib/businesses'

const PAGE_SIZE = 20

type Filters = {
  category: string
  city: string
  state: string
  /** (10.3) Only listings the member saved from a detail page. */
  saved: boolean
}

const EMPTY_FILTERS: Filters = { category: '', city: '', state: '', saved: false }

export function Businesses() {
  // (10.1) The hub's search box lands here as ?q=. Seed both values so the
  // first fetch already uses it instead of waiting out the debounce.
  const [searchParams] = useSearchParams()
  const initialQuery = (searchParams.get('q') ?? '').trim()
  const [search, setSearch] = useState(initialQuery)
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [options, setOptions] = useState<BusinessFilterOptions | null>(null)
  const [entries, setEntries] = useState<BusinessListingPage[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    getBusinessFilterOptions()
      .then(setOptions)
      .catch((err) => console.error('[Businesses] failed to load filter options', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    listBusinesses({
      search: debouncedSearch || undefined,
      category: filters.category || undefined,
      city: filters.city || undefined,
      state: filters.state || undefined,
      savedOnly: filters.saved,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((page) => {
        if (cancelled) return
        setEntries(page)
        setTotal(page.length > 0 ? page[0].total_count : 0)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[Businesses] failed to load listings', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading businesses.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedSearch, filters])

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const page = await listBusinesses({
        search: debouncedSearch || undefined,
        category: filters.category || undefined,
        city: filters.city || undefined,
        state: filters.state || undefined,
        savedOnly: filters.saved,
        limit: PAGE_SIZE,
        offset: entries.length,
      })
      setEntries((prev) => [...prev, ...page])
      if (page.length > 0) setTotal(page[0].total_count)
    } catch (err) {
      console.error('[Businesses] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Something went wrong loading more businesses.')
    } finally {
      setLoadingMore(false)
    }
  }

  const anyFilter =
    filters.category !== '' || filters.city !== '' || filters.state !== '' || filters.saved
  const filtering = debouncedSearch !== '' || anyFilter
  const hasMore = total !== null && entries.length < total

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      {/* (10.1) Every width reaches the directory through the KC Business hub. */}
      <Link
        to="/business"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Business
      </Link>

      <div className="flex items-end justify-between">
        <h1 className="font-heading text-2xl font-semibold">Businesses</h1>
        {total !== null && (
          <p className="text-right">
            <span className="font-heading text-2xl font-bold leading-none">{total}</span>{' '}
            <span className="text-sm text-[var(--color-text-muted)]">
              {filtering ? 'matches' : 'listings'}
            </span>
          </p>
        )}
      </div>

      {/* (10.2) Header buttons; their pages arrived in 10.4 / 10.5. */}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/businesses/mine"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          My businesses
        </Link>
        <Link
          to="/businesses/new"
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          + List a business
        </Link>
      </div>

      <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search business, owner, product, industry or city…"
          aria-label="Search businesses"
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          label="Category"
          value={filters.category}
          onChange={(category) => setFilters((f) => ({ ...f, category }))}
          options={options?.categories ?? []}
        />
        <ChipSelect
          label="City"
          value={filters.city}
          onChange={(city) => setFilters((f) => ({ ...f, city }))}
          options={options?.cities ?? []}
        />
        <ChipSelect
          label="State"
          value={filters.state}
          onChange={(state) => setFilters((f) => ({ ...f, state }))}
          options={options?.states ?? []}
        />
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, saved: !f.saved }))}
          aria-pressed={filters.saved}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            filters.saved
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Saved
        </button>
        {anyFilter && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-1 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading businesses…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {filters.saved && debouncedSearch === '' && !filters.category && !filters.city && !filters.state
            ? 'You haven’t saved any businesses yet.'
            : filtering
              ? 'No businesses match your search or filters.'
              : 'No businesses listed yet. Be the first to add yours.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/businesses/${entry.id}`}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Avatar name={entry.name} photoUrl={entry.logo_url} size={40} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-heading font-medium truncate">{entry.name}</span>
                    {entry.is_verified && <VerifiedTag />}
                  </span>
                  {businessMetaLine(entry) && (
                    <span className="text-sm text-[var(--color-text-muted)] truncate">
                      {businessMetaLine(entry)}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-text-muted)] truncate">
                    {entry.owner_name}
                  </span>
                </span>
              </Link>
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
    </div>
  )
}
