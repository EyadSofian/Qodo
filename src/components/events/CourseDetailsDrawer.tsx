/**
 * The details panel for one course.
 *
 * On a wide screen it docks beside the course cards — the list stays visible
 * and clickable, and choosing another card swaps what the panel shows. Below
 * that it becomes a sheet over the page (the whole screen on a phone), and
 * then it is a proper dialog: focus moves in, Tab stays inside, Escape closes,
 * and focus returns to whatever opened it.
 *
 * Read-only like the rest of the module; "افتح في أودو" is how anything changes.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ExternalLink, X } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { agoLabel, cairoTime, fetchEventDetail, type DetailResponse } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { DetailsPane, OverviewPane, SessionsPane, TraineesPane, type DetailsTab } from './CourseDetailsTabs';
import { StatusChip } from './EventStatusBadge';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function useDetail(id: number | null, version: number) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    setData(null);
    setError('');
    fetchEventDetail(id)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')));
    return () => {
      cancelled = true;
    };
  }, [id, version]);
  return { data, error };
}

const TABS: Array<{ key: DetailsTab; label: string }> = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'sessions', label: 'المحاضرات' },
  { key: 'trainees', label: 'المتدربين' },
  { key: 'details', label: 'التفاصيل' },
];

function Panel({
  id,
  version,
  onClose,
  titleId,
  autoFocusClose,
}: {
  id: number;
  version: number;
  onClose: () => void;
  titleId: string;
  autoFocusClose?: boolean;
}) {
  const { data, error } = useDetail(id, version);
  const [tab, setTab] = useState<DetailsTab>('overview');
  const body = useRef<HTMLDivElement>(null);
  const course = data?.course;
  const now = new Date();

  useEffect(() => {
    setTab('overview');
  }, [id]);
  // A block body on purpose: Chromium's scrollTo() now returns a Promise, and an
  // arrow that returned it would hand React a Promise as the effect's cleanup.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [tab, id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-5 pt-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="flex min-w-0 text-[20px] font-extrabold leading-snug text-ink" title={course?.courseName}>
              <span dir="auto" className="min-w-0 truncate">
                {course?.courseName ?? (error ? 'الكورس' : 'جارٍ التحميل…')}
              </span>
            </h2>
            {course?.courseCode && (
              <p className="mt-0.5 text-[13px] text-ink-muted">
                كود <bdi className="font-mono font-semibold text-ink">{course.courseCode}</bdi>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {course && <StatusChip status={course.statusCanonical} stage={course.status} size="md" />}
            <button
              type="button"
              data-autofocus={autoFocusClose ? true : undefined}
              onClick={onClose}
              aria-label="اقفل التفاصيل"
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav role="tablist" aria-label="أقسام تفاصيل الكورس" className="mt-4 flex gap-5 border-b border-surface-line">
          {TABS.map((item) => {
            const on = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={on}
                disabled={!course}
                onClick={() => setTab(item.key)}
                className={cx(
                  '-mb-px border-b-2 pb-2.5 text-[13px] font-semibold transition-colors disabled:opacity-40',
                  on ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink'
                )}
              >
                {item.label}
                {item.key === 'sessions' && course ? <span className="ms-1 tabular-nums text-ink-faint">({course.sessionsTotal})</span> : null}
              </button>
            );
          })}
        </nav>
      </header>

      <div ref={body} role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {error && (
          <p className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad">
            <AlertCircle size={16} />
            {error}
          </p>
        )}
        {!course && !error && <PanelSkeleton />}
        {course && (
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
            {tab === 'overview' && <OverviewPane course={course} now={now} onTab={setTab} />}
            {tab === 'sessions' && <SessionsPane course={course} now={now} />}
            {tab === 'trainees' && <TraineesPane course={course} />}
            {tab === 'details' && <DetailsPane course={course} />}
          </motion.div>
        )}
      </div>

      {data && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-surface-line px-5 py-3 pb-safe sm:pb-3">
          <p className="min-w-0 text-[11.5px] leading-relaxed text-ink-faint">
            المصدر: أودو • آخر مزامنة {cairoTime(data.fetchedAt)}
            {data.stale && <span className="font-semibold text-accent-700"> • آخر مزامنة ناجحة {agoLabel(data.fetchedAt)}</span>}
          </p>
          {data.odooUrl && (
            <a href={data.odooUrl} target="_blank" rel="noreferrer noopener" className="btn-navy btn-sm shrink-0 gap-1.5">
              افتح في أودو
              <ExternalLink size={14} />
            </a>
          )}
        </footer>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton h-14 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="skeleton h-16 rounded-xl" />
        <span className="skeleton h-16 rounded-xl" />
      </div>
      <span className="skeleton h-16 rounded-xl" />
      <span className="skeleton h-24 rounded-xl" />
      <div className="grid grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Beside the cards, on wide screens. Not modal: the list stays usable. */
export function DockedCourseDetails({ id, version, onClose }: { id: number | null; version: number; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    if (id === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  return (
    <AnimatePresence initial={false}>
      {id !== null && (
        <motion.aside
          key="docked"
          aria-labelledby={titleId}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="sticky top-20 h-[calc(100dvh-6rem)] w-[35%] min-w-[400px] max-w-[580px] shrink-0 overflow-hidden rounded-[16px] rtl:order-first border border-surface-line bg-white shadow-[0_8px_30px_rgba(11,37,69,0.08)]"
        >
          <Panel id={id} version={version} onClose={onClose} titleId={titleId} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** Over the page, below the docking width; the whole screen on a phone. */
export function OverlayCourseDetails({ id, version, onClose }: { id: number | null; version: number; onClose: () => void }) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (id === null) return;
    opener.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => sheet.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 30);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !sheet.current) return;
      const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus?.();
    };
  }, [id, onClose]);

  return createPortal(
    <AnimatePresence>
      {id !== null && (
        // The sheet sits on the physical right, as in the approved layout; its content is RTL.
        <div key="overlay" dir="ltr" className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            className="absolute inset-0 bg-navy/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            dir="rtl"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="relative z-10 flex h-full w-full flex-col bg-white shadow-panel sm:max-w-[600px] sm:rounded-l-[20px]"
          >
            <Panel id={id} version={version} onClose={onClose} titleId={titleId} autoFocusClose />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
