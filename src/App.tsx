import { Suspense, lazy, type ReactNode } from 'react';
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
import { Mail } from './pages/Mail';
import { Calendar } from './pages/Calendar';
import { Offices } from './pages/Offices';
import { Book } from './pages/Book';
import { HR, HREmployee } from './pages/HR';
import { Prices } from './pages/Prices';

/**
 * Qodo Projects loads on demand.
 *
 * It is the largest module in the workspace and most people open the launcher,
 * their mail or their tasks without ever touching it — so it has no business in
 * the bundle everybody downloads at sign-in. The Gantt in particular must never
 * reach the main chunk. See §73 and ADR-6.
 */
const ProjectsList = lazy(() =>
  import('./pages/projects/ProjectsList').then((module) => ({ default: module.ProjectsList }))
);
const ProjectsPortfolio = lazy(() =>
  import('./pages/projects/ProjectsPortfolio').then((module) => ({ default: module.ProjectsPortfolio }))
);
const ProjectsSettings = lazy(() =>
  import('./pages/projects/ProjectsSettings').then((module) => ({ default: module.ProjectsSettings }))
);
const ProjectDetail = lazy(() =>
  import('./pages/projects/ProjectDetail').then((module) => ({ default: module.ProjectDetail }))
);
const ProjectOverview = lazy(() =>
  import('./pages/projects/tabs/ProjectOverview').then((module) => ({ default: module.ProjectOverview }))
);
const ProjectPhases = lazy(() =>
  import('./pages/projects/tabs/ProjectPhases').then((module) => ({ default: module.ProjectPhases }))
);
const ProjectTasks = lazy(() =>
  import('./pages/projects/tabs/ProjectTasks').then((module) => ({ default: module.ProjectTasks }))
);
const ProjectGantt = lazy(() =>
  import('./pages/projects/tabs/ProjectGantt').then((module) => ({ default: module.ProjectGantt }))
);
const ProjectIssues = lazy(() =>
  import('./pages/projects/tabs/ProjectIssues').then((module) => ({ default: module.ProjectIssues }))
);
const ProjectTimesheet = lazy(() =>
  import('./pages/projects/tabs/ProjectTimesheet').then((module) => ({ default: module.ProjectTimesheet }))
);
const ProjectBudget = lazy(() =>
  import('./pages/projects/tabs/ProjectBudget').then((module) => ({ default: module.ProjectBudget }))
);
const ProjectDocuments = lazy(() =>
  import('./pages/projects/tabs/ProjectDocuments').then((module) => ({ default: module.ProjectDocuments }))
);
const ProjectReports = lazy(() =>
  import('./pages/projects/tabs/ProjectReports').then((module) => ({ default: module.ProjectReports }))
);
const ProjectMembers = lazy(() =>
  import('./pages/projects/tabs/ProjectMembers').then((module) => ({ default: module.ProjectMembers }))
);
const ProjectActivity = lazy(() =>
  import('./pages/projects/tabs/ProjectActivity').then((module) => ({ default: module.ProjectActivity }))
);

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

  // A booking page is for a customer, who will never have an account here. It
  // renders outside the shell entirely: no navigation, no launcher, nothing
  // that implies the visitor is inside the workspace — because they are not.
  if (location.pathname.startsWith('/book/')) {
    return (
      <Routes>
        <Route path="/book/manage/:token" element={<Book manage />} />
        <Route path="/book/:slug" element={<Book />} />
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
        {/* Qodo Projects. The route exists for everybody and the API is what
            refuses — the same choice the management desk makes below, and for
            the same reason: a bookmarked link that lands on the launcher with
            no explanation is worse than one that lands on a refusal. */}
        <Route
          path="/projects"
          element={
            <Suspense fallback={<Splash />}>
              <ProjectsList />
            </Suspense>
          }
        />
        <Route
          path="/projects/portfolio"
          element={
            <Suspense fallback={<Splash />}>
              <ProjectsPortfolio />
            </Suspense>
          }
        />
        <Route
          path="/projects/settings"
          element={
            <Suspense fallback={<Splash />}>
              <ProjectsSettings />
            </Suspense>
          }
        />
        {/* One project. The shell loads it once and the tabs render into it,
            so moving between Tasks and Phases is a route change rather than a
            reload of who you are and what you may do here. */}
        <Route
          path="/projects/:projectId"
          element={
            <Suspense fallback={<Splash />}>
              <ProjectDetail />
            </Suspense>
          }
        >
          <Route index element={<Suspended><ProjectOverview /></Suspended>} />
          <Route path="phases" element={<Suspended><ProjectPhases /></Suspended>} />
          <Route path="tasks" element={<Suspended><ProjectTasks /></Suspended>} />
          <Route path="gantt" element={<Suspended><ProjectGantt /></Suspended>} />
          <Route path="issues" element={<Suspended><ProjectIssues /></Suspended>} />
          <Route path="timesheet" element={<Suspended><ProjectTimesheet /></Suspended>} />
          <Route path="budget" element={<Suspended><ProjectBudget /></Suspended>} />
          <Route path="documents" element={<Suspended><ProjectDocuments /></Suspended>} />
          <Route path="reports" element={<Suspended><ProjectReports /></Suspended>} />
          <Route path="members" element={<Suspended><ProjectMembers /></Suspended>} />
          <Route path="activity" element={<Suspended><ProjectActivity /></Suspended>} />
        </Route>
        <Route path="/mail" element={<Mail />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/offices" element={<Offices />} />
        <Route path="/hr" element={<HR />} />
        <Route path="/hr/employees/:employeeCode" element={<HREmployee />} />
        <Route path="/prices" element={<Prices />} />
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

/**
 * A tab's loading frame.
 *
 * Deliberately not `<Splash />` — that is the full-screen navy sign-in splash,
 * and showing it while a tab chunk arrives would make switching tabs look like
 * signing out and back in.
 */
function Suspended({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="card grid place-items-center py-16">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-surface-line border-t-brand-500" />
        </div>
      }
    >
      {children}
    </Suspense>
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
