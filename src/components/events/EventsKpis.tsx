/**
 * The five numbers the page opens with, each in its own colour so the row
 * reads at a glance rather than as five identical boxes.
 *
 * Counted from the rows the schedule already loaded, so they cost no Odoo
 * request of their own, and counted — never estimated. The small line under
 * each number is counted too: there is no history here to compute a trend
 * from, so none is shown. "Near capacity" is the same test as the smart
 * filter of that name, so the number is always the number of cards it shows.
 */

import { Activity, CalendarClock, CalendarPlus, GaugeCircle, Users } from 'lucide-react';
import { CLOSED_STATUSES, ksaDay, overviewStats } from '@shared/eventsSchedule';
import type { TrainingScheduleRow } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { TONE, type Tone } from './tones';

function Kpi({ tone, icon, value, label, hint }: { tone: Tone; icon: React.ReactNode; value: number; label: string; hint: string }) {
  const t = TONE[tone];
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-16px_rgba(15,23,42,0.2)]',
        t.wash,
        t.border
      )}
    >
      <span aria-hidden className={cx('absolute -end-6 -top-6 h-20 w-20 rounded-full opacity-[0.12]', t.dot)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[28px] font-black leading-none tabular-nums tracking-tight text-slate-900">{value.toLocaleString('en-US')}</p>
          <p className="mt-2 text-[13px] font-bold text-slate-700">{label}</p>
          <p className={cx('mt-0.5 text-[11.5px] font-semibold', t.text)}>{hint}</p>
        </div>
        <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', t.icon)}>{icon}</span>
      </div>
    </div>
  );
}

export function EventsKpis({ rows, now }: { rows: TrainingScheduleRow[] | null; now: Date }) {
  if (!rows) return <EventsKpisSkeleton />;
  const stats = overviewStats(rows, now);
  const today = ksaDay(now.toISOString());
  const coursesToday = rows.filter((row) => row.sessions.some((s) => s.startsAt && ksaDay(s.startsAt) === today)).length;
  const open = rows.filter((row) => !CLOSED_STATUSES.includes(row.statusCanonical ?? '')).length;

  return (
    <section aria-label="أرقام سريعة" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <Kpi tone="blue" icon={<Activity size={20} />} value={stats.active} label="كورسات شغّالة" hint={`من ${open} كورس مفتوح`} />
      <Kpi tone="green" icon={<CalendarClock size={20} />} value={stats.todaySessions} label="محاضرات النهاردة" hint={`في ${coursesToday} كورس`} />
      <Kpi tone="amber" icon={<CalendarPlus size={20} />} value={stats.startingSoon} label="بتبدأ قريب" hint="خلال ٧ أيام" />
      <Kpi tone="violet" icon={<Users size={20} />} value={stats.trainees} label="متدربين نشطين" hint="حجوزات مؤكّدة" />
      <Kpi tone="coral" icon={<GaugeCircle size={20} />} value={stats.nearCapacity} label="قرّبت تكمل" hint="٨٠٪ من السعة أو أكتر" />
    </section>
  );
}

export function EventsKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid flex-1 gap-2">
            <span className="skeleton h-7 w-14 rounded" />
            <span className="skeleton h-3.5 w-24 rounded" />
            <span className="skeleton h-3 w-20 rounded" />
          </div>
          <span className="skeleton h-11 w-11 shrink-0 rounded-xl" />
        </div>
      ))}
    </div>
  );
}
