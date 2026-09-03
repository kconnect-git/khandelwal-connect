import { useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ProfileRefreshProvider, useProfileRefresh } from './context/ProfileRefreshContext'
import { ThemeToggle } from './components/ThemeToggle'
import { UserMenu } from './components/UserMenu'
import { HeaderNav, BottomTabs } from './components/NavTabs'
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
import { Directory } from './routes/Directory'
import { MemberProfile } from './routes/MemberProfile'
import { Businesses } from './routes/Businesses'
import { BusinessDetail } from './routes/BusinessDetail'
import { MyBusinesses } from './routes/MyBusinesses'

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { version } = useProfileRefresh()
  // Route changes remain a refetch trigger (cheap safety net); `version` is
  // the precise signal screens bump right after mutating the profile.
  const status = useProfileStatus(`${location.pathname}#${version}`)
  const [loggingOut, setLoggingOut] = useState(false)

  const person = status.state === 'complete' || status.state === 'incomplete' ? status.person : null
  // Nav only appears once onboarding is done -- an incomplete profile is
  // still locked to the wizard by AuthGate, so tabs would just bounce.
  const showNav = status.state === 'complete'

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
    navigate('/signup', { replace: true })
  }

  return (
    <div className="min-h-svh flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-6">
          <span className="font-heading font-semibold text-lg">Khandelwal Connect</span>
          {showNav && <HeaderNav />}
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {person && (
            <UserMenu
              fullName={person.full_name}
              photoUrl={person.profile_photo_url}
              memberCode={person.member_code}
              onLogout={handleLogout}
              loggingOut={loggingOut}
            />
          )}
        </div>
      </header>
      <main className={`flex-1 flex flex-col ${showNav ? 'pb-16 sm:pb-0' : ''}`}>{children}</main>
      {showNav && <BottomTabs />}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ProfileRefreshProvider>
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
              <Route
                path="/directory"
                element={
                  <AuthGate key="directory" requireComplete>
                    <Directory />
                  </AuthGate>
                }
              />
              <Route
                path="/members/:id"
                element={
                  <AuthGate key="member-profile" requireComplete>
                    <MemberProfile />
                  </AuthGate>
                }
              />
              <Route
                path="/businesses"
                element={
                  <AuthGate key="businesses" requireComplete>
                    <Businesses />
                  </AuthGate>
                }
              />
              <Route
                path="/businesses/mine"
                element={
                  <AuthGate key="my-businesses" requireComplete>
                    <MyBusinesses />
                  </AuthGate>
                }
              />
              <Route
                path="/businesses/:id"
                element={
                  <AuthGate key="business-detail" requireComplete>
                    <BusinessDetail />
                  </AuthGate>
                }
              />
            </Routes>
          </Layout>
        </ProfileRefreshProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
