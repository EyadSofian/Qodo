/**
 * One person's attendance on their HR profile: today at the device, the
 * period's figures with Odoo leave taken out of absence, a calendar of days
 * and the detail of any day — first and last punch, hours, lateness, the
 * leave that covered it.
 */

import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, Clock3, DoorOpen, Fingerprint, LogIn, LogOut, Plane } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { date as formatDate, num, pct, useHRText } from '../format';
import { Card, SectionTitle } from '../ui/primitives';
import { EmptyBlock, ErrorBlock, Skeleton } from '../ui/states';
import { AttendanceCalendar, DayDetail, Fact, Legend, RangePicker, StatusPill } from './components';
import { STATUS, WEEKDAY, clock, clockText, hoursText, minutesText, presetRange, rangeQuery, type DateRange, type EmployeeAttendanceData } from './model';

export function useEmployeeAttendance(code: string, range: DateRange, enabled = true) {
  return useHRQuery<EmployeeAttendanceData>(enabled && code ? hrApi.attendance.employee(code, rangeQuery(range)) : null, { refreshMs: 120_000 });
}

/** Today in one line for the profile hero: "In since 11:05", "Absent", "On leave". */
export function TodayChip({ data }: { data: EmployeeAttendanceData | null }) {
  const { t, lang, pick } = useHRText();
  const today = data?.found ? data.today : null;
  if (!today) return null;
  const status = today.effective;
  let text = pick(STATUS[status]?.label);
  if (today.inOffice && today.first) text = t(`داخل الآن منذ ${clockText(today.first, lang)}`, `In since ${clockText(today.first, lang)}`);
  else if (today.first && today.last) text = t(`حضر ${clockText(today.first, lang)} · انصرف ${clockText(today.last, lang)}`, `In ${clockText(today.first, lang)} · out ${clockText(today.last, lang)}`);
  else if (today.timeOff) text = `${pick(STATUS[status]?.label)} · ${today.timeOff.type}`;
  const meta = STATUS[status] ?? STATUS.none;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11.5px] font-bold" style={{ color: `rgb(${meta.color})` }}>
      <Fingerprint size={12} aria-hidden="true" />
      {text}
      {today.late > 0 && status === 'late' && <span className="tabular-nums">· +{minutesText(today.late, lang)}</span>}
    </span>
  );
}

