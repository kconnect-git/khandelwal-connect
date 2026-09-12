import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
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
import { Profile } from './routes/Profile'
import { Directory } from './routes/Directory'
import { MemberProfile } from './routes/MemberProfile'
import { Businesses } from './routes/Businesses'
import { BusinessDetail } from './routes/BusinessDetail'
import { Events } from './routes/Events'
import { MyEvents } from './routes/MyEvents'
import { EventNew } from './routes/EventNew'
import { EventDetail } from './routes/EventDetail'
import { AdminEvents } from './routes/AdminEvents'
import { useIsAdmin } from './hooks/useIsAdmin'
import { clearReturnTo } from './lib/returnTo'

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
  // Phase 4: admins get an extra item in the account menu (not a tab).
  const isAdmin = useIsAdmin(showNav)

  async function handleLogout() {
    setLoggingOut(true)
    clearReturnTo()
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
              adminHref={isAdmin ? '/admin/events' : undefined}
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
                path="/profile"
                element={
                  <AuthGate key="profile" requireComplete>
                    <Profile />
                  </AuthGate>
                }
              />
              {/* Phase 3c: Edit profile, Family details and My businesses all
                  folded into the tabbed Profile page. Old paths keep working
                  for bookmarks / stale links. */}
              <Route path="/profile/edit" element={<Navigate to="/profile" replace />} />
              <Route path="/family-details" element={<Navigate to="/profile" replace />} />
              <Route
                path="/businesses/mine"
                element={<Navigate to="/profile?tab=business" replace />}
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
                path="/businesses/:id"
                element={
                  <AuthGate key="business-detail" requireComplete>
                    <BusinessDetail />
                  </AuthGate>
                }
              />
              {/* Phase 4: events. /events/mine and /events/new sit before
                  /events/:id so they aren't swallowed by the param route. */}
              <Route
                path="/events"
                element={
                  <AuthGate key="events" requireComplete>
                    <Events />
                  </AuthGate>
                }
              />
              <Route
                path="/events/mine"
                element={
                  <AuthGate key="my-events" requireComplete>
                    <MyEvents />
                  </AuthGate>
                }
              />
              <Route
                path="/events/new"
                element={
                  <AuthGate key="event-new" requireComplete>
                    <EventNew />
                  </AuthGate>
                }
              />
              <Route
                path="/events/:id"
                element={
                  <AuthGate key="event-detail" requireComplete>
                    <EventDetail />
                  </AuthGate>
                }
              />
              <Route
                path="/admin/events"
                element={
                  <AuthGate key="admin-events" requireComplete>
                    <AdminEvents />
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
