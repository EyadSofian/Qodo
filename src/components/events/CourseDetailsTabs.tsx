/**
 * The four tabs of the details panel. Overview is what a coordinator checks
 * before a lecture; the other three are the rest of the course, one concern
 * each, so nothing has to be scrolled past to reach anything else.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Video } from 'lucide-react';
import { departmentLabel } from '@shared/eventsSchedule';
import {
  DAY_PART_AR,
  DEPARTMENT_SOURCE_AR,
  QUALITY_LABELS,
  WEEKDAY_AR,
  hhmmLabel,
  ksaTime,
  placeLabel,
  type TrainingScheduleRow,
} from '../../lib/eventsSchedule';
import { cx } from '../../lib/utils';
import { CapacityProgress, DateSpan, DaysAndTime, currentOrNext, plannedTotal, whenLabel } from './CourseBits';
import { Person } from './CourseCard';
import { SessionPreview, SessionTimeline, sessionCounts } from './SessionTimeline';

export type DetailsTab = 'overview' | 'sessions' | 'trainees' | 'details';

function Block({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-bg px-3 py-2.5">
      <p className={cx('flex min-w-0 text-[13px] font-bold', value ? 'text-ink' : 'text-ink-faint')} title={value ?? undefined}>
        <span dir="auto" className="min-w-0 truncate">
          {value ?? '—'}
        </span>
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-muted">{label}</p>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="mb-2.5 text-[13px] font-bold text-ink">{children}</h4>;
}

/* ── overview ────────────────────────────────────────────────────── */

