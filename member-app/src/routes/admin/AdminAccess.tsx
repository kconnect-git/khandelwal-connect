import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { TabStrip } from '../../components/TabStrip'
import { AccessRequests } from '../../components/admin/AccessRequests'
import { ActiveAccess } from '../../components/admin/ActiveAccess'
import { PaywallSwitches } from '../../components/admin/PaywallSwitches'
import { useAdmin } from '../../context/AdminContext'
import { adminListServiceSettings } from '../../lib/serviceAccess'
import type { AdminServiceSettingRow } from '../../types/database'
import type { AdminOutletContext } from './AdminLayout'

// Phase 11.2: paid-service access. Payment is offline: a member taps Request
// access, the committee emails them and settles it, and an admin gives the
// service here for 1, 3 or 12 months. Paywall switches on top (super admin
// flips them), then Requests / With access.

type AccessTab = 'requests' | 'active'

export function AdminAccess() {
  const { role } = useAdmin()
  const { refreshAccessCount } = useOutletContext<AdminOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: AccessTab = searchParams.get('tab') === 'active' ? 'active' : 'requests'

  const [settings, setSettings] = useState<AdminServiceSettingRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await adminListServiceSettings())
    } catch (err) {
      console.error('[AdminAccess] failed to load settings', err)
      setError(err instanceof Error ? err.message : 'Could not load the paywalls.')
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const changed = useCallback(() => {
    loadSettings()
    refreshAccessCount()
  }, [loadSettings, refreshAccessCount])

  const openRequests = settings.reduce((sum, row) => sum + Number(row.open_requests), 0)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-[var(--color-text-muted)]">
        Members ask for access in the app. Email them to arrange payment, then give access here.
        They get an email when it starts.
      </p>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {settings.length > 0 && (
        <PaywallSwitches settings={settings} canEdit={role === 'super_admin'} onChanged={changed} />
      )}

      <div className="flex flex-col gap-5">
        <TabStrip
          tabs={[
            {
              key: 'requests' as const,
              label: openRequests > 0 ? `Requests (${openRequests})` : 'Requests',
            },
            { key: 'active' as const, label: 'With access' },
          ]}
          active={tab}
          onChange={(key) =>
            setSearchParams(key === 'requests' ? {} : { tab: key }, { replace: true })
          }
          label="Access"
        />

        {tab === 'requests' ? (
          <AccessRequests onChanged={changed} />
        ) : (
          <ActiveAccess onChanged={changed} />
        )}
      </div>
    </div>
  )
}
