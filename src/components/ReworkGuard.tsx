import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { Spinner, useToast } from './ui';

/**
 * Rework is an action, not inbox noise. The employee cannot dismiss this gate:
 * opening the queue acknowledges the current return cycle on the server, then
 * deep-links to the first returned task. A later return is a new numbered cycle
 * and raises the gate again on every device.
 */
export function ReworkGuard() {
  const { user } = useAuth();
  const { taskCounts, reloadTaskCounts } = useWorkspace();
  const { t, lang } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const tasks = taskCounts.reworkTasks;

  useEffect(() => {
    if (!user || tasks.length === 0) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Escape') return;
      event.preventDefault();
      openButton.current?.focus();
    };
    document.addEventListener('keydown', keepFocusInside);
    openButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', keepFocusInside);
    };
  }, [user, tasks.length]);

  if (!user || tasks.length === 0) return null;

  const openQueue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/tasks/rework/acknowledge');
      const first = tasks[0];
      await reloadTaskCounts();
      navigate(`/tasks?rework=1&task=${encodeURIComponent(first.id)}`);
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-navy/65 p-4 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rework-guard-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-panel ring-1 ring-white/20 animate-fade-up"
      >
        <header className="bg-navy px-5 py-5 text-white">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-status-bad text-white">
            <ShieldAlert size={23} />
          </span>
          <h2 id="rework-guard-title" className="text-[18px] font-black">
            {t('reworkGuard.title')}
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">
            {t('reworkGuard.hint')}
          </p>
        </header>

        <div className="max-h-[42dvh] space-y-2 overflow-y-auto p-4">
          {tasks.map((task) => (
            <article key={task.id} className="flex items-center gap-3 rounded-2xl bg-status-badBg p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-status-bad shadow-sm">
                <RotateCcw size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-extrabold text-ink">{task.title}</p>
                <p className="mt-0.5 text-[11.5px] font-semibold text-status-bad">
                  {t('reworkGuard.penalty', { percent: task.scorePenaltyPercent })}
                </p>
              </div>
            </article>
          ))}
        </div>

        <footer className="border-t border-surface-line p-4">
          <button
            ref={openButton}
            type="button"
            onClick={openQueue}
            disabled={busy}
            className="btn-primary w-full gap-2"
          >
            {busy ? <Spinner size={16} /> : <RotateCcw size={16} />}
            {t('reworkGuard.open')}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
