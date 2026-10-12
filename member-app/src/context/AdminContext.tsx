import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { adminRole } from '../lib/admin'
import type { AdminRoleName } from '../types/database'

// Phase 5b-1. Before this, every admin screen (and the nav) asked is_admin() /
// admin_role() for itself. One admin_role() call per signed-in user answers
// both -- null means "not an admin" -- and is shared here.
//
// Purely a UI gate: every admin RPC re-checks is_admin() / admin_role()
// server-side regardless of what this says.

type AdminState = {
  /** null for a non-admin (or nobody signed in). */
  role: AdminRoleName | null
  isAdmin: boolean
  /** True until the first answer for the current user arrives. */
  loading: boolean
  /** The signed-in auth user, so admin screens can tell "you" apart. */
  authUserId: string | null
  /** Re-ask, e.g. after the Admins page changes someone's role. */
  refresh: () => void
}

const AdminContext = createContext<AdminState>({
  role: null,
  isAdmin: false,
  loading: true,
  authUserId: null,
  refresh: () => {},
})

export function AdminProvider({ children }: { children: React.ReactNode }) {
  // undefined = auth state not known yet; null = signed out.
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [role, setRole] = useState<AdminRoleName | null>(null)
  // Which user `role` was fetched for, so a sign-in as someone else reads as
  // loading rather than briefly inheriting the previous user's answer.
  const [answeredFor, setAnsweredFor] = useState<string | null | undefined>(undefined)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    // INITIAL_SESSION fires on subscribe, so this also covers the first load.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (userId === undefined) return
    if (userId === null) {
      setRole(null)
      setAnsweredFor(null)
      return
    }
    let cancelled = false
    adminRole()
      .then((value) => {
        if (cancelled) return
        setRole(value)
        setAnsweredFor(userId)
      })
      .catch((err) => {
        console.error('[AdminContext] failed to read admin role', err)
        if (cancelled) return
        setRole(null)
        setAnsweredFor(userId)
      })
    return () => {
      cancelled = true
    }
  }, [userId, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const loading = userId === undefined || answeredFor !== userId
  const value = useMemo<AdminState>(
    () => ({
      role: loading ? null : role,
      isAdmin: !loading && role !== null,
      loading,
      authUserId: userId ?? null,
      refresh,
    }),
    [role, loading, userId, refresh],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin(): AdminState {
  return useContext(AdminContext)
}
