/**
 * The operations answer to "what is going on right now".
 *
 * Everything here is counted from the rows the Schedule already loaded, so
 * Overview costs no extra Odoo request. Counts only — no invented percentages,
 * and a course whose capacity Odoo does not know is never treated as empty.
 */

import { Activity, AlertTriangle, CalendarClock, CalendarPlus, GaugeCircle, Users } from 'lucide-react';
import {
  CLOSED_STATUSES,
  departmentBreakdown,
  departmentLabel,
  overviewStats,
  statusCounts,
  todaysSessions,
} from '@shared/eventsSchedule';
import { type TrainingScheduleRow, ksaShortDate, ksaTime } from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { StatusChip } from './ScheduleCells';

function Kpi({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  tone?: 'neutral' | 'brand' | 'warn';
}) {
  return (
    <div className="rounded-2xl border border-surface-line bg-white p-3.5 shadow-[0_1px_2px_rgba(11,37,69,0.04)]">
      <div className="flex items-center gap-2">
        <span
          className={cx(
            'grid h-7 w-7 shrink-0 place-items-center rounded-lg',
            tone === 'brand' ? 'bg-brand-50 text-brand-600' : tone === 'warn' ? 'bg-status-warnBg text-accent-700' : 'bg-surface-sunken text-ink-muted'
          )}
        >
          {icon}
        </span>
        <span className="truncate text-[12px] font-semibold text-ink-muted">{label}</span>
      </div>
      <p className="mt-2 text-[24px] font-bold leading-none tabular-nums text-ink">{value.toLocaleString('en-US')}</p>
      <p className="mt-1 text-[11.5px] text-ink-faint">{hint}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-surface-line bg-white p-4 shadow-[0_1px_2px_rgba(11,37,69,0.04)]">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-bold text-ink">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] text-ink-muted">{children}</p>;
}

export function OverviewTab({
  rows,
  now,
  onOpen,
  onGoToday,
  onGoSchedule,
}: {
  rows: TrainingScheduleRow[];
  now: Date;
  onOpen: (id: number) => void;
  onGoToday: () => void;
  onGoSchedule: () => void;
}) {
  const stats = overviewStats(rows, now);
  const today = todaysSessions(rows, now).slice(0, 6);
  const statuses = statusCounts(rows);
  const departments = departmentBreakdown(rows.filter((row) => !CLOSED_STATUSES.includes(row.statusCanonical ?? '')));

  const soon = rows
    .filter(
      (row) =>
        row.statusCanonical === 'planned' &&
        row.startsAt &&
        row.startsAt >= now.toISOString() &&
        row.startsAt <= new Date(now.getTime() + 14 * 86_400_000).toISOString()
    )
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
    .slice(0, 6);

  const busiest = departments[0]?.count ?? 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Activity size={15} />} label="شغّالة" value={stats.active} hint="كورسات قيد التنفيذ" tone="brand" />
        <Kpi icon={<CalendarClock size={15} />} label="النهاردة" value={stats.todaySessions} hint="محاضرات النهاردة" tone="brand" />
        <Kpi icon={<CalendarPlus size={15} />} label="قرّبت تبدأ" value={stats.startingSoon} hint="خلال ٧ أيام" />
        <Kpi icon={<Users size={15} />} label="متدربين" value={stats.trainees} hint="حجوزات مؤكّدة نشطة" />
        <Kpi icon={<GaugeCircle size={15} />} label="قرّبت تكمل" value={stats.nearCapacity} hint="٨٥٪ من السعة أو أكتر" />
        <Kpi icon={<AlertTriangle size={15} />} label="محتاجة مراجعة" value={stats.needsAttention} hint="بيانات ناقصة" tone="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="محاضرات النهاردة"
          action={
            <button type="button" onClick={onGoToday} className="text-[12px] font-semibold text-brand-600 hover:underline">
              اعرض الكل
            </button>
          }
        >
          {today.length === 0 ? (
            <Quiet>مفيش محاضرات النهاردة في الفترة المحمّلة.</Quiet>
          ) : (
            <ul className="space-y-1">
              {today.map(({ row, session }) => (
                <li key={`${row.id}-${session.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-surface-bg"
                  >
                    <span className="w-14 shrink-0 text-[12.5px] font-bold tabular-nums text-brand-600">
                      {session.startsAt ? ksaTime(session.startsAt) : '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <bdi dir="auto" className="block truncate text-[13px] font-semibold text-ink">{row.courseName}</bdi>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {[row.instructor, `محاضرة ${session.number} / ${row.sessionsTotal}`].filter(Boolean).join(' • ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="كورسات قرّبت تبدأ"
          action={
            <button type="button" onClick={onGoSchedule} className="text-[12px] font-semibold text-brand-600 hover:underline">
              الجدول
            </button>
          }
        >
          {soon.length === 0 ? (
            <Quiet>مفيش كورسات بتبدأ خلال أسبوعين.</Quiet>
          ) : (
            <ul className="space-y-1">
              {soon.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-surface-bg"
                  >
                    <span className="w-14 shrink-0 text-[12px] font-semibold tabular-nums text-ink-muted">
                      {row.startsAt ? ksaShortDate(row.startsAt) : '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <bdi dir="auto" className="block truncate text-[13px] font-semibold text-ink">{row.courseName}</bdi>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {[row.instructor, departmentLabel(row.department)].filter(Boolean).join(' • ') || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-muted">
                      {row.traineeCount}
                      {row.capacity ? <span className="text-ink-faint">/{row.capacity}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="حالة الكورسات">
          {statuses.length === 0 ? (
            <Quiet>مفيش كورسات في الفترة دي.</Quiet>
          ) : (
            <ul className="space-y-2">
              {statuses.map(({ status, label, count }) => (
                <li key={status} className="flex items-center justify-between gap-3">
                  <StatusChip status={status as never} stage={label} />
                  <span className="text-[13px] font-bold tabular-nums text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="الأقسام">
          {departments.length === 0 ? (
            <Quiet>مفيش كورسات نشطة.</Quiet>
          ) : (
            <ul className="space-y-2">
              {departments.slice(0, 7).map(({ department, count }) => (
                <li key={department} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-[12.5px] text-ink-muted">
                    {department === 'Unclassified' ? 'من غير قسم' : departmentLabel(department)}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <span className="block h-full rounded-full bg-brand-400" style={{ width: `${Math.max(4, (count / busiest) * 100)}%` }} />
                  </span>
                  <span className="w-7 shrink-0 text-end text-[12.5px] font-bold tabular-nums text-ink">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
