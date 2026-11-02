import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { ChipSelect } from '../../components/ChipSelect'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { TabStrip } from '../../components/TabStrip'
import { BusinessReports } from '../../components/admin/BusinessReports'
import { DataTable } from '../../components/admin/DataTable'
import { VerifiedTag } from '../../components/businesses/VerifiedTag'
import {
  adminListBusinesses,
  adminSetBusinessHidden,
  adminSetBusinessVerified,
  formatAdminDate,
} from '../../lib/admin'
import { BUSINESS_CATEGORY_OPTIONS } from '../../lib/formOptions'
import type { AdminBusinessRow } from '../../types/database'

// Phase 5b-2: business listing moderation. Hiding takes a listing out of
// every member-facing read; its owner still sees it on Profile > Business
// with the reason as a banner. No email -- a deliberate planning decision.
// (10.2) Admins can also mark a listing Verified after actually checking it.

const PAGE_SIZE = 25

// (10.3) + Reports, which renders its own list (BusinessReports).
type View = 'visible' | 'hidden' | 'reports'

type ActionKind = 'hide' | 'unhide' | 'verify' | 'unverify'

type PendingAction = {
  business: AdminBusinessRow
  kind: ActionKind
}

const ACTION_COPY: Record<
  ActionKind,
  {
    title: (name: string) => string
    description: string
    prompt?: { label: string; placeholder: string; required: boolean }
    confirmLabel: string
  }
> = {
  hide: {
    title: (name) => `Hide "${name}"?`,
    description:
      'It disappears from the businesses directory and the owner’s member profile. The owner still sees it, with your reason.',
    prompt: {
      label: 'Reason',
      placeholder: 'The owner sees this, so say what needs to change.',
      required: true,
    },
    confirmLabel: 'Hide listing',
  },
  unhide: {
    title: (name) => `Unhide "${name}"?`,
    description: 'It reappears in the businesses directory straight away.',
    confirmLabel: 'Unhide',
  },
  verify: {
    title: (name) => `Verify "${name}"?`,
    description:
      'Members see a Verified tag on this listing. Only verify a business you’ve actually checked.',
    prompt: {
      label: 'How was it verified? (optional)',
      placeholder: 'e.g. GST checked, shop visited. Only admins see this.',
      required: false,
    },
    confirmLabel: 'Verify',
  },
  unverify: {
    title: (name) => `Remove verification from "${name}"?`,
    description: 'The Verified tag disappears from the listing straight away.',
    confirmLabel: 'Remove verification',
  },
}

const ACTION_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'

function viewFromParam(value: string | null): View {
  return value === 'hidden' || value === 'reports' ? value : 'visible'
}

export function AdminBusinesses() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = viewFromParam(searchParams.get('view'))

  return (
    <div className="flex flex-col gap-4">
      <TabStrip
        tabs={[
          { key: 'visible' as const, label: 'Visible' },
          { key: 'hidden' as const, label: 'Hidden' },
          { key: 'reports' as const, label: 'Reports' },
        ]}
        active={view}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams)
          if (key === 'visible') next.delete('view')
          else next.set('view', key)
          setSearchParams(next, { replace: true })
        }}
        label="Listing visibility"
      />
      {view === 'reports' ? <BusinessReports /> : <BusinessListings key={view} view={view} />}
    </div>
  )
}

