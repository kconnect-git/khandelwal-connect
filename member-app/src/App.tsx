import { useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ThemeToggle } from './components/ThemeToggle'
import { UserMenu } from './components/UserMenu'
import { AuthGate } from './components/guards/AuthGate'
import { useProfileStatus } from './hooks/useProfileStatus'
import { supabase } from './utils/supabase'
import { RootRedirect } from './routes/RootRedirect'
import { Signup } from './routes/Signup'
import { VerifyOtp } from './routes/VerifyOtp'
import { ProfileWizard } from './routes/wizard/ProfileWizard'
import { Dashboard } from './routes/Dashboard'
import { ProfileEdit } from './routes/ProfileEdit'
import { FamilyDetails } from './routes/FamilyDetails'

function getInitials(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const status = useProfileStatus(location.pathname)
  const [loggingOut, setLoggingOut] = useState(false)

  const person = status.state === 'complete' || status.state === 'incomplete' ? status.person : null

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
    navigate('/signup', { replace: true })
  }

  return (
    <div className="min-h-svh flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <span className="font-heading font-semibold text-lg">Khandelwal Connect</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {person && (
            <UserMenu
              initials={getInitials(person.full_name)}
              memberCode={person.member_code}
              onLogout={handleLogout}
              loggingOut={loggingOut}
            />
          )}
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/verify" element={<VerifyOtp />} />
            <Route
              path="/onboarding"
              element={
                <AuthGate key="onboarding">
                  <ProfileWizard />
                </AuthGate>
              }
            />
            <Route
              path="/dashboard"
              element={
                <AuthGate key="dashboard" requireComplete>
                  <Dashboard />
                </AuthGate>
              }
            />
            <Route
              path="/profile/edit"
              element={
                <AuthGate key="profile-edit" requireComplete>
                  <ProfileEdit />
                </AuthGate>
              }
            />
            <Route
              path="/family-details"
              element={
                <AuthGate key="family-details" requireComplete>
                  <FamilyDetails />
                </AuthGate>
              }
            />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  )
}