export function OverviewPane({ course, now, onTab }: { course: TrainingScheduleRow; now: Date; onTab: (tab: DetailsTab) => void }) {
  const counts = sessionCounts(course.sessions, now);
  const pick = currentOrNext(course.sessions, now);
  const total = plannedTotal(course);
  const online = course.deliveryMode === 'online';
  const pickToday = pick ? whenLabel(pick.session.startsAt!, now) === 'النهاردة' : false;

  return (
    <div className="grid gap-5">
      {course.qualityFlags.length > 0 && (
        <button
          type="button"
          onClick={() => onTab('details')}
          className="flex items-center gap-2 rounded-xl border border-accent-100 bg-accent-50/60 px-3 py-2 text-start text-[12.5px] font-semibold text-accent-700 hover:bg-accent-50"
        >
          <AlertTriangle size={14} className="shrink-0" />
          {course.qualityFlags.length} ملاحظة على بيانات الكورس في أودو — شوف التفاصيل
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Block value={departmentLabel(course.department)} label="القسم" />
        <Block value={course.package ?? course.section} label="الباقة" />
        <Block value={course.trainingType} label="النوع" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-xl border border-surface-line px-3 py-2.5">
          <p className="mb-2 text-[11.5px] text-ink-muted">المدرّب</p>
          <Person name={course.instructor} empty="مش متسجّل" size={30} />
        </div>
        <div className="min-w-0 rounded-xl border border-surface-line px-3 py-2.5">
          <p className="mb-2 text-[11.5px] text-ink-muted">
            الكوردينيتور
            {course.coordinatorSource === 'responsible' && course.coordinator && <span className="text-ink-faint"> · المسؤول في أودو</span>}
          </p>
          <Person name={course.coordinator} empty="مش متسجّل" size={30} />
        </div>
      </div>

      <dl className="grid grid-cols-5 divide-x divide-x-reverse divide-surface-line rounded-xl border border-surface-line py-3 text-center">
        {(
          [
            [course.capacity ? `${course.traineeCount} / ${course.capacity}` : String(course.traineeCount), 'متدربين'],
            [String(total), 'إجمالي'],
            [String(counts.past), 'خلصت'],
            [String(counts.upcoming), 'جاية'],
            [String(counts.today), 'النهاردة'],
          ] as const
        ).map(([value, label]) => (
          <div key={label} className="min-w-0 px-1">
            <dt className="sr-only">{label}</dt>
            <dd className="truncate text-[16px] font-extrabold tabular-nums text-ink">{value}</dd>
            <p className="mt-0.5 text-[11px] text-ink-muted" aria-hidden>
              {label}
            </p>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
        <div className="min-w-0">
          <Heading>المواعيد</Heading>
          <div className="grid gap-1.5">
            <DateSpan row={course} />
            <DaysAndTime row={course} />
          </div>
        </div>
        <div className={cx('rounded-xl px-3.5 py-3', pickToday ? 'bg-brand-50' : 'bg-surface-bg')}>
          <p className="text-[11.5px] font-semibold text-ink-faint">{pick?.live ? 'شغّالة دلوقتي' : 'المحاضرة الجاية'}</p>
          {pick ? (
            <>
              <p className={cx('mt-1 text-[14px] font-bold', pickToday ? 'text-brand-700' : 'text-ink')}>
                {whenLabel(pick.session.startsAt!, now)}، <span className="tabular-nums">{ksaTime(pick.session.startsAt)}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                محاضرة <span className="tabular-nums">{pick.session.number}</span> من <span className="tabular-nums">{total}</span>
              </p>
              {pickToday &&
                (pick.session.joinUrl ? (
                  <a
                    href={pick.session.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-600"
                  >
                    <Video size={14} /> ادخل على زووم
                  </a>
                ) : online ? (
                  <p className="mt-2 text-[11.5px] font-semibold text-accent-700">لينك الزووم لسه مااتعملش</p>
                ) : null)}
            </>
          ) : (
            <p className="mt-1 text-[13px] text-ink-muted">{course.sessionsTotal ? 'مفيش محاضرات جاية' : 'لسه مفيش محاضرات في أودو'}</p>
          )}
        </div>
      </div>

      <SessionPreview sessions={course.sessions} now={now} onViewAll={() => onTab('sessions')} />

      <div>
        <Heading>ملاحظات</Heading>
        {course.comments ? (
          <>
            <p dir="auto" className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">
              {course.comments}
            </p>
            {course.comments.length > 180 && (
              <button type="button" onClick={() => onTab('details')} className="mt-1 text-[12.5px] font-semibold text-brand-600 hover:underline">
                اقرأ الكل
              </button>
            )}
          </>
        ) : (
          <p className="text-[13px] text-ink-faint">مفيش ملاحظات متسجّلة في أودو.</p>
        )}
      </div>
    </div>
  );
}

/* ── sessions ────────────────────────────────────────────────────── */

export function SessionsPane({ course, now }: { course: TrainingScheduleRow; now: Date }) {
  return (
    <SessionTimeline
      sessions={course.sessions}
      now={now}
      online={course.deliveryMode === 'online'}
      emptyLabel={
        course.lectureCount
          ? `الجدول ناقص: مكتوب ${course.lectureCount} محاضرة ومفيش ولا محاضرة متولّدة في أودو.`
          : 'مفيش محاضرات متسجّلة في أودو.'
      }
    />
  );
}

/* ── trainees ────────────────────────────────────────────────────── */

export function TraineesPane({ course }: { course: TrainingScheduleRow }) {
  const regs = course.registrations;
  const belowMinimum = course.minimumCapacity !== null && course.traineeCount < course.minimumCapacity;
  return (
    <div className="grid gap-5">
      <div className="rounded-xl border border-surface-line px-4 py-3.5">
        <p className="mb-2 text-[12px] text-ink-muted">الحجوزات المؤكّدة</p>
        <CapacityProgress count={course.traineeCount} capacity={course.capacity} />
        {course.minimumCapacity !== null && (
          <p className={cx('mt-2 text-[12.5px]', belowMinimum ? 'font-semibold text-accent-700' : 'text-ink-muted')}>
            الحد الأدنى للبدء: <span className="tabular-nums">{course.minimumCapacity}</span>
            {belowMinimum && ' — لسه تحت الحد'}
          </p>
        )}
        {course.capacity === null && <p className="mt-2 text-[12px] text-ink-faint">السعة مش متسجّلة في أودو.</p>}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['مؤكّدة', regs.confirmed],
            ['مهتمين', regs.interested],
            ['حضروا', regs.attended],
            ['ملغية', regs.cancelled],
          ] as const
        ).map(([label, count]) => (
          <div key={label} className="rounded-xl bg-surface-bg px-3 py-2.5">
            <dt className="text-[11.5px] text-ink-muted">{label}</dt>
            <dd className="mt-0.5 text-[20px] font-extrabold tabular-nums text-ink">{count}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[12px] leading-relaxed text-ink-faint">
        الأعداد من حجوزات أودو: المؤكّدة = مفتوحة + حضرت، والمهتمين = مسودة. أسماء المتدربين نفسها موجودة في أودو.
      </p>
    </div>
  );
}

/* ── details ─────────────────────────────────────────────────────── */

function Fact({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 border-b border-surface-line/70 py-2.5 text-[13px] last:border-b-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-semibold text-ink">
        {children}
        {hint && <span className="mt-0.5 block text-[11.5px] font-normal text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

const show = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? <span className="font-normal text-ink-faint">—</span> : <bdi dir="auto">{value}</bdi>;

export function DetailsPane({ course }: { course: TrainingScheduleRow }) {
  const place = placeLabel(course);
  const configured = course.configuredWorkDays?.map((day) => WEEKDAY_AR[day] ?? day).join(' • ');
  return (
    <div className="grid gap-5">
      {course.qualityFlags.length > 0 && (
        <div className="rounded-xl border border-accent-100 bg-accent-50/60 px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-accent-700">
            <AlertTriangle size={14} />
            حاجات محتاجة مراجعة في أودو
          </p>
          <ul className="grid gap-0.5 text-[12.5px] leading-relaxed text-ink-muted">
            {course.qualityFlags.map((flag) => (
              <li key={flag}>• {QUALITY_LABELS[flag] ?? flag}</li>
            ))}
          </ul>
        </div>
      )}

      <dl>
        <Fact label="الكود">{show(course.courseCode)}</Fact>
        <Fact label="المرحلة في أودو">{show(course.status)}</Fact>
        <Fact label="القسم" hint={course.departmentSource ? DEPARTMENT_SOURCE_AR[course.departmentSource] : undefined}>
          {show(departmentLabel(course.department))}
        </Fact>
        <Fact label="الباقة">{show(course.package)}</Fact>
        {course.section && <Fact label="السكشن">{show(course.section)}</Fact>}
        <Fact label="المجموعة">{show(course.cohort)}</Fact>
        <Fact label="النوع">{show(course.trainingType)}</Fact>
        <Fact label="المكان">{show(place)}</Fact>
        {course.location.venue && place !== course.location.venue && <Fact label="العنوان">{show(course.location.venue)}</Fact>}
        <Fact
          label="المحاضرات"
          hint={course.lectureCount !== null && course.lectureCount !== course.sessionsTotal ? `${course.sessionsTotal} متولّدة فعلاً في أودو` : undefined}
        >
          {show(course.lectureCount ?? course.sessionsTotal)}
          {course.sessionHours ? <span className="font-normal text-ink-muted"> • {course.sessionHours} ساعة للمحاضرة</span> : null}
        </Fact>
        <Fact label="الميعاد المعتاد">
          {course.startTimeKsa ? (
            <span className="tabular-nums">
              {hhmmLabel(course.startTimeKsa)}
              {course.endTimeKsa ? ` – ${hhmmLabel(course.endTimeKsa)}` : ''}{' '}
              <span className="font-normal text-ink-muted">بتوقيت السعودية</span>
            </span>
          ) : (
            show(null)
          )}
        </Fact>
        <Fact label="صباحي / مسائي">{show(course.dayPart ? DAY_PART_AR[course.dayPart] : null)}</Fact>
        <Fact
          label="أيام الدراسة"
          hint={
            course.workDaysSource === 'sessions'
              ? configured && configured !== course.workDays.map((d) => WEEKDAY_AR[d] ?? d).join(' • ')
                ? `من تواريخ المحاضرات — أودو مكتوب فيه: ${configured}`
                : 'من تواريخ المحاضرات نفسها'
              : course.workDaysSource === 'odoo'
                ? 'من حقل أيام الدراسة في أودو'
                : undefined
          }
        >
          {show(course.workDays.map((day) => WEEKDAY_AR[day] ?? day).join(' • ') || null)}
        </Fact>
        <Fact label="التقدّم">
          {course.progress !== null ? (
            <span className="tabular-nums">
              {course.sessionsPast} من {course.sessionsTotal} • {course.progress}%
            </span>
          ) : (
            show(null)
          )}
        </Fact>
        <Fact label="الكوردينيتور" hint={course.coordinatorSource === 'responsible' ? 'حقل «المسؤول» في أودو' : undefined}>
          {show(course.coordinator)}
        </Fact>
      </dl>

      <div>
        <Heading>ملاحظات</Heading>
        {course.comments ? (
          <p dir="auto" className="whitespace-pre-wrap rounded-xl bg-surface-bg px-3.5 py-3 text-[13px] leading-relaxed text-ink">
            {course.comments}
          </p>
        ) : (
          <p className="text-[13px] text-ink-faint">مفيش ملاحظات متسجّلة في أودو.</p>
        )}
      </div>
    </div>
  );
}
