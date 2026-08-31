import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ThemeToggle } from './components/ThemeToggle'
import { AuthGate } from './components/guards/AuthGate'
import { RootRedirect } from './routes/RootRedirect'
import { Signup } from './routes/Signup'
import { VerifyOtp } from './routes/VerifyOtp'
import { ProfileWizard } from './routes/wizard/ProfileWizard'
import { Dashboard } from './routes/Dashboard'
import { ProfileEdit } from './routes/ProfileEdit'

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
        <span className="font-heading font-semibold text-lg">Khandelwal Connect</span>
        <ThemeToggle />
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
                <AuthGate>
                  <ProfileWizard />
                </AuthGate>
              }
            />
            <Route
              path="/dashboard"
              element={
                <AuthGate requireComplete>
                  <Dashboard />
                </AuthGate>
              }
            />
            <Route
              path="/profile/edit"
              element={
                <AuthGate requireComplete>
                  <ProfileEdit />
                </AuthGate>
              }
            />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  )
}
