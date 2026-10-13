import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { matrimonyBadgeCount } from '../lib/matrimony'

// Phase 6b. The matrimony badge: unseen received interests + unseen new
// matches. Same refresh model as NoticesContext -- on sign-in, on every
// navigation (one cheap count), and on refresh(), which the interests page
// calls after marking a box seen or answering an interest.
//
// matrimony_badge_count returns 0 for anyone without a matrimony profile.

type MatrimonyState = {
  badgeCount: number
  refresh: () => void
}

const MatrimonyContext = createContext<MatrimonyState>({ badgeCount: 0, refresh: () => {} })

export function MatrimonyProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [badgeCount, setBadgeCount] = useState(0)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      setBadgeCount(0)
      return
    }
    let cancelled = false
    matrimonyBadgeCount()
      .then((count) => {
        if (!cancelled) setBadgeCount(count)
      })
      // Non-fatal: the badge just doesn't show.
      .catch((err) => console.error('[MatrimonyContext] failed to load badge count', err))
    return () => {
      cancelled = true
    }
  }, [userId, pathname, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const value = useMemo(() => ({ badgeCount, refresh }), [badgeCount, refresh])

  return <MatrimonyContext.Provider value={value}>{children}</MatrimonyContext.Provider>
}

export function useMatrimony(): MatrimonyState {
  return useContext(MatrimonyContext)
}