/** The Visible / Hidden table. */
function BusinessListings({ view }: { view: Exclude<View, 'reports'> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const category = searchParams.get('category') ?? ''

  const [rows, setRows] = useState<AdminBusinessRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const load = useCallback(async () => {
    const page = await adminListBusinesses({
      hidden: view === 'hidden',
      search: debouncedSearch,
      category: category || null,
      limit: PAGE_SIZE,
    })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [view, debouncedSearch, category])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminBusinesses] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading listings.')
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
      const page = await adminListBusinesses({
        hidden: view === 'hidden',
        search: debouncedSearch,
        category: category || null,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[AdminBusinesses] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more listings.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function run(pending: PendingAction, reason: string) {
    setBusyId(pending.business.id)
    setError(null)
    try {
      const { business, kind } = pending
      if (kind === 'hide' || kind === 'unhide') {
        await adminSetBusinessHidden(business.id, kind === 'hide', reason || undefined)
      } else {
        await adminSetBusinessVerified(business.id, kind === 'verify', reason || undefined)
      }
      setAction(null)
      await load()
    } catch (err) {
      console.error('[AdminBusinesses] failed to update listing', err)
      setError(err instanceof Error ? err.message : 'Could not update this listing.')
    } finally {
      setBusyId(null)
    }
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search listing or owner name"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="shrink-0">
          <ChipSelect
            label="Category"
            value={category}
            onChange={(value) => setParam('category', value)}
            options={BUSINESS_CATEGORY_OPTIONS}
          />
        </div>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading listings…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'listing' : 'listings'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(business) => business.id}
            empty={
              debouncedSearch || category
                ? 'No listings match.'
                : view === 'hidden'
                  ? 'No hidden listings.'
                  : 'No listings yet.'
            }
            primary={{
              header: 'Listing',
              cell: (business) => (
                <div className="flex items-start gap-2.5">
                  <Avatar name={business.name} photoUrl={business.logo_url} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-baseline gap-2">
                      <span className="font-medium">{business.name}</span>
                      {business.is_verified && <VerifiedTag />}
                    </p>
                    {business.brand_name && (
                      <p className="text-xs text-[var(--color-text-muted)]">{business.brand_name}</p>
                    )}
                  </div>
                </div>
              ),
            }}
            columns={[
              {
                key: 'owner',
                header: 'Owner',
                cell: (business) => (
                  <Link
                    to={`/admin/members/${business.owner_id}`}
                    className="flex flex-col underline-offset-2 hover:underline"
                  >
                    <span>{business.owner_name}</span>
                    {business.owner_member_code && (
                      <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
                        {business.owner_member_code}
                      </span>
                    )}
                  </Link>
                ),
              },
              { key: 'category', header: 'Category', cell: (business) => business.category ?? '—' },
              {
                key: 'place',
                header: 'Location',
                cell: (business) =>
                  [business.city, business.state].filter(Boolean).join(', ') || '—',
              },
              {
                key: 'when',
                header: view === 'hidden' ? 'Hidden' : 'Listed',
                align: 'right',
                cell: (business) =>
                  formatAdminDate(view === 'hidden' ? business.hidden_at : business.created_at) ??
                  '—',
              },
            ]}
            detail={(business) =>
              business.is_hidden && business.hidden_reason ? (
                <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                  Reason: {business.hidden_reason}
                </p>
              ) : null
            }
            actions={(business) => {
              const busy = busyId === business.id
              return business.is_hidden ? (
                <button
                  type="button"
                  onClick={() => setAction({ business, kind: 'unhide' })}
                  disabled={busy}
                  className={ACTION_BUTTON}
                >
                  Unhide
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setAction({ business, kind: business.is_verified ? 'unverify' : 'verify' })
                    }
                    disabled={busy}
                    className={ACTION_BUTTON}
                  >
                    {business.is_verified ? 'Unverify' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction({ business, kind: 'hide' })}
                    disabled={busy}
                    className={ACTION_BUTTON}
                  >
                    Hide
                  </button>
                  {/* The member-facing page only resolves for an approved
                      owner, so don't offer a link that would come up empty. */}
                  {business.owner_status === 'approved' && (
                    <Link
                      to={`/businesses/${business.id}`}
                      className="text-sm whitespace-nowrap text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
                    >
                      View
                    </Link>
                  )}
                </>
              )
            }}
          />

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

      <ConfirmDialog
        open={action !== null}
        title={action ? ACTION_COPY[action.kind].title(action.business.name) : ''}
        description={action ? ACTION_COPY[action.kind].description : ''}
        prompt={action ? ACTION_COPY[action.kind].prompt : undefined}
        confirmLabel={action ? ACTION_COPY[action.kind].confirmLabel : ''}
        busy={busyId !== null}
        onConfirm={(value) => {
          if (action) run(action, value)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
