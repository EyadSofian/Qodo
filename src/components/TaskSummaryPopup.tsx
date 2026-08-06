/**
 * The "here is your day" alert, shown once per sign-in.
 *
 * It exists because the badge answers *how many* and nothing answers *which
 * kind* — three open tasks with one overdue is a different morning from three
 * open tasks due next week. Sessions last twelve hours, so "once per session"
 * is genuinely once a day for most people; the marker is keyed to the session
 * cookie's lifetime via sessionStorage, which clears when the tab does.
 *
 * It used to be a modal, and that was the wrong shape for it. A modal is for a
 * question that must be answered before anything else can happen, and this is
 * not a question — it is the morning's news. Blocking the whole app behind an
 * OK button to deliver news teaches people to dismiss it without reading, which
 * is exactly the failure it was built to avoid. It is now the same slide-in
 * alert the workspace already uses for live notifications: same corner, same
 * dark card, same dismiss. You can read it or ignore it and keep working.
 *
 * It never appears with nothing to say.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Inbox,
  ListChecks,
  Sunrise,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { PERMISSIONS } from '@shared/permissions';
import { cx } from '../lib/utils';

const SEEN_KEY = 'engosoft.summary.seen';

/**
 * Longer than a live notification's dwell. That one announces a single thing
 * that just happened; this one is a list to read and count, and it arrives in
 * the same second as the dashboard it sits on top of.
 */
const AUTO_DISMISS_MS = 12_000;

export function TaskSummaryPopup() {
  const { user, can } = useAuth();
  const { taskCounts, loading } = useWorkspace();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!user || loading || !can(PERMISSIONS.TASKS_VIEW)) return;
    // Per account, not per browser: a shared machine shouldn't swallow the
    // second person's summary because the first already saw theirs.
    const key = `${SEEN_KEY}.${user.id}`;
    if (sessionStorage.getItem(key)) return;

    const worthShowing =
      taskCounts.mine > 0 || taskCounts.awaitingMyReview > 0 || taskCounts.unanswered > 0;
    if (!worthShowing) return;

    sessionStorage.setItem(key, '1');
    setOpen(true);
  }, [user, loading, taskCounts, can]);

  // Unlike a modal, an alert has to take itself away. Hovering holds it open,
  // because a list of five numbers is longer to read than one sentence.
  useEffect(() => {
    if (!open || paused) return;
    const timer = setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [open, paused]);

  const rows = [
    { id: 'overdue' as const, value: taskCounts.overdue, icon: AlertTriangle, tone: 'bg-status-bad' },
    { id: 'dueToday' as const, value: taskCounts.dueToday, icon: CalendarClock, tone: 'bg-accent-500' },
    { id: 'unanswered' as const, value: taskCounts.unanswered, icon: Inbox, tone: 'bg-white/15' },
    {
      id: 'awaitingMyReview' as const,
      value: taskCounts.awaitingMyReview,
      icon: ClipboardCheck,
      tone: 'bg-status-ok',
    },
    { id: 'open' as const, value: taskCounts.mine, icon: ListChecks, tone: 'bg-brand-500' },
    // Worst news first: what is already late outranks what is merely mine.
  ].filter((row) => row.value > 0);

  if (!open) return null;

  const close = () => setOpen(false);
  const hour = new Date().getHours();

  return (
    <div className="pointer-events-none fixed inset-x-3 top-[calc(var(--sat)+var(--topbar-h)+0.75rem)] z-[70] flex flex-col items-center sm:items-end sm:px-2">
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl bg-navy shadow-panel ring-1 ring-white/10 animate-pop-in"
      >
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white">
            <Sunrise size={20} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-extrabold leading-snug text-white">
              {hour < 12 ? t('summary.title') : t('summary.titleEvening')}
            </p>

            <ul className="mt-2.5 grid gap-1.5">
              {rows.map(({ id, value, icon: Icon, tone }) => (
                <li key={id} className="flex items-center gap-2.5">
                  <span
                    className={cx(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-md text-white',
                      tone
                    )}
                  >
                    <Icon size={13} strokeWidth={2.5} />
                  </span>
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-white/75">
                    {t(`summary.${id}` as StringKey)}
                  </span>
                  <span className="text-[15px] font-extrabold tabular-nums text-white">{value}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => {
                close();
                navigate('/tasks');
              }}
              className="mt-3 rounded-lg bg-white px-3.5 py-2 text-[12px] font-bold text-navy transition-colors hover:bg-brand-100"
            >
              {t('summary.openBoard')}
            </button>
          </div>

          <button
            type="button"
            onClick={close}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('summary.dismiss')}
          >
            <X size={16} />
          </button>
        </div>

        {/* How long is left, frozen while it is hovered — the same contract the
            live notifications make, so the two never behave differently. */}
        <div className="h-1 bg-white/10">
          <div
            className="h-full animate-drain bg-brand-400"
            style={{
              animationDuration: `${AUTO_DISMISS_MS}ms`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          />
        </div>
      </div>
    </div>
  );
}
