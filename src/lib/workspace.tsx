import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type {
  ActorMap,
  DirectoryUser,
  Notification,
  TaskCounts,
  WorkspaceApp,
} from "./types";

const NO_TASKS: TaskCounts = {
  mine: 0,
  overdue: 0,
  dueToday: 0,
  unanswered: 0,
  awaitingMyReview: 0,
  rework: 0,
  reworkTasks: [],
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
  /**
   * Live alerts waiting to be seen, newest first. A queue rather than a single
   * slot because two notifications arriving in the same poll used to mean the
   * second silently overwrote the first — the one case where the popup was
   * least excusable to lose, since a burst is exactly when things are busy.
   */
  incomingNotifications: Notification[];
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
  dismissIncomingNotification: (id: string) => void;
  appById: (id: string | null | undefined) => WorkspaceApp | undefined;
  userById: (id: string | null | undefined) => DirectoryUser | undefined;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

// The live stream is the fast path; this timer is the reliable fallback after
// a reconnect, a backgrounded tab or a multi-instance deployment.
const TASK_COUNTS_POLL_MS = 60_000;
// The stream is the fast path, but it is process-local. A short ordinary poll
// is the reliable path across reconnects, deploy overlap and multiple servers.
const NOTIFICATIONS_POLL_MS = 10_000;
const RECENT_ON_LOAD_MS = 90_000;

/** How many live alerts may stack before the rest wait in the bell alone. */
const MAX_LIVE_ALERTS = 8;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [apps, setApps] = useState<WorkspaceApp[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [incomingNotifications, setIncomingNotifications] = useState<
    Notification[]
  >([]);
  const [actors, setActors] = useState<ActorMap>({});
  const [unread, setUnread] = useState(0);
  const [taskCounts, setTaskCounts] = useState<TaskCounts>(NO_TASKS);
  const [loading, setLoading] = useState(true);
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const notificationStreamConnected = useRef(false);
  const notificationReloadPromise = useRef<Promise<void> | null>(null);

  const reloadApps = useCallback(async () => {
    const { apps: list } = await api.get<{ apps: WorkspaceApp[] }>("/apps");
    setApps(list);
  }, []);

  const reloadDirectory = useCallback(async () => {
    const { users } = await api.get<{ users: DirectoryUser[] }>(
      "/auth/directory",
    );
    setDirectory(users);
  }, []);

  const reloadNotifications = useCallback((): Promise<void> => {
    if (notificationReloadPromise.current)
      return notificationReloadPromise.current;

    const request = (async () => {
      const data = await api.get<{
        notifications: Notification[];
        actors: ActorMap;
        unread: number;
      }>("/notifications");
      const currentIds = new Set(
        data.notifications.map((notification) => notification.id),
      );
      const firstLoad = seenNotificationIds.current === null;
      const fresh = data.notifications.filter((notification) => {
        if (notification.read) return false;
        if (!firstLoad)
          return !seenNotificationIds.current?.has(notification.id);
        // If the page was opened by a push that just arrived, still show its
        // card. Older unread items stay in the bell without replaying a backlog.
        const created = Date.parse(notification.createdAt);
        return (
          Number.isFinite(created) && Date.now() - created <= RECENT_ON_LOAD_MS
        );
      });

      // Capped so a backlog arriving at once — a scheduler run, a reconnect
      // after the laptop wakes — announces itself without burying the screen.
      // The bell still holds every one of them.
      if (fresh.length > 0) {
        const freshIds = new Set(fresh.map((notification) => notification.id));
        setIncomingNotifications((queue) =>
          [
            ...fresh,
            ...queue.filter((notification) => !freshIds.has(notification.id)),
          ].slice(0, MAX_LIVE_ALERTS),
        );
      }
      seenNotificationIds.current = currentIds;
      setNotifications(data.notifications);
      setActors(data.actors);
      setUnread(data.unread);
    })();

    notificationReloadPromise.current = request;
    const clear = () => {
      if (notificationReloadPromise.current === request)
        notificationReloadPromise.current = null;
    };
    void request.then(clear, clear);
    return request;
  }, []);

  const reloadTaskCounts = useCallback(async () => {
    setTaskCounts(await api.get<TaskCounts>("/tasks/counts"));
  }, []);

  useEffect(() => {
    if (!user) {
      setApps([]);
      setDirectory([]);
      setNotifications([]);
      setIncomingNotifications([]);
      seenNotificationIds.current = null;
      notificationStreamConnected.current = false;
      notificationReloadPromise.current = null;
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
  }, [
    user,
    reloadApps,
    reloadDirectory,
    reloadNotifications,
    reloadTaskCounts,
  ]);

  // Task counts and notifications have different freshness needs. The bell is
  // cheap and user-facing, so it reconciles every ten seconds even while SSE
  // is healthy; the single-flight loader prevents a burst of stream events and
  // the timer from duplicating cards.
  useEffect(() => {
    if (!user) return;
    const refreshCounts = () => {
      if (document.visibilityState !== "visible") return;
      reloadTaskCounts().catch(() => {});
    };
    const refreshNotifications = () => {
      if (document.visibilityState === "visible")
        reloadNotifications().catch(() => {});
    };
    const taskTimer = setInterval(refreshCounts, TASK_COUNTS_POLL_MS);
    const notificationTimer = setInterval(
      refreshNotifications,
      NOTIFICATIONS_POLL_MS,
    );
    const onVisible = () => {
      refreshCounts();
      refreshNotifications();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(taskTimer);
      clearInterval(notificationTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, reloadNotifications, reloadTaskCounts]);

  // The server emits only a lightweight signal; the ordinary authenticated
  // endpoints remain the source of truth. EventSource reconnects by itself,
  // while the timer above is the cross-instance/offline fallback.
  useEffect(() => {
    if (!user || typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/notifications/stream");
    const connected = () => {
      if (notificationStreamConnected.current) return;
      notificationStreamConnected.current = true;
      // Reconcile anything written while the browser was asleep or the stream
      // was reconnecting. The durable endpoint, not the SSE payload, is truth.
      reloadNotifications().catch(() => {});
    };
    const disconnected = () => {
      notificationStreamConnected.current = false;
    };
    const refresh = () => {
      reloadNotifications().catch(() => {});
      reloadTaskCounts().catch(() => {});
    };
    stream.addEventListener("open", connected);
    stream.addEventListener("ready", connected);
    stream.addEventListener("error", disconnected);
    stream.addEventListener("notification", refresh);
    return () => {
      notificationStreamConnected.current = false;
      stream.removeEventListener("open", connected);
      stream.removeEventListener("ready", connected);
      stream.removeEventListener("error", disconnected);
      stream.removeEventListener("notification", refresh);
      stream.close();
    };
  }, [user, reloadNotifications, reloadTaskCounts]);

  // Reading a notification anywhere — the bell, the popup itself — retires the
  // live alert too. Being told twice about something already dealt with is the
  // other half of "the popup is noisy".
  const markRead = useCallback(async (id: string) => {
    setNotifications((list) =>
      list.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setIncomingNotifications((queue) => queue.filter((n) => n.id !== id));
    setUnread((count) => Math.max(0, count - 1));
    await api.post(`/notifications/${id}/read`).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    setIncomingNotifications([]);
    setUnread(0);
    await api.post("/notifications/read-all").catch(() => {});
  }, []);

  const dismissIncomingNotification = useCallback(
    (id: string) =>
      setIncomingNotifications((queue) => queue.filter((n) => n.id !== id)),
    [],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      apps,
      directory,
      notifications,
      incomingNotifications,
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
      dismissIncomingNotification,
      appById: (id) => (id ? apps.find((a) => a.id === id) : undefined),
      userById: (id) => (id ? directory.find((u) => u.id === id) : undefined),
    }),
    [
      apps,
      directory,
      notifications,
      incomingNotifications,
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
      dismissIncomingNotification,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
