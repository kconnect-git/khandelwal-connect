import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TabStrip } from '../../components/TabStrip'
import { AuditList } from '../../components/admin/AuditList'
import { adminListAuditLog } from '../../lib/admin'
import type { AuditLogRow } from '../../types/database'

// Phase 5b-2: the whole admin_audit_log, newest first, filtered by action
// family. The families are action-name prefixes (admin_list_audit_log's
// p_action_prefix), which is why every audited action is named
// <family>_<verb>.

const PAGE_SIZE = 30

type Family = 'all' | 'member' | 'event' | 'business' | 'notice' | 'matrimony' | 'admin' | 'export'

const FAMILIES: { key: Family; label: string; prefix: string | undefined }[] = [
  { key: 'all', label: 'All', prefix: undefined },
  { key: 'member', label: 'Members', prefix: 'member_' },
  { key: 'event', label: 'Events', prefix: 'event_' },
  { key: 'business', label: 'Businesses', prefix: 'business_' },
  { key: 'notice', label: 'Notices', prefix: 'notice_' },
  { key: 'matrimony', label: 'Matrimony', prefix: 'matrimony_' },
  { key: 'admin', label: 'Admins', prefix: 'admin_' },
  { key: 'export', label: 'Exports', prefix: 'members_export' },
]

function isFamily(value: string | null): value is Family {
  return FAMILIES.some((family) => family.key === value)
}

export function AdminAudit() {
  const [searchParams, setSearchParams] = useSearchParams()
  const familyParam = searchParams.get('type')
  const family: Family = isFamily(familyParam) ? familyParam : 'all'
  const prefix = FAMILIES.find((f) => f.key === family)?.prefix

  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const page = await adminListAuditLog({ actionPrefix: prefix, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [prefix])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminAudit] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading the log.')
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
      const page = await adminListAuditLog({
        actionPrefix: prefix,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[AdminAudit] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more entries.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-4">
      <TabStrip
        tabs={FAMILIES}
        active={family}
        onChange={(key) =>
          setSearchParams(key === 'all' ? new URLSearchParams() : { type: key }, { replace: true })
        }
        label="Audit log filter"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading log…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'entry' : 'entries'}
            </p>
          )}
          <AuditList rows={rows} empty="Nothing recorded yet." />
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
    </div>
  )
}
