import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import {
  dismissAccessNews,
  getMyAccessNews,
  getMyServiceAccess,
  requestServiceAccess,
} from '../lib/serviceAccess'
import type { MyAccessNewsRow, MyServiceAccessRow, PaidService } from '../types/database'

// Phase 11.3. The member's own paid-service access (my_service_access) and
// their unseen "access granted" news (my_access_news), shared by the Home
// card, Profile's "My access" and every <LockedFeature>. Same refresh model
// as NoticesContext / MatrimonyContext: on sign-in, on every navigation, and
// on refresh().
//
// Only asked once someone is signed in: both RPCs are closed to anon (0034 /
// 0035). For a member who isn't approved yet they return no rows.
//
// UI only. The gated RPCs (11.4-11.7) decide for themselves with
// has_service_access(); nothing here is a security check.

type ServiceAccessState = {
  /** One row per paid service; empty until loaded or when not approved. */
  services: MyServiceAccessRow[]
  news: MyAccessNewsRow[]
  loaded: boolean
  /** True while unknown, so locked UI never flashes before the answer. */
  hasAccess: (service: PaidService) => boolean
  row: (service: PaidService) => MyServiceAccessRow | undefined
  /** At least one paywall is on, or the member holds or asked for access. */
  anythingToShow: boolean
  request: (service: PaidService, message?: string) => Promise<void>
  dismissNews: (service: PaidService) => Promise<void>
  refresh: () => void
}

const ServiceAccessContext = createContext<ServiceAccessState>({
  services: [],
  news: [],
  loaded: false,
  hasAccess: () => true,
  row: () => undefined,
  anythingToShow: false,
  request: async () => {},
  dismissNews: async () => {},
  refresh: () => {},
})

export function ServiceAccessProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [services, setServices] = useState<MyServiceAccessRow[]>([])
  const [news, setNews] = useState<MyAccessNewsRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      setServices([])
      setNews([])
      setLoaded(false)
      return
    }
    let cancelled = false
    Promise.all([getMyServiceAccess(), getMyAccessNews()])
      .then(([nextServices, nextNews]) => {
        if (cancelled) return
        setServices(nextServices)
        setNews(nextNews)
        setLoaded(true)
      })
      // Non-fatal: locked UI stays hidden (hasAccess defaults to true) and
      // the server still enforces.
      .catch((err) => console.error('[ServiceAccessContext] failed to load access', err))
    return () => {
      cancelled = true
    }
  }, [userId, pathname, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const request = useCallback(
    async (service: PaidService, message?: string) => {
      await requestServiceAccess(service, message)
      refresh()
    },
    [refresh],
  )

  const dismissNews = useCallback(async (service: PaidService) => {
    // Optimistic: the card goes the moment it's dismissed.
    setNews((current) => current.filter((item) => item.service !== service))
    try {
      await dismissAccessNews(service)
    } catch (err) {
      console.error('[ServiceAccessContext] failed to dismiss access news', err)
    }
  }, [])

  const value = useMemo<ServiceAccessState>(() => {
    const row = (service: PaidService) => services.find((item) => item.service === service)
    return {
      services,
      news,
      loaded,
      row,
      hasAccess: (service) => {
        const found = row(service)
        return found ? found.has_access : true
      },
      anythingToShow: services.some(
        (item) => item.enforced || item.ends_at !== null || item.open_request_at !== null,
      ),
      request,
      dismissNews,
      refresh,
    }
  }, [services, news, loaded, request, dismissNews, refresh])

  return <ServiceAccessContext.Provider value={value}>{children}</ServiceAccessContext.Provider>
}

export function useServiceAccess(): ServiceAccessState {
  return useContext(ServiceAccessContext)
}
