import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// The header (App.tsx's Layout) persists across navigations, so its
// useProfileStatus() only refetched when the route changed -- a heuristic
// that left the avatar/member code stale after in-place mutations like a
// photo upload. This context is the precise signal: screens call
// triggerRefresh() right after mutating the profile, and Layout folds
// `version` into its refresh key.

type ProfileRefresh = {
  version: number
  triggerRefresh: () => void
}

const ProfileRefreshContext = createContext<ProfileRefresh>({
  version: 0,
  triggerRefresh: () => {},
})

export function ProfileRefreshProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0)
  const triggerRefresh = useCallback(() => setVersion((v) => v + 1), [])
  const value = useMemo(() => ({ version, triggerRefresh }), [version, triggerRefresh])

  return <ProfileRefreshContext.Provider value={value}>{children}</ProfileRefreshContext.Provider>
}

export function useProfileRefresh(): ProfileRefresh {
  return useContext(ProfileRefreshContext)
}
