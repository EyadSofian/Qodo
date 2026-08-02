import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { useAuth } from './auth';
import type { ActorMap, DirectoryUser, Notification, TaskCounts, WorkspaceApp } from './types';

const NO_TASKS: TaskCounts = {
  mine: 0,
  overdue: 0,
  dueToday: 0,
  unanswered: 0,
  awaitingMyReview: 0,
};

/**
 * Everything the chrome needs on every screen: the app registry (the launcher
 * grid and the switcher), the staff directory (assignee pickers) and the
 * notification bell. Loaded once per session instead of per page.
 */
interface WorkspaceState {
  apps: WorkspaceApp[];
  directory: DirectoryUser[];
  notifications: Notification[];
  actors: ActorMap;
  unread: number;
  /** Open work on the signed-in person's plate — the nav badge reads this. */
  taskCounts: TaskCounts;
  loading: boolean;
  reloadApps: () => Promise<void>;
  reloadDirectory: () => Promise<void>;
  reloadNotifications: () => Promise<void>;
  reloadTaskCounts: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  appById: (id: string | null | undefined) => WorkspaceApp | undefined;
  userById: (id: string | null | undefined) => DirectoryUser | undefined;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

// In-app alerts are the guaranteed channel; web push is optional. Twenty
// seconds keeps assignment alerts useful without maintaining a realtime server.
const POLL_MS = 20_000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [apps, setApps] = useState<WorkspaceApp[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [actors, setActors] = useState<ActorMap>({});
  const [unread, setUnread] = useState(0);
  const [taskCounts, setTaskCounts] = useState<TaskCounts>(NO_TASKS);
  const [loading, setLoading] = useState(true);

  const reloadApps = useCallback(async () => {
    const { apps: list } = await api.get<{ apps: WorkspaceApp[] }>('/apps');
    setApps(list);
  }, []);

  const reloadDirectory = useCallback(async () => {
    const { users } = await api.get<{ users: DirectoryUser[] }>('/auth/directory');
    setDirectory(users);
  }, []);

  const reloadNotifications = useCallback(async () => {
    const data = await api.get<{
      notifications: Notification[];
      actors: ActorMap;
      unread: number;
    }>('/notifications');
    setNotifications(data.notifications);
    setActors(data.actors);
    setUnread(data.unread);
  }, []);

  const reloadTaskCounts = useCallback(async () => {
    setTaskCounts(await api.get<TaskCounts>('/tasks/counts'));
  }, []);

  useEffect(() => {
    if (!user) {
      setApps([]);
      setDirectory([]);
      setNotifications([]);
      setUnread(0);
      setTaskCounts(NO_TASKS);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.allSettled([
      reloadApps(),
      reloadDirectory(),
      reloadNotifications(),
      reloadTaskCounts(),
    ]).finally(() => setLoading(false));
  }, [user, reloadApps, reloadDirectory, reloadNotifications, reloadTaskCounts]);

  // Poll the bell and the badge, but only while the tab is in front — a
  // workspace left open on a second monitor shouldn't keep hitting the API all
  // day. Both are cheap counts and stale numbers are the thing being fixed, so
  // they ride the same timer.
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      reloadNotifications().catch(() => {});
      reloadTaskCounts().catch(() => {});
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [user, reloadNotifications, reloadTaskCounts]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((count) => Math.max(0, count - 1));
    await api.post(`/notifications/${id}/read`).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await api.post('/notifications/read-all').catch(() => {});
  }, []);

  const value = useMemo<WorkspaceState>(
    () => ({
      apps,
      directory,
      notifications,
      actors,
      unread,
      taskCounts,
      loading,
      reloadApps,
      reloadDirectory,
      reloadNotifications,
      reloadTaskCounts,
      markRead,
      markAllRead,
      appById: (id) => (id ? apps.find((a) => a.id === id) : undefined),
      userById: (id) => (id ? directory.find((u) => u.id === id) : undefined),
    }),
    [
      apps,
      directory,
      notifications,
      actors,
      unread,
      taskCounts,
      loading,
      reloadApps,
      reloadDirectory,
      reloadNotifications,
      reloadTaskCounts,
      markRead,
      markAllRead,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return context;
}
