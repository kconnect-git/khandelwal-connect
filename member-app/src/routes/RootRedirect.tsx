import { Navigate } from 'react-router-dom'
import { useProfileStatus } from '../hooks/useProfileStatus'
import { ProfileLoadError } from '../components/guards/ProfileLoadError'

export function RootRedirect() {
  const status = useProfileStatus()

  if (status.state === 'loading') return null
  if (status.state === 'error') {
    return <ProfileLoadError message={status.message} retry={status.retry} />
  }
  if (status.state === 'anonymous') return <Navigate to="/signup" replace />
  if (status.state === 'incomplete') return <Navigate to="/onboarding" replace />
  return <Navigate to="/dashboard" replace />
}
