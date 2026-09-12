import { useEffect, useState } from 'react'
import { isAdmin } from '../lib/admin'

/** Whether the current user is in the `admins` table (0018). `null` while
 * unknown. Only asks once `enabled` is true (i.e. the profile is complete)
 * so anonymous/onboarding renders never fire the RPC. Purely a UI gate --
 * every admin RPC re-checks is_admin() server-side. */
export function useIsAdmin(enabled: boolean): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (!enabled) {
      setAdmin(null)
      return
    }
    let cancelled = false
    isAdmin()
      .then((value) => {
        if (!cancelled) setAdmin(value)
      })
      .catch((err) => {
        console.error('[useIsAdmin] failed to check admin status', err)
        if (!cancelled) setAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return admin
}
