import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  Briefcase,
  CalendarDays,
  Home,
  KeyRound,
  Languages,
  LayoutGrid,
  ListChecks,
  LogOut,
  Mail,
  Search,
  Send,
  Settings2,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { useOpenApp } from '../lib/useOpenApp';
import { cx } from '../lib/utils';
import {
  currentPushState,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  sendTestPush,
  type PushState,
} from '../lib/push';
import { PERMISSIONS } from '@shared/permissions';
import { Logo } from './Brand';
import { AppSwitcher } from './AppSwitcher';
import { NotificationsMenu } from './NotificationsMenu';
import { SearchPalette } from './SearchPalette';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Assistant } from './Assistant';
import { TaskSummaryPopup } from './TaskSummaryPopup';
import { IncomingNotificationPopup } from './IncomingNotificationPopup';
import { ReworkGuard } from './ReworkGuard';
import { Avatar, useToast } from './ui';

/**
 * The chrome every screen sits in: brand, app switcher, search, bell, account.
 * It is the "one workspace" layer — whichever module you are in, the same bar
 * is above it and the same grid is one click away.
 */
export function Shell({ children }: { children: ReactNode }) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [push, setPush] = useState<PushState>('unsupported');

  const { user, signOut, can } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { unread, taskCounts, reloadNotifications, showIncomingNotification } = useWorkspace();
  const { push: toast } = useToast();
  const openApp = useOpenApp();
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  // Every panel closes on navigation — otherwise the switcher stays open behind
  // the page you just asked it for.
  useEffect(() => {
    setSwitcherOpen(false);
    setBellOpen(false);
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    currentPushState().then(setPush).catch(() => setPush('unsupported'));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        if (!(target instanceof Element && target.closest('[data-account-trigger]'))) {
          setMenuOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen]);

  const togglePush = async () => {
    setMenuOpen(false);
    try {
      if (push === 'on') {
        setPush(await disablePush());
        toast(t('push.disabled'));
        return;
      }
      const next = await enablePush();
      setPush(next);
      if (next === 'on') toast(t('push.enabled'));
      else if (next === 'denied') toast(t('push.denied'), 'bad');
      else if (next === 'unconfigured') toast(t('push.notConfigured'), 'bad');
      else toast(t('push.failed'), 'bad');
    } catch {
      toast(t('push.failed'), 'bad');
    }
  };

  const testPush = async () => {
    setMenuOpen(false);
    try {
      const notification = await sendTestPush(lang);
      if (notification) showIncomingNotification(notification);
      await reloadNotifications();
      toast(t('push.testSent'));
    } catch {
      toast(t('push.testFailed'), 'bad');
    }
  };

  const isFramed = location.pathname.startsWith('/app/');
  // Its own module (dark sidebar + internally-scrolling pane), not a guest
  // app — kept as a second flag rather than folded into `isFramed` so that
  // name keeps meaning only "/app/*".
  const isLearningProduction = location.pathname.startsWith('/learning-production');
  // HR V2 carries its own phone navigation for its nine areas.
  const isHR = location.pathname === '/hr' || location.pathname.startsWith('/hr/');
  const isFullHeight = isFramed || isLearningProduction || location.pathname.startsWith('/mail');
  // On iPhone, web push only exists once the site is on the home screen — so a
  // plain Safari tab reports unsupported and the row is hidden rather than
  // offering a button that cannot work. Every desktop browser that matters
  // supports it outright, which is why nothing here is phone-specific.
  const showPushRow = push === 'off' || push === 'on' || (isIos() && !isStandalone() ? false : push === 'denied');

  // `unconfigured` means the server has no VAPID keys, so the button would do
  // nothing for anybody. Silently hiding the row left the one person who can
  // fix that with no way to discover it — they see a disabled row saying so,
  // and everybody else still sees nothing to be confused by.
  const showPushMissingKeys = push === 'unconfigured' && can(PERMISSIONS.SETTINGS_MANAGE);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/*
        No backdrop-filter here on purpose: an element with one becomes the
        containing block for its `position: fixed` descendants, which would trap
        the app-switcher and notification sheets inside the bar on phones. The
        bar is an opaque gradient, so it has no need of one.
      */}
      <header className="sh-bar sticky top-0 z-30 pt-safe">
        <div className="mx-auto flex h-[var(--topbar-h)] w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center rounded-lg px-1 py-1" aria-label={t('common.home')}>
            <Logo tone="white" height={26} className="sm:!h-[30px]" />
          </Link>

          <span className="hidden h-7 w-px shrink-0 bg-white/10 md:block" aria-hidden="true" />

          {/* The wrapper stays on phones: the tab bar opens the same switcher,
              which renders as a bottom sheet there. */}
          <div className="relative shrink-0">
            <button
              type="button"
              data-app-switcher-trigger
              onClick={() => {
                setSwitcherOpen((v) => !v);
                setBellOpen(false);
              }}
              aria-expanded={switcherOpen}
              aria-label={t('shell.apps')}
              title={t('shell.apps')}
              className="sh-icon-btn !hidden md:!inline-grid"
            >
              <LayoutGrid size={18} className={cx('transition-transform duration-300', switcherOpen && 'rotate-45')} />
            </button>
            <AppSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} onOpenApp={openApp} />
          </div>

          <nav className="sh-dock hidden md:flex" aria-label={t('shell.apps')}>
            <DockLink to="/" end icon={Home} label={t('common.home')} accent="#2AA7F0" />
            {can(PERMISSIONS.TASKS_VIEW) && (
              <DockLink
                to="/tasks"
                icon={ListChecks}
                label={t('tasks.title')}
                accent="#16A34A"
                badge={taskCounts.mine + taskCounts.awaitingMyReview}
                urgent={taskCounts.overdue > 0}
              />
            )}
            <DockLink to="/mail" icon={Mail} label={t('mail.title')} accent="#1D6FB8" />
            {/* No permission gate: everybody has a calendar. What an entry
                reaches is decided on the entry, not on the person opening it. */}
            <DockLink to="/calendar" icon={CalendarDays} label={t('calendar.title')} accent="#7C3AED" />
            {/* Only the people actually on the management desk ever see this —
                no role carries the key, it is granted one person at a time. */}
            {can(PERMISSIONS.MANAGEMENT_VIEW) && (
              <DockLink to="/management" icon={Briefcase} label={t('management.title')} accent="#F5821F" />
            )}
          </nav>

          <div className="min-w-0 flex-1" />

          {/* Desktop gets a real search field; the phone gets an icon that opens
              the same sheet, because a text input here would crowd the bar. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="sh-search hidden w-52 md:flex lg:w-64 xl:w-80"
          >
            <Search size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('shell.searchPlaceholder')}</span>
            <kbd className="ltr hidden rounded-md bg-white/10 px-1.5 py-0.5 font-display text-[10px] font-medium text-white/60 lg:inline">
              Ctrl K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="sh-icon-btn md:hidden"
            aria-label={t('common.search')}
          >
            <Search size={19} />
          </button>

          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="sh-ai max-sm:w-10 max-sm:justify-center max-sm:px-0"
            aria-label={t('shell.assistant')}
          >
            <Sparkles size={16} className="text-sky-300" />
            <span className="hidden sm:inline">{t('shell.assistant')}</span>
          </button>
          <div className="relative shrink-0">
            <button
              type="button"
              data-notifications-trigger
              onClick={() => {
                setBellOpen((v) => !v);
                setSwitcherOpen(false);
              }}
              aria-label={unread > 0 ? t('shell.notificationsWithCount', { n: unread }) : t('shell.notifications')}
              aria-expanded={bellOpen}
              className="sh-icon-btn"
            >
              <Bell size={19} className={cx(unread > 0 && 'origin-top animate-[sh-ring_2.4s_ease-in-out_infinite]')} />
              {unread > 0 && (
                <span className="absolute end-1 top-1 grid min-w-[17px] place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold leading-[17px] text-white ring-2 ring-navy">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            <NotificationsMenu
              open={bellOpen}
              onClose={() => setBellOpen(false)}
              showPushSetup={push === 'off'}
              onEnablePush={togglePush}
            />
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              data-account-trigger
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-white/10"
              aria-label={t('shell.account')}
            >
              <span className="rounded-full bg-gradient-to-br from-sky-400 via-brand-500 to-accent-500 p-[2px]">
                <span className="block rounded-full ring-2 ring-navy">
                  <Avatar name={user?.name ?? '?'} color={user?.avatarColor} size={30} />
                </span>
              </span>
              <span className="hidden text-start xl:block">
                <span className="block max-w-[9rem] truncate font-display text-[13px] font-medium leading-tight text-white">
                  {user?.name}
                </span>
                <span className="block text-[11px] leading-tight text-white/50">
                  {t(`role.${user?.role ?? 'member'}` as 'role.member')}
                </span>
              </span>
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                className="absolute end-0 top-[calc(100%+10px)] z-50 w-64 overflow-hidden rounded-2xl border border-surface-line bg-white shadow-panel animate-fade-up"
              >
                <div className="flex items-center gap-3 border-b border-surface-line px-4 py-3">
                  <Avatar name={user?.name ?? '?'} color={user?.avatarColor} size={38} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-ink">{user?.name}</p>
                    <p className="ltr truncate text-[11.5px] text-ink-faint">{user?.email}</p>
                  </div>
                </div>

                <div className="p-1.5">
                  <span className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] text-ink-muted">
                    <ShieldCheck size={15} className="text-brand-500" />
                    {t(`role.${user?.role ?? 'member'}` as 'role.member')}
                  </span>

                  <button
                    type="button"
                    onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-sunken"
                  >
                    <Languages size={15} />
                    {lang === 'ar' ? 'English' : 'العربية'}
                  </button>

                  {showPushRow && (
                    <button
                      type="button"
                      onClick={togglePush}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-sunken"
                    >
                      <BellRing size={15} className={push === 'on' ? 'text-status-ok' : undefined} />
                      {push === 'on' ? t('shell.notificationsEnabled') : t('shell.enableNotifications')}
                    </button>
                  )}

                  {showPushMissingKeys && (
                    <span className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-[12px] leading-relaxed text-ink-faint">
                      <BellRing size={15} className="mt-0.5 shrink-0" />
                      {t('shell.notificationsNoKeys')}
                    </span>
                  )}

                  {/* Normal alerts skip the person who caused them, so this is
                      the only way to confirm delivery without a colleague. */}
                  {push === 'on' && (
                    <button
                      type="button"
                      onClick={testPush}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-surface-sunken"
                    >
                      <Send size={15} />
                      {t('shell.testNotification')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setPasswordOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-sunken"
                  >
                    <KeyRound size={15} />
                    {t('auth.changePassword')}
                  </button>

                  {can(PERMISSIONS.SETTINGS_MANAGE) && (
                    <button
                      type="button"
                      onClick={() => navigate('/settings')}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-sunken"
                    >
                      <Settings2 size={15} />
                      {t('shell.workspaceSettings')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => signOut()}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-status-bad transition-colors hover:bg-status-badBg"
                  >
                    <LogOut size={15} />
                    {t('auth.signOut')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* A framed app manages its own height; normal pages scroll the document. */}
      <main className={cx('flex-1', isFullHeight ? 'flex min-h-0 flex-col' : isHR ? '' : 'pb-28 md:pb-10')}>
        {children}
      </main>

      {/* The module's own mobile drawer (its Layout) replaces this with all
          five destinations, so the global bar would only duplicate it. */}
      {!isFramed && !isLearningProduction && !isHR && <BottomNav onOpenSwitcher={() => setSwitcherOpen(true)} />}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <Assistant open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <TaskSummaryPopup />
      <IncomingNotificationPopup />
      <ReworkGuard />
    </div>
  );
}

/**
 * One stop on the desktop dock. The lit pill is shared across every stop
 * (`layoutId`), so moving between them slides it rather than blinking it.
 */
function DockLink({
  to,
  end = false,
  icon: Icon,
  label,
  accent,
  badge = 0,
  urgent = false,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
  accent: string;
  badge?: number;
  urgent?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className="sh-dock-item" title={label}>
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="sh-dock-pill"
              className="sh-dock-pill"
              transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <span className="relative">
              <Icon size={17} style={isActive ? { color: accent } : undefined} />
              {badge > 0 && <CountBadge value={badge} urgent={urgent} onDark={!isActive} />}
            </span>
            <span className="hidden lg:inline">{label}</span>
          </span>
        </>
      )}
    </NavLink>
  );
}

/**
 * The count that rides on an icon. Capped at 99 — past that the exact figure
 * stops being information and the badge just needs to say "a lot".
 */
export function CountBadge({
  value,
  urgent = false,
  onDark = false,
}: {
  value: number;
  urgent?: boolean;
  /** Rings the badge in navy instead of white, for the command bar. */
  onDark?: boolean;
}) {
  return (
    <span
      className={cx(
        'absolute -end-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full',
        'px-1 text-[10px] font-extrabold leading-none tabular-nums text-white ring-2',
        onDark ? 'ring-navy' : 'ring-white',
        urgent ? 'bg-status-bad' : 'bg-brand-500'
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

/** Phone-only tab bar — a floating dock, so the workspace feels like an app. */
function BottomNav({ onOpenSwitcher }: { onOpenSwitcher: () => void }) {
  const { can } = useAuth();
  const { t } = useI18n();
  const { taskCounts } = useWorkspace();
  const taskBadge = taskCounts.mine + taskCounts.awaitingMyReview;

  const items = [
    { to: '/', label: t('shell.homeShort'), icon: Home, end: true, badge: 0, urgent: false },
    { to: '/mail', label: t('mail.title'), icon: Mail, end: false, badge: 0, urgent: false },
    ...(can(PERMISSIONS.TASKS_VIEW)
      ? [
          {
            to: '/tasks',
            label: t('tasks.title'),
            icon: ListChecks,
            end: false,
            badge: taskBadge,
            urgent: taskCounts.overdue > 0,
          },
        ]
      : []),
    ...(can(PERMISSIONS.MANAGEMENT_VIEW)
      ? [
          {
            to: '/management',
            label: t('management.title'),
            icon: Briefcase,
            end: false,
            badge: 0,
            urgent: false,
          },
        ]
      : []),
    ...(can(PERMISSIONS.USERS_VIEW)
      ? [
          {
            to: '/users',
            label: t('shell.team'),
            icon: ShieldCheck,
            end: false,
            badge: 0,
            urgent: false,
          },
        ]
      : []),
  ];

  return (
    <nav className="sh-tabbar">
      {items.map(({ to, label, icon: Icon, end, badge, urgent }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cx(
              'relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-2 font-display text-[10.5px] font-medium transition-colors',
              isActive ? 'text-navy' : 'text-white/55'
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sh-tab-pill"
                  className="absolute inset-0 rounded-2xl bg-white shadow-[0_8px_20px_-10px_rgb(42_167_240/0.9)]"
                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                />
              )}
              <span className="relative">
                <Icon size={19} className={isActive ? 'text-brand-500' : undefined} />
                {badge > 0 && <CountBadge value={badge} urgent={urgent} onDark={!isActive} />}
              </span>
              <span className="relative max-w-full truncate px-0.5">{label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenSwitcher}
        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-2 font-display text-[10.5px] font-medium text-white/55"
      >
        <LayoutGrid size={19} />
        <span className="max-w-full truncate px-0.5">{t('shell.apps')}</span>
      </button>
    </nav>
  );
}
