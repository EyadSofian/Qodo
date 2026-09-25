/**
 * A recruitment alert as a toast. It arrives from just above its place
 * (opacity, 8px, 0.98 → 1 in 240ms), waits seven seconds — longer while the
 * pointer or focus is on it — then folds into the alert centre, where it
 * stays until the problem it describes is gone.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { useHRText } from '../../format';
import { useHR } from '../../shell/HRContext';
import { useMotion } from '../../ui/motion';
import { SEVERITY_TONE, TONE } from '../../ui/tones';
import type { Alert, Severity } from '../../types';

const LIFETIME_MS = 7000;

export const SEVERITY_ICON: Record<Severity, typeof Info> = {
  critical: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

export function alertActionLabel(action: string, t: (ar: string, en: string) => string) {
  switch (action) {
    case 'view_workload': return t('عرض الحمل', 'View workload');
    case 'reassign': return t('إعادة إسناد', 'Reassign');
    case 'open_job': return t('فتح الوظيفة', 'Open job');
    case 'extend': return t('مد المهلة', 'Extend');
    case 'link_odoo': return t('ربط Odoo', 'Link Odoo');
    case 'open_rewards': return t('فتح المكافآت', 'Open rewards');
    default: return t('فتح', 'Open');
  }
}

export function alertActionTarget(alert: Alert, action: string) {
  if (action === 'reassign') {
    return alert.subject.kind === 'job'
      ? `/hr/recruitment/requests/${encodeURIComponent(alert.subject.id)}?action=assign`
      : `/hr/recruitment/capacity?recruiter=${encodeURIComponent(alert.subject.code)}&action=reassign`;
  }
  if (action === 'extend') return `${alert.link}?action=extend`;
  return alert.link;
}

function Toast({ alert, onDone }: { alert: Alert; onDone: () => void }) {
  const { pick, t } = useHRText();
  const navigate = useNavigate();
  const motionPresets = useMotion();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(LIFETIME_MS);
  const started = useRef(Date.now());
  // The parent passes a fresh callback each render; the timer must not restart with it.
  const done = useRef(onDone);
  done.current = onDone;
  const tone = SEVERITY_TONE[alert.severity];
  const Icon = SEVERITY_ICON[alert.severity];

  useEffect(() => {
    if (paused) {
      remaining.current -= Date.now() - started.current;
      return undefined;
    }
    started.current = Date.now();
    const timer = window.setTimeout(() => done.current(), Math.max(800, remaining.current));
    return () => window.clearTimeout(timer);
  }, [paused]);

  return (
    <motion.div
      layout={!motionPresets.reduce}
      {...motionPresets.pop}
      role={alert.severity === 'critical' ? 'alert' : 'status'}
      className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl border border-[#E6ECF3] bg-white shadow-[0_18px_44px_-18px_rgba(11,37,69,0.45)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex gap-3 p-4">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', TONE[tone].bg, TONE[tone].text)}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13.5px] font-bold text-navy">{pick(alert.title)}</p>
            <button type="button" onClick={onDone} className="-me-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-navy" aria-label={t('إغلاق التنبيه', 'Dismiss alert')}>
              <X size={15} />
            </button>
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-[#5A6C82]">{pick(alert.body)}</p>
          {alert.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {alert.actions.slice(0, 2).map((action, index) => (
                <button
                  key={action}
                  type="button"
                  className={cx('rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors', index === 0 ? 'bg-navy text-white hover:bg-brand-800' : 'border border-[#E6ECF3] text-navy hover:bg-surface-sunken')}
                  onClick={() => {
                    navigate(alertActionTarget(alert, action));
                    onDone();
                  }}
                >
                  {alertActionLabel(action, t)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {!motionPresets.reduce && (
        // The same drain keyframes the workspace popup uses, paused with the toast.
        <div
          className={cx('h-0.5', TONE[tone].bar)}
          style={{ animation: `drain ${LIFETIME_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}

export function RecruitmentAlertToasts() {
  const { alertCenter } = useHR();
  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--bottomnav-h)+var(--sab)+0.75rem)] z-[66] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:end-6 sm:items-end">
      <AnimatePresence initial={false}>
        {alertCenter.toasts.map((alert) => (
          <Toast key={`${alert.id}:${alert.fingerprint}`} alert={alert} onDone={() => alertCenter.dismissToast(alert.id)} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
