/**
 * The page's one dark surface — title, freshness, sync, and the module's four
 * sections — so the dashboard has an anchor instead of being pale from top to
 * bottom. Compact on purpose: a band, not a hero.
 */

import { AlertCircle, RefreshCw } from 'lucide-react';
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
  if (loading || !schedule) return <span className="hidden h-11 w-52 animate-pulse rounded-xl bg-white/10 sm:block" aria-hidden />;
  const stale = Boolean(schedule.stale);
  return (
    <div
      role="status"
      className={cx(
        'hidden items-center gap-2.5 rounded-xl border px-3.5 py-2 backdrop-blur-md sm:flex',
        stale ? 'border-amber-300/40 bg-amber-400/15' : 'border-white/15 bg-white/10'
      )}
    >
      {stale ? (
        <AlertCircle size={17} className="text-amber-300" />
      ) : (
        <span aria-hidden className="relative grid h-2.5 w-2.5 place-items-center">
          <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
      )}
      <div className="leading-tight">
        <p className={cx('text-[12.5px] font-bold', stale ? 'text-amber-200' : 'text-white')}>{stale ? 'آخر مزامنة ناجحة' : 'مباشر من أودو'}</p>
        <p className="text-[11.5px] text-blue-100/80">{stale ? agoLabel(schedule.fetchedAt) : `آخر مزامنة ${cairoTime(schedule.fetchedAt)}`}</p>
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
    <header className="relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-l from-navy via-blue-900 to-blue-700 px-5 pt-5 text-white shadow-[0_20px_50px_-20px_rgba(15,23,42,0.55)] sm:px-7 sm:pt-6">
      {/* Light that the glass pieces on this band have something to frost. */}
      <span aria-hidden className="absolute -top-24 start-[18%] h-64 w-64 rounded-full bg-blue-400/30 blur-3xl" />
      <span aria-hidden className="absolute -bottom-28 end-[6%] h-64 w-64 rounded-full bg-violet-500/30 blur-3xl" />
      <span aria-hidden className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-wide text-blue-200">الإيفينتات</p>
          <h1 className="mt-1 text-[28px] font-black leading-tight sm:text-[32px]">إيفينتات التدريب</h1>
          <p className="mt-1 text-[14px] text-blue-100/80">تابع كل برامج التدريب الشغّالة والجاية — مقروءة مباشرة من أودو.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {ready && <Freshness schedule={schedule} loading={loading && !schedule} />}
          <button
            type="button"
            onClick={onSync}
            disabled={!ready || syncing}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-[13.5px] font-bold text-blue-900 shadow-lg shadow-black/20 transition hover:bg-blue-50 disabled:opacity-60"
          >
            {syncing ? <Spinner size={15} /> : <RefreshCw size={16} />}
            {syncing ? 'بنزامن…' : 'زامن مع أودو'}
          </button>
        </div>
      </div>

      {ready ? (
        <nav role="tablist" aria-label="أقسام الإيفينتات" className="no-scrollbar relative mt-5 flex gap-1 overflow-x-auto">
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
                  'relative shrink-0 rounded-t-xl px-4 pb-3 pt-2.5 text-[14px] font-bold transition-colors',
                  on ? 'bg-white/10 text-white' : 'text-blue-100/70 hover:text-white'
                )}
              >
                {item.label}
                {on && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-gradient-to-l from-sky-300 to-violet-300" />}
              </button>
            );
          })}
        </nav>
      ) : (
        <div className="h-5" />
      )}
    </header>
  );
}
