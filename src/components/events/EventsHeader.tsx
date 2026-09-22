/**
 * Title, freshness, sync — and the four sections of the module as one quiet
 * underline row, so the header never grows into a hero.
 */

import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { agoLabel, cairoTime, type ScheduleResponse } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { Spinner } from '../ui';

export type EventsSection = 'schedule' | 'today' | 'analytics' | 'archive';

const SECTIONS: Array<{ key: EventsSection; label: string }> = [
  { key: 'schedule', label: 'الكورسات' },
  { key: 'today', label: 'النهاردة' },
  { key: 'analytics', label: 'التحليل' },
  { key: 'archive', label: 'الأرشيف' },
];

/** "مباشر من أودو · آخر مزامنة 4:18 م" — or, plainly, that it is not live. */
function Freshness({ schedule, loading }: { schedule: ScheduleResponse | null; loading: boolean }) {
  if (loading || !schedule) return <span className="skeleton hidden h-9 w-52 rounded-xl sm:block" aria-hidden />;
  const stale = Boolean(schedule.stale);
  return (
    <div
      role="status"
      className={cx(
        'hidden items-center gap-2.5 rounded-xl border px-3 py-1.5 sm:flex',
        stale ? 'border-accent-100 bg-status-warnBg' : 'border-surface-line bg-white'
      )}
    >
      {stale ? <AlertCircle size={16} className="text-accent-700" /> : <CheckCircle2 size={16} className="text-status-ok" />}
      <div className="leading-tight">
        <p className={cx('text-[12.5px] font-bold', stale ? 'text-accent-700' : 'text-ink')}>{stale ? 'آخر مزامنة ناجحة' : 'مباشر من أودو'}</p>
        <p className="text-[11.5px] text-ink-muted">
          {stale ? agoLabel(schedule.fetchedAt) : `آخر مزامنة ${cairoTime(schedule.fetchedAt)}`}
        </p>
      </div>
    </div>
  );
}

export function EventsHeader({
  section,
  onSection,
  schedule,
  loading,
  ready,
  syncing,
  onSync,
}: {
  section: EventsSection;
  onSection: (section: EventsSection) => void;
  schedule: ScheduleResponse | null;
  loading: boolean;
  ready: boolean;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-black leading-tight text-ink sm:text-[30px]">إيفينتات التدريب</h1>
          <p className="mt-1 text-[14px] text-ink-muted">تابع كل برامج التدريب الشغّالة والجاية — مقروءة مباشرة من أودو.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {ready && <Freshness schedule={schedule} loading={loading && !schedule} />}
          <button type="button" onClick={onSync} disabled={!ready || syncing} className="btn-navy h-10 gap-2 rounded-xl px-4 text-[13px]">
            {syncing ? <Spinner size={15} /> : <RefreshCw size={15} />}
            {syncing ? 'بنزامن…' : 'زامن مع أودو'}
          </button>
        </div>
      </div>

      {ready && (
        <nav role="tablist" aria-label="أقسام الإيفينتات" className="no-scrollbar mt-5 flex gap-6 overflow-x-auto border-b border-surface-line">
          {SECTIONS.map((item) => {
            const on = item.key === section;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onSection(item.key)}
                className={cx(
                  '-mb-px shrink-0 border-b-2 pb-3 text-[14px] font-semibold transition-colors',
                  on ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink'
                )}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
