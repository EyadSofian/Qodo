import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { WorkspaceProvider } from './lib/workspace';
import { ToastProvider } from './components/ui';
import { Shell } from './components/Shell';
import { LogoMark } from './components/Brand';
import { Login } from './pages/Login';
import { Launcher } from './pages/Launcher';
import { AppFrame } from './pages/AppFrame';
import { Tasks } from './pages/Tasks';
import { Users } from './pages/Users';
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

  if (loading) return <Splash />;
  if (!user) return <Login />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Launcher />} />
        <Route path="/app/:appId" element={<AppFrame />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/users" element={<Users />} />
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
