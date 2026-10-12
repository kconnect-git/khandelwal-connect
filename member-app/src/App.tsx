import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ProfileRefreshProvider, useProfileRefresh } from './context/ProfileRefreshContext'
import { AdminProvider, useAdmin } from './context/AdminContext'
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
import { Explore } from './routes/Explore'
import { MyEvents } from './routes/MyEvents'
import { EventNew } from './routes/EventNew'
import { EventDetail } from './routes/EventDetail'
import { AdminLayout } from './routes/admin/AdminLayout'
import { AdminOverview } from './routes/admin/AdminOverview'
import { AdminApprovals } from './routes/admin/AdminApprovals'
import { AdminMembers } from './routes/admin/AdminMembers'
import { AdminMemberDetail } from './routes/admin/AdminMemberDetail'
import { AdminBusinesses } from './routes/admin/AdminBusinesses'
import { AdminAudit } from './routes/admin/AdminAudit'
import { AdminAdmins } from './routes/admin/AdminAdmins'
import { PendingApproval } from './routes/PendingApproval'
import { clearReturnTo } from './lib/returnTo'

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { version } = useProfileRefresh()
  // Route changes remain a refetch trigger (cheap safety net); `version` is
  // the precise signal screens bump right after mutating the profile.
  const status = useProfileStatus(`${location.pathname}#${version}`)
  const [loggingOut, setLoggingOut] = useState(false)

  const person =
    status.state === 'complete' ||
    status.state === 'incomplete' ||
    status.state === 'awaiting_approval'
      ? status.person
      : null
  // Nav only appears once onboarding is done AND the member is approved --
  // an incomplete profile is locked to the wizard by AuthGate and an
  // unapproved one to /pending, so tabs would just bounce. (0019)
  const showNav = status.state === 'complete'
  // (5a) Admins get an extra nav tab. This was an account-menu item in Phase
  // 4; moderation is frequent enough to deserve the same treatment as every
  // other section. (5b-1) Read from AdminContext, fetched once per user.
  const { isAdmin } = useAdmin()

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
          {showNav && <HeaderNav isAdmin={isAdmin} />}
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {person && (
            <UserMenu
              fullName={person.full_name}
              photoUrl={person.profile_photo_url}
              // (0019) An unapproved member has a code but no access -- showing
              // the ID next to a "under review" screen just reads as a
              // contradiction, so it appears once they're in.
              memberCode={showNav ? person.member_code : null}
              onLogout={handleLogout}
              loggingOut={loggingOut}
            />
          )}
        </div>
      </header>
      <main className={`flex-1 flex flex-col ${showNav ? 'pb-16 sm:pb-0' : ''}`}>{children}</main>
      {showNav && <BottomTabs isAdmin={isAdmin} />}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ProfileRefreshProvider>
          <AdminProvider>
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
                {/* (0019) The holding screen between finishing the wizard and
                    being approved. /profile stays reachable for the same group
                    -- acting on a "more information needed" note means editing
                    it -- but nothing else does. */}
                <Route
                  path="/pending"
                  element={
                    <AuthGate key="pending" requireComplete allowPending>
                      <PendingApproval />
                    </AuthGate>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <AuthGate key="profile" requireComplete allowPending>
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
                  path="/explore"
                  element={
                    <AuthGate key="explore" requireComplete>
                      <Explore />
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
                {/* (5b-1) The admin console. AdminLayout does the admin gate
                    and renders the section nav around each page. allowPending:
                    an admin who is themselves still pending (or seeded by hand
                    before onboarding) must not be bounced to /pending -- the
                    is_admin() check is what governs these pages, not
                    membership. /admin/events is a Phase 4 path kept as a
                    redirect; /admin/members was one in 5a and is now the
                    members table. */}
                <Route
                  path="/admin"
                  element={
                    <AuthGate key="admin" requireComplete allowPending>
                      <AdminLayout />
                    </AuthGate>
                  }
                >
                  <Route index element={<AdminOverview />} />
                  <Route path="approvals" element={<AdminApprovals />} />
                  <Route path="members" element={<AdminMembers />} />
                  <Route path="members/:id" element={<AdminMemberDetail />} />
                  <Route path="businesses" element={<AdminBusinesses />} />
                  <Route path="audit" element={<AdminAudit />} />
                  <Route path="admins" element={<AdminAdmins />} />
                  <Route
                    path="events"
                    element={<Navigate to="/admin/approvals?tab=events" replace />}
                  />
                </Route>
              </Routes>
            </Layout>
          </AdminProvider>
        </ProfileRefreshProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
