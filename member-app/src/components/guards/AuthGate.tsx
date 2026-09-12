import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useProfileStatus } from '../../hooks/useProfileStatus'
import { setReturnTo } from '../../lib/returnTo'
import { ProfileLoadError } from './ProfileLoadError'

type AuthGateProps = {
  children: ReactNode
  requireComplete?: boolean
}

export function AuthGate({ children, requireComplete = false }: AuthGateProps) {
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

  return <>{children}</>
}
