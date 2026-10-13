import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { noticeUnreadCount } from '../lib/notices'

// Phase 5c. The header bell's unread count. Refetched on sign-in, on every
// navigation (cheap: one count), and on refresh() -- which the notices page
// and the dashboard strip call straight after marking something read, so
// the badge clears without waiting for the next route change.
//
// notice_unread_count returns 0 for anyone who isn't an approved member, so
// this needs no knowledge of profile status.

type NoticesState = {
  unreadCount: number
  refresh: () => void
}

const NoticesContext = createContext<NoticesState>({ unreadCount: 0, refresh: () => {} })

export function NoticesProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [unreadCount, setUnreadCount] = useState(0)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0)
      return
    }
    let cancelled = false
    noticeUnreadCount()
      .then((count) => {
        if (!cancelled) setUnreadCount(count)
      })
      // Non-fatal: the badge just doesn't show.
      .catch((err) => console.error('[NoticesContext] failed to load unread count', err))
    return () => {
      cancelled = true
    }
  }, [userId, pathname, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const value = useMemo(() => ({ unreadCount, refresh }), [unreadCount, refresh])

  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>
}

export function useNotices(): NoticesState {
  return useContext(NoticesContext)
}
