import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BellRing,
  Bot,
  Briefcase,
  ChevronDown,
  Home,
  KeyRound,
  Languages,
  LayoutGrid,
  ListChecks,
  LogOut,
  Search,
  Send,
  Settings2,
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
  const { unread, taskCounts } = useWorkspace();
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
      await sendTestPush(lang);
      toast(t('push.testSent'));
    } catch {
      toast(t('push.testFailed'), 'bad');
    }
  };

  const isFramed = location.pathname.startsWith('/app/');
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
        the app-switcher and notification sheets inside the 60px-tall bar on
        phones. The bottom nav can keep its blur — nothing fixed lives in it.
      */}
      <header className="sticky top-0 z-30 border-b border-surface-line bg-white/95 pt-safe">
        <div className="mx-auto flex h-[var(--topbar-h)] w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center rounded-lg px-1 py-1" aria-label={t('common.home')}>
            <Logo height={26} className="sm:!h-[30px]" />
          </Link>

          <div className="relative">
            <button
              type="button"
              data-app-switcher-trigger
              onClick={() => {
                setSwitcherOpen((v) => !v);
                setBellOpen(false);
              }}
              aria-expanded={switcherOpen}
              className={cx(
                'btn !min-h-10 gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold sm:px-3',
                switcherOpen ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
              )}
            >
              <LayoutGrid size={17} />
              <span className="hidden sm:inline">{t('shell.apps')}</span>
              <ChevronDown size={14} className={cx('transition-transform', switcherOpen && 'rotate-180')} />
            </button>
            <AppSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} onOpenApp={openApp} />
          </div>

          {/* Desktop gets a real search field; the phone gets an icon that opens
              the same sheet, because a text input here would crowd the bar. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden h-10 flex-1 items-center gap-2 rounded-xl border border-surface-line bg-white/70 px-3 text-start text-[13px] text-ink-faint transition-colors hover:border-brand-200 hover:bg-white md:flex"
          >
            <Search size={16} />
            <span className="flex-1">{t('shell.searchPlaceholder')}</span>
            <kbd className="ltr rounded border border-surface-line bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold">
              Ctrl K
            </kbd>
          </button>

          <div className="flex-1 md:hidden" />

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="btn-quiet !min-h-10 rounded-xl px-2.5 md:hidden"
            aria-label={t('common.search')}
          >
            <Search size={19} />
          </button>

          {/* The phone reaches the board from the tab bar; on desktop there was
              no way in but the launcher grid, which is where the badge belongs
              least — you see it once, on the way somewhere else. */}
          {can(PERMISSIONS.TASKS_VIEW) && (
            <NavLink
              to="/tasks"
              className={({ isActive }) =>
                cx(
                  'btn !min-h-10 relative hidden shrink-0 gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold md:flex',
                  isActive ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                )
              }
            >
              <span className="relative">
                <ListChecks size={18} />
                {taskCounts.mine + taskCounts.awaitingMyReview > 0 && (
                  <CountBadge
                    value={taskCounts.mine + taskCounts.awaitingMyReview}
                    urgent={taskCounts.overdue > 0}
                  />
                )}
              </span>
              <span className="hidden lg:inline">{t('tasks.title')}</span>
            </NavLink>
          )}

          {/* Only the people actually on the management desk ever see this —
              no role carries the key, it is granted one person at a time. */}
          {can(PERMISSIONS.MANAGEMENT_VIEW) && (
            <NavLink
              to="/management"
              className={({ isActive }) =>
                cx(
                  'btn !min-h-10 hidden shrink-0 gap-1.5 rounded-xl px-2.5 text-[13px] font-semibold md:flex',
                  isActive ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                )
              }
            >
              <Briefcase size={18} />
              <span className="hidden lg:inline">{t('management.title')}</span>
            </NavLink>
          )}

          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="btn !min-h-10 shrink-0 gap-1.5 rounded-xl bg-brand-50 px-2.5 text-[13px] font-semibold text-brand-600 hover:bg-brand-100 sm:px-3"
            aria-label={t('shell.assistant')}
          >
            <Bot size={18} />
            <span className="hidden lg:inline">{t('shell.assistant')}</span>
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
              className={cx('btn-quiet relative !min-h-10 rounded-xl px-2.5', bellOpen && 'bg-surface-sunken text-ink')}
            >
              <Bell size={19} />
              {unread > 0 && (
                <span className="absolute end-1.5 top-1.5 grid min-w-[16px] place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold leading-4 text-white">
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
              className="flex items-center gap-2 rounded-xl p-1 transition-colors hover:bg-surface-sunken"
              aria-label={t('shell.account')}
            >
              <Avatar name={user?.name ?? '?'} color={user?.avatarColor} size={32} />
              <span className="hidden text-start lg:block">
                <span className="block max-w-[9rem] truncate text-[13px] font-bold leading-tight text-ink">
                  {user?.name}
                </span>
                <span className="block text-[11px] leading-tight text-ink-faint">
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
      <main className={cx('flex-1', isFramed ? 'flex min-h-0 flex-col' : 'pb-24 md:pb-10')}>
        {children}
      </main>

      {!isFramed && <BottomNav onOpenSwitcher={() => setSwitcherOpen(true)} />}

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
 * The count that rides on an icon. Capped at 99 — past that the exact figure
 * stops being information and the badge just needs to say "a lot".
 */
export function CountBadge({ value, urgent = false }: { value: number; urgent?: boolean }) {
  return (
    <span
      className={cx(
        'absolute -end-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full',
        'px-1 text-[10px] font-extrabold leading-none tabular-nums text-white ring-2 ring-white',
        urgent ? 'bg-status-bad' : 'bg-brand-500'
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

/** Phone-only tab bar — the workspace should feel like an app, not a website. */
function BottomNav({ onOpenSwitcher }: { onOpenSwitcher: () => void }) {
  const { can } = useAuth();
  const { t } = useI18n();
  const { taskCounts } = useWorkspace();
  const taskBadge = taskCounts.mine + taskCounts.awaitingMyReview;

  const items = [
    { to: '/', label: t('common.home'), icon: Home, end: true, badge: 0, urgent: false },
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
    <nav className="surface-blur fixed inset-x-0 bottom-0 z-30 border-b-0 border-t pb-safe md:hidden">
      <div className="flex items-stretch justify-around px-2">
        {items.map(({ to, label, icon: Icon, end, badge, urgent }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors',
                isActive ? 'text-brand-500' : 'text-ink-faint'
              )
            }
          >
            <span className="relative">
              <Icon size={20} />
              {badge > 0 && <CountBadge value={badge} urgent={urgent} />}
            </span>
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onOpenSwitcher}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold text-ink-faint"
        >
          <LayoutGrid size={20} />
          {t('shell.apps')}
        </button>
      </div>
    </nav>
  );
}
