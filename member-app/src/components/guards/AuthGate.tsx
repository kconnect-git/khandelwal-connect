import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useProfileStatus } from '../../hooks/useProfileStatus'
import { setReturnTo } from '../../lib/returnTo'
import { ProfileLoadError } from './ProfileLoadError'

type AuthGateProps = {
  children: ReactNode
  requireComplete?: boolean
  // (0019) Let a member who is waiting on (or has been knocked back by) admin
  // review through anyway. Only /pending and /profile set this -- /profile
  // because acting on a "more information needed" note means editing it.
  allowPending?: boolean
}

export function AuthGate({ children, requireComplete = false, allowPending = false }: AuthGateProps) {
  const status = useProfileStatus()
  const location = useLocation()

  if (status.state === 'loading') return null
  if (status.state === 'error') {
    return <ProfileLoadError message={status.message} retry={status.retry} />
  }
  if (status.state === 'anonymous') {
    // Remember where they were headed (e.g. an event deep link from an
    // invite email) so VerifyOtp can bring them back after login.
    setReturnTo(location.pathname + location.search)
    return <Navigate to="/signup" replace />
  }
  if (status.state === 'incomplete' && requireComplete) {
    return <Navigate to="/onboarding" replace />
  }
  if (status.state === 'awaiting_approval' && requireComplete && !allowPending) {
    return <Navigate to="/pending" replace />
  }

  return <>{children}</>
}
