import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { WorkspaceProvider } from './lib/workspace';
import { ToastProvider } from './components/ui';
import { Shell } from './components/Shell';
import { LogoMark } from './components/Brand';
import { Login } from './pages/Login';
import { Join } from './pages/Join';
import { Launcher } from './pages/Launcher';
import { AppFrame } from './pages/AppFrame';
import { Tasks } from './pages/Tasks';
import { Management } from './pages/Management';
import { Events } from './pages/Events';
import { Elearning } from './pages/Elearning';
import { Users } from './pages/Users';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <Gate />
            </WorkspaceProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

/**
 * One decision point: signed out shows the login screen, signed in shows the
 * workspace. Routes are not rendered at all while signed out, so no page can
 * flash its shell before the redirect.
 */
function Gate() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Invite links are handed to people who have no account yet, so this screen
  // has to render before — and regardless of — the session check.
  if (location.pathname.startsWith('/join/')) {
    return (
      <Routes>
        <Route path="/join/:token" element={<Join />} />
      </Routes>
    );
  }

  if (loading) return <Splash />;
  if (!user) return <Login />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Launcher />} />
        <Route path="/app/:appId" element={<AppFrame />} />
        <Route path="/tasks" element={<Tasks />} />
        {/* The route exists for everybody; the API is what refuses. Hiding it
            from the router instead would mean a bookmarked link lands on the
            launcher with no explanation. */}
        <Route path="/management" element={<Management />} />
        <Route path="/events" element={<Events />} />
        <Route path="/elearning" element={<Elearning />} />
        <Route path="/users" element={<Users />} />
        {/* Reachable by anybody who can see the person at all — the endpoints
            behind it are what decide how much of them is shown. */}
        <Route path="/people/:id" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function Splash() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-navy">
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={54} className="animate-pop-in" />
        <span className="h-1 w-24 overflow-hidden rounded-full bg-white/15">
          <span className="skeleton block h-full w-full !bg-white/30" />
        </span>
      </div>
    </div>
  );
}