/** Today's card for the profile overview. */
export function AttendanceToday({ data, loading, onOpen }: { data: EmployeeAttendanceData | null; loading: boolean; onOpen?: () => void }) {
  const { t, lang } = useHRText();
  if (loading && !data) return <Card><Skeleton className="h-28" /></Card>;
  if (!data?.connected) return null;
  if (!data.found) {
    return (
      <Card>
        <SectionTitle title={<span className="flex items-center gap-2"><Fingerprint size={16} className="text-[rgb(var(--hr-a1))]" aria-hidden="true" />{t('الحضور اليوم', 'Today')}</span>} />
        <p className="text-[12.5px] leading-6 text-slate-600">{t('لا توجد بصمة لهذا الكود في أجهزة الحضور.', 'The fingerprint devices have no record for this code.')}</p>
      </Card>
    );
  }
  const today = data.today;
  const summary = data.employee!;
  return (
    <Card>
      <SectionTitle
        title={<span className="flex items-center gap-2"><Fingerprint size={16} className="text-[rgb(var(--hr-a1))]" aria-hidden="true" />{t('الحضور اليوم', 'Today')}</span>}
        hint={data.range?.data_until ? t(`آخر مزامنة ${formatDate(data.range.data_until.slice(0, 10), lang)} ${clockText(data.range.data_until.slice(11, 16), lang)}`, `Synced ${formatDate(data.range.data_until.slice(0, 10), lang)} ${clockText(data.range.data_until.slice(11, 16), lang)}`) : undefined}
        action={onOpen ? <button type="button" className="text-[12.5px] font-semibold text-[rgb(var(--hr-a1))] hover:underline" onClick={onOpen}>{t('كل الأيام', 'All days')}</button> : null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={today?.effective ?? 'none'} />
        {summary.in_office && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11.5px] font-bold text-green-800 ring-1 ring-green-200"><DoorOpen size={12} aria-hidden="true" />{t('داخل المكتب الآن', 'In the office now')}</span>}
        {today?.timeOff && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-[11.5px] font-bold text-violet-800 ring-1 ring-violet-200"><Plane size={12} aria-hidden="true" />{today.timeOff.type}</span>}
        <span className="text-[12px] text-slate-500">{t('الوردية', 'Shift')} <b className="tabular-nums text-slate-700">{summary.effective_schedule === 'flexible' ? t('مرنة', 'flexible') : summary.effective_schedule === 'exempt' ? t('غير ملزم', 'exempt') : summary.shift.split('–').map((part) => clockText(part, lang)).join(' – ')}</b></span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TodayFact icon={LogIn} label={t('أول بصمة', 'First in')} value={clockText(today?.first, lang)} />
        <TodayFact icon={LogOut} label={t('آخر بصمة', 'Last out')} value={clockText(today?.last, lang)} />
        <TodayFact icon={Clock3} label={t('ساعات اليوم', 'Hours today')} value={today?.worked ? minutesText(today.worked, lang) : '—'} />
        <TodayFact icon={CalendarCheck2} label={t('التأخير', 'Late by')} value={today?.late ? minutesText(today.late, lang) : '—'} warn={Boolean(today?.late)} />
      </dl>
    </Card>
  );
}

function TodayFact({ icon: Icon, label, value, warn = false }: { icon: typeof LogIn; label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70">
      <dt className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500"><Icon size={13} aria-hidden="true" />{label}</dt>
      <dd className={cx('mt-0.5 text-[16px] font-extrabold tabular-nums', warn ? 'text-amber-700' : 'text-navy')}>{value}</dd>
    </div>
  );
}

/** Four headline figures for the period, for the profile overview. */
export function AttendanceFigures({ data }: { data: EmployeeAttendanceData | null }) {
  const { t, lang } = useHRText();
  if (!data?.found || !data.employee) return null;
  const e = data.employee;
  const rate = e.adjusted_attendance_rate ?? e.attendance_rate;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure label={t('نسبة الحضور', 'Attendance')} value={rate === null || rate === undefined ? '—' : pct(Math.round(rate * 100), lang)} hint={t(`${num(e.present_days, lang)} من ${num(e.adjusted_expected_days ?? e.expected_days, lang)} يوم`, `${num(e.present_days, lang)} of ${num(e.adjusted_expected_days ?? e.expected_days, lang)} days`)} tone={rate !== null && rate !== undefined && rate < 0.85 ? 'bad' : 'good'} />
      <Figure label={t('غياب بدون إذن', 'Unexcused absence')} value={num(e.unexcusedAbsences ?? e.absent_days, lang)} hint={t(`${num(e.leaveDays ?? 0, lang)} يوم إجازة معتمدة`, `${num(e.leaveDays ?? 0, lang)} approved leave days`)} tone={(e.unexcusedAbsences ?? 0) > 0 ? 'bad' : undefined} />
      <Figure label={t('أيام التأخير', 'Late days')} value={num(e.late_days, lang)} hint={e.late_minutes ? t(`إجمالي ${minutesText(e.late_minutes, lang)}`, `${minutesText(e.late_minutes, lang)} in all`) : undefined} tone={e.late_days ? 'warn' : undefined} />
      <Figure label={t('متوسط الوصول', 'Average arrival')} value={clock(e.avg_arrival, lang)} hint={t(`متوسط اليوم ${hoursText(e.avg_hours, lang)}`, `Average day ${hoursText(e.avg_hours, lang)}`)} />
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="hr-glass min-w-0 rounded-2xl px-4 py-3.5">
      <p className="text-[12px] font-semibold text-slate-600">{label}</p>
      <p className={cx('mt-1 text-[24px] font-extrabold leading-8 tabular-nums', tone === 'bad' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-700' : 'text-navy')}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11.5px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** The attendance tab: range, figures, calendar, the chosen day, weekdays and devices. */
export function AttendancePanel({ code }: { code: string }) {
  const { t, lang, pick } = useHRText();
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const { data, error, loading, reload } = useEmployeeAttendance(code, range);
  const [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => (data?.days ?? []).filter((day) => !['future'].includes(day.status)), [data]);
  useEffect(() => {
    // Open on the latest day with something to say.
    const latest = [...days].reverse().find((day) => day.count > 0 || day.effective === 'absent' || day.timeOff);
    setSelected(latest?.date ?? null);
  }, [days]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return <Card><Skeleton className="h-64" /></Card>;
  if (!data.connected) return <EmptyBlock icon={<Fingerprint size={24} />} title={t('جهاز البصمة غير مربوط بعد', 'The fingerprint service is not connected yet')} />;
  if (!data.found) return <EmptyBlock icon={<Fingerprint size={24} />} title={t('لا توجد بصمة لهذا الكود', 'No fingerprint record for this code')} body={t('كود البصمة هو كود الموظف في HR (رقم التسجيل في Odoo). تأكد أن الكود مسجّل على الجهاز.', 'The fingerprint code is the HR employee code (Odoo registration number). Check it is enrolled on the device.')} />;

  const e = data.employee!;
  const chosen = days.find((day) => day.date === selected) ?? null;
  const weekday = data.weekdayArrival ?? [];
  const known = weekday.filter((value): value is number => value !== null);
  const earliest = Math.min(...known, data.shift?.start ?? 600) - 20;
  const latest = Math.max(...known, (data.shift?.start ?? 600) + 30) + 10;
  const rate = e.adjusted_attendance_rate ?? e.attendance_rate;
  return (
    <div className={cx('space-y-5', loading && 'opacity-80 transition-opacity')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={range} onChange={setRange} presets={['week', 'month', 'lastMonth', 'last30']} />
        <p className="text-[12px] text-slate-500">{formatDate(data.range?.from, lang)} – {formatDate(data.range?.to, lang)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Figure label={t('نسبة الحضور', 'Attendance')} value={rate === null || rate === undefined ? '—' : pct(Math.round(rate * 100), lang)} hint={t('بعد خصم الإجازات', 'leave taken out')} tone={rate !== null && rate !== undefined && rate < 0.85 ? 'bad' : 'good'} />
        <Figure label={t('أيام الحضور', 'Days present')} value={num(e.present_days, lang)} hint={t(`من ${num(e.adjusted_expected_days ?? e.expected_days, lang)} يوم عمل`, `of ${num(e.adjusted_expected_days ?? e.expected_days, lang)} workdays`)} />
        <Figure label={t('غياب بدون إذن', 'Unexcused absence')} value={num(e.unexcusedAbsences ?? e.absent_days, lang)} tone={(e.unexcusedAbsences ?? 0) > 0 ? 'bad' : undefined} hint={t(`غياب على الجهاز ${num(e.absent_days, lang)}`, `${num(e.absent_days, lang)} with no punch`)} />
        <Figure label={t('إجازات ومأموريات', 'Leave & away')} value={num((e.leaveDays ?? 0) + (e.awayDays ?? 0), lang)} hint={(e.pendingLeaveDays ?? 0) > 0 ? t(`${num(e.pendingLeaveDays, lang)} يوم قيد الاعتماد`, `${num(e.pendingLeaveDays, lang)} days pending`) : t('من Odoo', 'from Odoo')} />
        <Figure label={t('أيام التأخير', 'Late days')} value={num(e.late_days, lang)} tone={e.late_days ? 'warn' : undefined} hint={e.late_minutes ? minutesText(e.late_minutes, lang) : t('لا تأخير', 'never late')} />
        <Figure label={t('الالتزام بالموعد', 'Punctuality')} value={e.punctuality === null ? '—' : pct(Math.round(e.punctuality * 100), lang)} hint={e.score !== null ? t(`مؤشر الالتزام ${num(e.score, lang)}`, `Score ${num(e.score, lang)}`) : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <SectionTitle title={t('الأيام', 'Days')} hint={t('اختر يوماً لترى بصماته', 'Pick a day to see its punches')} />
          <AttendanceCalendar days={days} selected={selected} onSelect={setSelected} />
          <div className="mt-3"><Legend statuses={['ontime', 'late', 'excused', 'incomplete', 'absent', 'leave', 'away', 'off', 'holiday', 'extra']} /></div>
        </Card>
        <div className="min-w-0 space-y-5">
          {chosen && <DayDetail day={chosen} />}
          <Card>
            <SectionTitle title={t('الوصول والانصراف', 'Arrival and departure')} />
            <dl className="grid grid-cols-2 gap-3">
              <Fact label={t('متوسط الوصول', 'Average in')} value={clock(e.avg_arrival, lang)} />
              <Fact label={t('متوسط الانصراف', 'Average out')} value={clock(e.avg_departure, lang)} />
              <Fact label={t('متوسط اليوم', 'Average day')} value={hoursText(e.avg_hours, lang)} />
              <Fact label={t('إجمالي الساعات', 'Total hours')} value={hoursText(e.total_hours, lang)} />
              <Fact label={t('ساعات إضافية', 'Overtime')} value={hoursText(e.overtime_hours, lang)} />
              <Fact label={t('خروج مبكر', 'Left early')} value={t(`${num(e.early_days, lang)} يوم`, `${num(e.early_days, lang)} days`)} tone={e.early_days ? 'warn' : undefined} />
              <Fact label={t('بصمة ناقصة', 'Missing punch')} value={t(`${num(e.incomplete_days, lang)} يوم`, `${num(e.incomplete_days, lang)} days`)} tone={e.incomplete_days ? 'warn' : undefined} />
              <Fact label={t('أيام إضافية', 'Extra days')} value={num(e.extra_days, lang)} />
            </dl>
            {known.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[11.5px] font-bold text-slate-500">{t('متوسط الوصول حسب اليوم', 'Average arrival by weekday')}</p>
                <ul className="space-y-1.5">
                  {[5, 6, 0, 1, 2, 3, 4].map((index) => {
                    const value = weekday[index];
                    if (value === null || value === undefined) return null;
                    const late = data.shift && e.effective_schedule === 'fixed' && value > data.shift.start + (data.settings?.grace_minutes ?? 0);
                    return (
                      <li key={index} className="flex items-center gap-2 text-[12px]">
                        <span className="w-14 shrink-0 font-semibold text-slate-600">{pick(WEEKDAY[index])}</span>
                        <span className="relative h-2 flex-1 rounded-full bg-slate-100">
                          <span className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full" style={{ insetInlineStart: `calc(${((value - earliest) / Math.max(1, latest - earliest)) * 100}% - 6px)`, background: late ? 'rgb(180 83 9)' : 'rgb(21 128 61)' }} />
                        </span>
                        <span className="w-16 shrink-0 text-end font-bold tabular-nums text-navy">{clock(value, lang)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {(data.devices?.length ?? 0) > 0 && <p className="mt-4 text-[11.5px] text-slate-500">{t('الأجهزة:', 'Devices:')} {data.devices!.map(([device, count]) => `${device} (${num(count, lang)})`).join('، ')}</p>}
            <p className="mt-1 text-[11.5px] text-slate-500">{t('كود البصمة', 'Fingerprint code')} <b className="font-mono text-slate-700">{data.fingerprintCode}</b> · {t('أول بصمة مسجّلة', 'First seen')} {formatDate(e.first_seen, lang)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
