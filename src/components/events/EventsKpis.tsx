/**
 * The five numbers the page opens with.
 *
 * Counted from the rows the schedule already loaded, so they cost no Odoo
 * request of their own, and counted — never estimated. "Near capacity" is the
 * same test as the smart filter of that name, so the number here is always the
 * number of cards that filter shows.
 */

import { Activity, CalendarClock, CalendarPlus, GaugeCircle, Users } from 'lucide-react';
import { overviewStats } from '@shared/eventsSchedule';
import type { TrainingScheduleRow } from '../../lib/eventsSchedule';

function Kpi({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-surface-line bg-white px-4 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-[24px] font-extrabold leading-none tabular-nums text-ink">{value.toLocaleString('en-US')}</p>
        <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-ink-muted">{label}</p>
      </div>
    </div>
  );
}

export function EventsKpis({ rows, now }: { rows: TrainingScheduleRow[] | null; now: Date }) {
  if (!rows) return <EventsKpisSkeleton />;
  const stats = overviewStats(rows, now);
  return (
    <section aria-label="أرقام سريعة" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi icon={<Activity size={18} />} value={stats.active} label="كورسات شغّالة" />
      <Kpi icon={<CalendarClock size={18} />} value={stats.todaySessions} label="محاضرات النهاردة" />
      <Kpi icon={<CalendarPlus size={18} />} value={stats.startingSoon} label="بتبدأ خلال أسبوع" />
      <Kpi icon={<Users size={18} />} value={stats.trainees} label="متدربين نشطين" />
      <Kpi icon={<GaugeCircle size={18} />} value={stats.nearCapacity} label="قرّبت تكمل" />
    </section>
  );
}

export function EventsKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[14px] border border-surface-line bg-white px-4 py-3.5">
          <span className="skeleton h-10 w-10 shrink-0 rounded-xl" />
          <div className="grid flex-1 gap-2">
            <span className="skeleton h-5 w-12 rounded" />
            <span className="skeleton h-3 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
