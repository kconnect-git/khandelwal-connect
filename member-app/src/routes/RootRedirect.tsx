import { Navigate } from 'react-router-dom'
import { useProfileStatus } from '../hooks/useProfileStatus'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'
import { Landing } from './Landing'

export function RootRedirect() {
  const status = useProfileStatus()

  if (status.state === 'loading') return null
  if (status.state === 'error') {
    return <ProfileLoadError message={status.message} retry={status.retry} />
  }
  // (KITE) Logged-out visitors get the landing page here rather than a
  // redirect, so / is the public front door.
  if (status.state === 'anonymous') return <Landing />
  if (status.state === 'incomplete') return <Navigate to="/onboarding" replace />
  if (status.state === 'awaiting_approval') return <Navigate to="/pending" replace />
  return <Navigate to="/dashboard" replace />
}
