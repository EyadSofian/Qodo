/**
 * The "here is your day" modal, shown once per sign-in.
 *
 * It exists because the badge answers *how many* and nothing answers *which
 * kind* — three open tasks with one overdue is a different morning from three
 * open tasks due next week. Sessions last twelve hours, so "once per session"
 * is genuinely once a day for most people; the marker is keyed to the session
 * cookie's lifetime via sessionStorage, which clears when the tab does.
 *
 * It never appears with nothing to say. A modal that opens to tell you there is
 * no news is a modal people learn to dismiss without reading.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, ClipboardCheck, Inbox, ListChecks } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { PERMISSIONS } from '@shared/permissions';
import { Modal } from './ui';
import { cx } from '../lib/utils';

const SEEN_KEY = 'engosoft.summary.seen';

export function TaskSummaryPopup() {
  const { user, can } = useAuth();
  const { taskCounts, loading } = useWorkspace();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

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

  const rows = [
    {
      id: 'open' as const,
      value: taskCounts.mine,
      icon: ListChecks,
      tone: 'text-brand-500 bg-brand-50',
    },
    {
      id: 'overdue' as const,
      value: taskCounts.overdue,
      icon: AlertTriangle,
      tone: 'text-status-bad bg-status-badBg',
    },
    {
      id: 'dueToday' as const,
      value: taskCounts.dueToday,
      icon: CalendarClock,
      tone: 'text-accent-600 bg-status-warnBg',
    },
    {
      id: 'unanswered' as const,
      value: taskCounts.unanswered,
      icon: Inbox,
      tone: 'text-ink bg-surface-sunken',
    },
    {
      id: 'awaitingMyReview' as const,
      value: taskCounts.awaitingMyReview,
      icon: ClipboardCheck,
      tone: 'text-status-ok bg-status-okBg',
    },
  ].filter((row) => row.value > 0);

  const close = () => setOpen(false);
  const hour = new Date().getHours();

  return (
    <Modal
      open={open}
      onClose={close}
      width="sm"
      title={hour < 12 ? t('summary.title') : t('summary.titleEvening')}
      footer={
        <>
          <button type="button" onClick={close} className="btn-ghost btn-sm">
            {t('summary.dismiss')}
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              navigate('/tasks');
            }}
            className="btn-primary btn-sm"
          >
            {t('summary.openBoard')}
          </button>
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[13.5px] text-ink-muted">{t('summary.clear')}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map(({ id, value, icon: Icon, tone }) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded-xl border border-surface-line px-3 py-2.5"
            >
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tone)}>
                <Icon size={17} />
              </span>
              <span className="flex-1 text-[13.5px] font-semibold text-ink">
                {t(`summary.${id}` as StringKey)}
              </span>
              <span className="text-[19px] font-extrabold tabular-nums text-ink">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
