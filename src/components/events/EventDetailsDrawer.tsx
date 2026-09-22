/**
 * One course, all of it — the row the grid could only summarise.
 *
 * A side sheet rather than a centred modal because it is opened from a wide
 * table and read next to it; on a phone it becomes the whole screen. It is a
 * real dialog: focus moves in, Tab stays inside, Escape closes, and focus goes
 * back to the row that opened it.
 *
 * Read-only like the rest of the module. "افتح في أودو" is the way to change
 * anything, because Odoo is where the course is run.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { departmentLabel, groupOf } from '@shared/eventsSchedule';
import { errorMessage } from '../../lib/api';
import {
  DAY_PART_AR,
  DEPARTMENT_SOURCE_AR,
  QUALITY_LABELS,
  agoLabel,
  cairoTime,
  fetchEventDetail,
  hhmmLabel,
  ksaDate,
  placeLabel,
  type DetailResponse,
  type TrainingScheduleRow,
} from '../../lib/eventsSchedule';
import { CapacityCell, Missing, StatusChip, WorkDaysChips } from './ScheduleCells';
import { SessionTimeline } from './SessionTimeline';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function EventDetailsDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

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
  }, [id]);

  useEffect(() => {
    if (id === null) return;
    opener.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
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
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus?.();
    };
  }, [id, onClose]);

  if (id === null) return null;
  const course = data?.course;

  return createPortal(
    <div dir="ltr" className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/30 backdrop-blur-[2px] animate-pop-in" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-drawer-title"
        dir="ltr"
        className="relative z-10 flex h-full w-full flex-col bg-white shadow-panel animate-fade-up sm:max-w-[560px] sm:rounded-s-3xl"
      >
        <header className="border-b border-surface-line px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="event-drawer-title" className="text-[19px] font-black leading-snug text-ink">
                <bdi dir="auto">{course?.courseName ?? (error ? 'الكورس' : 'جارٍ التحميل…')}</bdi>
              </h2>
              {course && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                  {course.courseCode && <span className="font-mono font-semibold tabular-nums text-ink">{course.courseCode}</span>}
                  <StatusChip status={course.statusCanonical} stage={course.status} size="md" />
                  {course.trainingType && <span className="rounded-full bg-surface-sunken px-2 py-0.5 font-semibold">{course.trainingType}</span>}
                </div>
              )}
            </div>
            <button
              type="button"
              data-autofocus
              onClick={onClose}
              aria-label="اقفل التفاصيل"
              className="btn-quiet !min-h-9 rounded-lg p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <X size={18} />
            </button>
          </div>
          {data && (
            <p className="mt-2.5 text-[11px] text-ink-faint">
              Source: Odoo · Last sync {cairoTime(data.fetchedAt)} Cairo
              {data.stale && <span className="font-semibold text-accent-700"> · stale ({agoLabel(data.fetchedAt)})</span>}
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p dir="rtl" className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad">
              <X size={16} />
              {error}
            </p>
          )}
          {!course && !error && <DrawerSkeleton />}
          {course && <DrawerBody course={course} />}
        </div>

        {data?.odooUrl && (
          <footer className="flex items-center justify-between gap-3 border-t border-surface-line px-5 py-3 pb-safe sm:pb-3">
            <p dir="rtl" className="text-[11px] leading-relaxed text-ink-faint">للتعديل افتح السجل في أودو — محتاج صلاحية الإيفينتات هناك.</p>
            <a href={data.odooUrl} target="_blank" rel="noreferrer noopener" className="btn-navy btn-sm shrink-0 gap-1.5">
              افتح في أودو
              <ExternalLink size={14} />
            </a>
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-surface-line/80 py-4 first:pt-0 last:border-0">
      <h3 className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-3 py-1 text-[13px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 font-semibold text-ink">
        {children}
        {hint && (
          <span dir="rtl" className="mt-0.5 block text-[11px] font-normal text-ink-faint">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

const value = (text: string | null | undefined, missing?: string) =>
  text ? <bdi dir="auto">{text}</bdi> : <Missing label={missing} />;

function DrawerBody({ course }: { course: TrainingScheduleRow }) {
  const now = new Date();
  const place = placeLabel(course);
  return (
    <>
      {course.qualityFlags.length > 0 && (
        <div dir="rtl" className="mb-4 rounded-xl border border-accent-100 bg-accent-50/60 px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-accent-700">
            <AlertTriangle size={14} />
            حاجات محتاجة مراجعة في أودو
          </p>
          <ul className="grid gap-0.5 text-[12px] leading-relaxed text-ink-muted">
            {course.qualityFlags.map((flag) => (
              <li key={flag}>• {QUALITY_LABELS[flag] ?? flag}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="نظرة عامة">
        <dl>
          <Fact label="القسم" hint={course.departmentSource ? DEPARTMENT_SOURCE_AR[course.departmentSource] : undefined}>
            {value(departmentLabel(course.department), 'مش متصنّف')}
          </Fact>
          <Fact label="الباقة / السكشن">{value(groupOf(course), 'مش موجود في أودو')}</Fact>
          <Fact label="المدرّب">{value(course.instructor, 'مفيش مدرّب')}</Fact>
          <Fact label="النوع">{value(course.trainingType)}</Fact>
          <Fact label="طريقة الحضور">{value(place)}</Fact>
          <Fact label="المتدربين">
            <CapacityCell count={course.traineeCount} capacity={course.capacity} />
          </Fact>
          {course.minimumCapacity !== null && <Fact label="الحد الأدنى للبدء">{course.minimumCapacity}</Fact>}
          <Fact label="المحاضرات" hint={course.lectureCount !== null && course.sessionsTotal !== course.lectureCount ? `${course.sessionsTotal} متولّدة فعلاً في أودو` : undefined}>
            {course.lectureCount ?? course.sessionsTotal ?? <Missing />}
            {course.sessionHours ? <span className="font-normal text-ink-muted"> · {course.sessionHours}h each</span> : null}
          </Fact>
        </dl>
      </Section>

      <Section title="المواعيد">
        <dl>
          <Fact label="البداية">{course.startsAt ? ksaDate(course.startsAt) : <Missing />}</Fact>
          <Fact label="النهاية">{course.endsAt ? ksaDate(course.endsAt) : <Missing />}</Fact>
          <Fact label="التوقيت السعودي">
            {course.startTimeKsa ? `${hhmmLabel(course.startTimeKsa)}${course.endTimeKsa ? ` – ${hhmmLabel(course.endTimeKsa)}` : ''}` : <Missing />}
          </Fact>
          <Fact label="أيام الدراسة">
            <WorkDaysChips days={course.workDays} source={course.workDaysSource} />
          </Fact>
          <Fact label="صباحي / مسائي">{course.dayPart ? `${DAY_PART_AR[course.dayPart]} · ${course.dayPart}` : <Missing />}</Fact>
          <Fact label="التقدّم">
            <Progress course={course} />
          </Fact>
        </dl>
      </Section>

      <Section title="التشغيل">
        <dl>
          <Fact label="الكوردينيتور">
            {value(course.coordinator, 'مش متسجّل / مش موجود في أودو')}
            {course.coordinatorSource === 'responsible' && course.coordinator ? (
              <span className="ms-1.5 text-[11.5px] text-ink-muted" title="أودو مفيهاش عمود Coordinator؛ ده الـResponsible بتاع الإيفينت">
                (Responsible)
              </span>
            ) : null}
          </Fact>
          <Fact label="المجموعة">{value(course.cohort)}</Fact>
          <Fact label="المكان">{value(course.location.venue)}</Fact>
        </dl>
        <div className="mt-2">
          <p className="mb-1 text-[13px] text-ink-muted">ملاحظات</p>
          {course.comments ? (
            <p dir="auto" className="whitespace-pre-wrap rounded-xl bg-surface-bg px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
              {course.comments}
            </p>
          ) : (
            <Missing label="مفيش تعليقات" />
          )}
        </div>
      </Section>

      <Section title={`Sessions (${course.sessionsTotal})`}>
        <SessionTimeline
          sessions={course.sessions}
          now={now}
          emptyLabel={
            course.lectureCount
              ? `الجدول ناقص: مكتوب ${course.lectureCount} محاضرة ومفيش ولا محاضرة متولّدة في أودو.`
              : 'مفيش محاضرات متسجّلة.'
          }
        />
      </Section>

      <Section title="الحجوزات">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['مؤكّدة', course.registrations.confirmed],
              ['مهتمين', course.registrations.interested],
              ['حضروا', course.registrations.attended],
              ['ملغية', course.registrations.cancelled],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-xl border border-surface-line px-3 py-2">
              <dt className="text-[11px] font-semibold text-ink-faint">{label}</dt>
              <dd className="text-[18px] font-black tabular-nums text-ink">{count}</dd>
            </div>
          ))}
        </dl>
        <p dir="rtl" className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          المؤكد = مفتوح + تم · المهتم = مسودة · الحضور = تم · من event.registration في أودو.
        </p>
      </Section>
    </>
  );
}

/** Lectures that have happened, out of those scheduled — never a fake 0%. */
function Progress({ course }: { course: TrainingScheduleRow }) {
  if (course.progress === null) {
    return course.lectureCount ? <span className="text-accent-700">الجدول ناقص</span> : <Missing />;
  }
  return (
    <span className="grid gap-1">
      <span className="text-[12.5px]">
        {course.sessionsPast} of {course.sessionsTotal} done · {course.progress}%
      </span>
      <span className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${course.progress}%` }} />
      </span>
    </span>
  );
}

function DrawerSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true">
      {Array.from({ length: 4 }).map((_, section) => (
        <div key={section} className="grid gap-2.5">
          <div className="skeleton h-2.5 w-20 rounded" />
          {Array.from({ length: 4 }).map((__, line) => (
            <div key={line} className="flex gap-4">
              <div className="skeleton h-3 w-24 rounded" />
              <div className="skeleton h-3 w-40 rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
