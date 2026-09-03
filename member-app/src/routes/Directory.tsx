import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import {
  getDirectoryFilterOptions,
  listDirectory,
  type DirectoryEntry,
  type DirectoryFilterOptions,
} from '../lib/directory'

const PAGE_SIZE = 20

type Filters = {
  state: string
  city: string
  gotra: string
}

const EMPTY_FILTERS: Filters = { state: '', city: '', gotra: '' }

function ChipSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  const active = value !== ''
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border px-3 py-1.5 text-sm outline-none transition-colors ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
      }`}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function metaLine(entry: DirectoryEntry): string {
  const location = [entry.current_city, entry.current_state].filter(Boolean).join(', ')
  return [entry.gotra, location].filter(Boolean).join(' · ')
}

export function Directory() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [options, setOptions] = useState<DirectoryFilterOptions | null>(null)
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  useEffect(() => {
    getDirectoryFilterOptions()
      .then(setOptions)
      .catch((err) => console.error('[Directory] failed to load filter options', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    listDirectory({
      search: debouncedSearch || undefined,
      state: filters.state || undefined,
      city: filters.city || undefined,
      gotra: filters.gotra || undefined,
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
        console.error('[Directory] failed to load members', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading the directory.')
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
      const page = await listDirectory({
        search: debouncedSearch || undefined,
        state: filters.state || undefined,
        city: filters.city || undefined,
        gotra: filters.gotra || undefined,
        limit: PAGE_SIZE,
        offset: entries.length,
      })
      setEntries((prev) => [...prev, ...page])
      if (page.length > 0) setTotal(page[0].total_count)
    } catch (err) {
      console.error('[Directory] failed to load more members', err)
      setError(err instanceof Error ? err.message : 'Something went wrong loading more members.')
    } finally {
      setLoadingMore(false)
    }
  }

  const filtering = debouncedSearch !== '' || filters.state !== '' || filters.city !== '' || filters.gotra !== ''
  const hasMore = total !== null && entries.length < total

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <div className="flex items-end justify-between">
        <h1 className="font-heading text-2xl font-semibold">Directory</h1>
        {total !== null && (
          <p className="text-right">
            <span className="font-heading text-2xl font-bold leading-none">{total}</span>{' '}
            <span className="text-sm text-[var(--color-text-muted)]">
              {filtering ? 'matches' : 'members'}
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search members by name"
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChipSelect
          label="State"
          value={filters.state}
          onChange={(state) => setFilters((f) => ({ ...f, state }))}
          options={options?.states ?? []}
        />
        <ChipSelect
          label="City"
          value={filters.city}
          onChange={(city) => setFilters((f) => ({ ...f, city }))}
          options={options?.cities ?? []}
        />
        <ChipSelect
          label="Gotra"
          value={filters.gotra}
          onChange={(gotra) => setFilters((f) => ({ ...f, gotra }))}
          options={options?.gotras ?? []}
        />
        {(filters.state || filters.city || filters.gotra) && (
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
        <p className="text-sm text-[var(--color-text-muted)]">Loading members…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {filtering
            ? 'No members match your search or filters.'
            : 'No members in the directory yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`/members/${entry.id}`}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Avatar name={entry.full_name} photoUrl={entry.profile_photo_url} size={40} />
                <span className="flex flex-col min-w-0">
                  <span className="font-heading font-medium truncate">{entry.full_name}</span>
                  {metaLine(entry) && (
                    <span className="text-sm text-[var(--color-text-muted)] truncate">
                      {metaLine(entry)}
                    </span>
                  )}
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
