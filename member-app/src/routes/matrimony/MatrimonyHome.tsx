import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChipSelect } from '../../components/ChipSelect'
import { MatrimonyCard } from '../../components/matrimony/MatrimonyCard'
import { useMatrimony } from '../../context/MatrimonyContext'
import { OCCUPATION_OPTIONS } from '../../lib/formOptions'
import {
  EMPTY_MATRIMONY_FILTERS,
  MATRIMONY_STATUS_LABELS,
  getMyMatrimony,
  listMatrimonyProfiles,
  matrimonyFilterOptions,
  type MatrimonyFilters,
} from '../../lib/matrimony'
import type { MatrimonyCardRow, MatrimonyFilterOptions, MyMatrimony } from '../../types/database'

// Phase 6a: the matrimony landing page. (6b) Once the member's own profile
// is live it browses verified profiles of the opposite gender; until then
// it explains how it works and points at their profile.

const PAGE_SIZE = 20

const HOW_IT_WORKS = [
  'Create a profile. Your basics come from your main profile; you add the rest.',
  'An admin verifies it before anyone else can see it.',
  'Others see your details but not your photos, surname or contact details.',
  'When you and someone else both say yes, you can see each other’s photos and contact details.',
]

const INPUT =
  'rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]'

function Browse() {
  const [filters, setFilters] = useState<MatrimonyFilters>(EMPTY_MATRIMONY_FILTERS)
  const [debounced, setDebounced] = useState<MatrimonyFilters>(EMPTY_MATRIMONY_FILTERS)
  const [options, setOptions] = useState<MatrimonyFilterOptions>({ states: [], cities: [] })
  const [rows, setRows] = useState<MatrimonyCardRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typed fields (age, education) settle before querying; selects too, so
  // there's one path.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(filters), 300)
    return () => clearTimeout(handle)
  }, [filters])

  useEffect(() => {
    matrimonyFilterOptions()
      .then(setOptions)
      .catch((err) => console.error('[MatrimonyHome] failed to load filter options', err))
  }, [])

  const load = useCallback(async () => {
    const page = await listMatrimonyProfiles(debounced, { limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [debounced])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[MatrimonyHome] failed to load profiles', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading profiles.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await listMatrimonyProfiles(debounced, { limit: PAGE_SIZE, offset: rows.length })
      setRows((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more profiles.')
    } finally {
      setLoadingMore(false)
    }
  }

  function patch(next: Partial<MatrimonyFilters>) {
    setFilters((current) => ({ ...current, ...next }))
  }

  const filtered = Object.values(debounced).some(Boolean)
  const hasMore = total !== null && rows.length < total

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          placeholder="Age from"
          aria-label="Minimum age"
          value={filters.ageMin}
          onChange={(e) => patch({ ageMin: e.target.value })}
          className={`${INPUT} w-28`}
        />
        <input
          type="number"
          inputMode="numeric"
          min={18}
          max={99}
          placeholder="Age to"
          aria-label="Maximum age"
          value={filters.ageMax}
          onChange={(e) => patch({ ageMax: e.target.value })}
          className={`${INPUT} w-28`}
        />
        <ChipSelect
          label="State"
          value={filters.state}
          onChange={(state) => patch({ state })}
          options={options.states}
        />
        <ChipSelect
          label="City"
          value={filters.city}
          onChange={(city) => patch({ city })}
          options={options.cities}
        />
        <ChipSelect
          label="Occupation"
          value={filters.occupation}
          onChange={(occupation) => patch({ occupation })}
          options={OCCUPATION_OPTIONS}
        />
        <input
          type="search"
          placeholder="Education"
          aria-label="Education contains"
          value={filters.education}
          onChange={(e) => patch({ education: e.target.value })}
          className={`${INPUT} w-36`}
        />
        {Object.values(filters).some(Boolean) && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_MATRIMONY_FILTERS)}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading profiles…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          {filtered ? 'No profiles match these filters.' : 'No verified profiles to show yet.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            {total} {total === 1 ? 'profile' : 'profiles'}
          </p>
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <MatrimonyCard row={row} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </section>
  )
}

export function MatrimonyHome() {
  const { badgeCount } = useMatrimony()
  const [data, setData] = useState<MyMatrimony | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMyMatrimony()
      .then((next) => {
        if (!cancelled) setData(next)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[MatrimonyHome] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const status = data?.profile?.status
  const live = status === 'approved' && !data?.ineligible_reason
  // (6c) A paused member keeps their interests and matches, but not browse.
  const active = (status === 'approved' || status === 'paused') && !data?.ineligible_reason

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/explore"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Explore
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Matrimony</h1>
          <p className="text-[var(--color-text-muted)]">
            Verified profiles from within the community, with your privacy first.
          </p>
        </div>
        {active && (
          <div className="flex gap-2">
            <Link
              to="/matrimony/interests"
              className="relative rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
            >
              Interests
              {badgeCount > 0 && (
                <span className="ml-2 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-xs font-semibold text-white">
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </Link>
            <Link
              to="/matrimony/profile"
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
            >
              My profile
            </Link>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : live ? (
        <Browse />
      ) : active ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm">
          Your profile is paused, so browsing is off.{' '}
          <Link to="/matrimony/profile" className="underline underline-offset-2">
            Resume it
          </Link>{' '}
          to browse and reply to interests again.
        </p>
      ) : (
        <>
          <Link
            to="/matrimony/profile"
            className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <div>
              <p className="font-medium">
                {status ? 'My matrimony profile' : 'Create your matrimony profile'}
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                {data?.ineligible_reason ??
                  (status ? MATRIMONY_STATUS_LABELS[status] : 'Takes a few minutes.')}
              </p>
            </div>
            <span aria-hidden="true" className="text-[var(--color-text-muted)]">
              ›
            </span>
          </Link>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              How it works
            </h2>
            <ol className="flex flex-col gap-2 list-decimal pl-5">
              {HOW_IT_WORKS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="text-sm text-[var(--color-text-muted)]">
              You can browse other profiles once yours is verified.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
