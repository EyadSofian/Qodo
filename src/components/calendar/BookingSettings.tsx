/**
 * The employee's side of a booking page: the hours they are willing to be
 * interrupted, and the list of people who took one.
 *
 * The screen is arranged around the one thing that is easy to get wrong.
 * Publishing puts a real person's name and free time on the open internet, so
 * the switch that does it is not a checkbox among other checkboxes — it sits at
 * the top, says in words what it turns on, and shows the exact link a customer
 * will see the moment it is on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  Copy,
  Globe,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { WEEKDAYS, WEEKDAY_LABEL } from '@shared/booking';
import { errorMessage } from '../../lib/api';
import {
  DURATION_LABEL,
  NOTICE_LABEL,
  cancelClientBooking,
  fetchMyBookingPage,
  fetchMyBookings,
  saveBookingPage,
  slotDay,
  slotTime,
  type Availability,
  type Booking,
  type BookingOptions,
  type BookingPage,
} from '../../lib/booking';
import { Field, Spinner, useToast } from '../ui';
import { cx } from '../../lib/utils';

const SAVE_ERRORS: Record<string, string> = {
  no_availability: 'لا يمكن نشر صفحة من دون أي أوقات متاحة.',
  slug_taken: 'هذا الرابط محجوز مسبقًا. يُرجى اختيار رابط آخر.',
  invalid_slug: 'يجب أن يتكوّن الرابط من حروف إنجليزية صغيرة وأرقام وشرطات فقط.',
  end_before_start: 'وقت الإغلاق قبل وقت الفتح.',
  invalid_hours: 'أحد الأوقات المُدخلة غير صحيح.',
};

export function BookingSettings({ onClose }: { onClose: () => void }) {
  const { push } = useToast();
  const [page, setPage] = useState<BookingPage | null>(null);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [origin, setOrigin] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [draft, setDraft] = useState<Partial<BookingPage> | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [config, list] = await Promise.all([fetchMyBookingPage(), fetchMyBookings()]);
    setPage(config.page);
    setOptions(config.options);
    setOrigin(config.origin);
    setBookings(list);
    setDraft(
      config.page ?? {
        title: '',
        description: '',
        location: '',
        durationMinutes: 30,
        bufferMinutes: 0,
        noticeMinutes: 240,
        horizonDays: 14,
        availability: undefined,
        active: false,
      }
    );
  }, []);

  useEffect(() => {
    load().catch((error) => push(errorMessage(error), 'bad'));
  }, [load, push]);

  const link = useMemo(() => {
    if (!page?.slug) return '';
    return `${origin || window.location.origin}/book/${page.slug}`;
  }, [page, origin]);

  if (!draft || !options) {
    return (
      <div className="grid place-items-center py-12">
        <Spinner size={22} />
      </div>
    );
  }

  const set = <K extends keyof BookingPage>(key: K, value: BookingPage[K]) =>
    setDraft({ ...draft, [key]: value });

  const availability: Availability =
    (draft.availability as Availability) ??
    Object.fromEntries(WEEKDAYS.map((day) => [day, []]));

  const save = async (overrides: Partial<BookingPage> = {}) => {
    setSaving(true);
    try {
      const body = { ...draft, ...overrides };
      const result = await saveBookingPage(body);
      setPage(result.page);
      setOrigin(result.origin);
      setDraft(result.page);
      push(result.page.active ? 'الصفحة منشورة الآن.' : 'تم الحفظ.');
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      push(SAVE_ERRORS[code] ?? errorMessage(error), 'bad');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (booking: Booking) => {
    if (!window.confirm(`إلغاء موعد ${booking.clientName}؟ سيصله بريد إلكتروني بالإلغاء.`)) return;
    try {
      const updated = await cancelClientBooking(booking.id);
      setBookings((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      push('اتلغى واتبعت إيميل للعميل.');
    } catch (error) {
      push(errorMessage(error), 'bad');
    }
  };

  const upcoming = bookings.filter(
    (row) => row.status === 'confirmed' && row.endAt >= new Date().toISOString()
  );

  return (
    <div className="grid gap-5">
      {/* Publishing is the consequential act here, so it is stated rather than
          buried in a row of switches. */}
      <section
        className={cx(
          'grid gap-3 rounded-2xl border p-4',
          draft.active ? 'border-emerald-200 bg-emerald-50/60' : 'border-surface-line bg-surface-sunken/60'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
              <Globe size={15} className={draft.active ? 'text-emerald-600' : 'text-ink-faint'} />
              {draft.active ? 'الصفحة منشورة على الإنترنت' : 'الصفحة غير منشورة'}
            </span>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              {draft.active
                ? 'أي شخص يملك الرابط يقدر يشوف أوقاتك المتاحة ويحجز.'
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ active: !draft.active })}
            disabled={saving}
            className={cx('btn btn-sm shrink-0', draft.active ? 'btn-ghost' : 'btn-primary')}
          >
            {draft.active ? 'إلغاء النشر' : 'نشر'}
          </button>
        </div>

        {page?.slug && (
          <div className="flex items-center gap-2 rounded-xl border border-surface-line bg-white px-3 py-2">
            <Link2 size={14} className="shrink-0 text-ink-faint" />
            <span className="ltr min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">{link}</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              }}
              className="btn btn-ghost !min-h-8 shrink-0 !px-2 text-[11px]"
            >
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied ? 'تم النسخ' : 'نسخ'}
            </button>
          </div>
        )}
        {!origin && page?.slug && (
          <p className="text-[11px] text-amber-700">
            ملاحظة: عنوان الموقع غير مُعرَّف على الخادم (PUBLIC_ORIGIN)، لذلك قد يظهر الرابط في بريد
            العميل ناقصًا.
          </p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="عنوان الصفحة">
          <input
            className="field"
            value={draft.title ?? ''}
            onChange={(event) => set('title', event.target.value)}
            placeholder="استشارة أولى"
            maxLength={120}
          />
        </Field>
        <Field label="مدة الموعد">
          <select
            className="field"
            value={draft.durationMinutes}
            onChange={(event) => set('durationMinutes', Number(event.target.value))}
          >
            {options.durations.map((value) => (
              <option key={value} value={value}>
                {DURATION_LABEL(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="وصف مختصر">
        <textarea
          className="field min-h-16"
          value={draft.description ?? ''}
          onChange={(event) => set('description', event.target.value)}
          maxLength={1_000}
          placeholder="نصف ساعة نناقش فيها احتياجك ونجيب عن أسئلتك."
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المكان">
          <input
            className="field"
            value={draft.location ?? ''}
            onChange={(event) => set('location', event.target.value)}
            placeholder="مكتب إنجوسوفت — التجمع"
            maxLength={120}
          />
        </Field>
        <Field label="رابط الحضور عن بُعد">
          <input
            className="field ltr"
            value={draft.onlineUrl ?? ''}
            onChange={(event) => set('onlineUrl', event.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="أقل مهلة قبل الحجز">
          <select
            className="field"
            value={draft.noticeMinutes}
            onChange={(event) => set('noticeMinutes', Number(event.target.value))}
          >
            {options.notices.map((value) => (
              <option key={value} value={value}>
                {NOTICE_LABEL(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="فاصل بين المواعيد">
          <select
            className="field"
            value={draft.bufferMinutes}
            onChange={(event) => set('bufferMinutes', Number(event.target.value))}
          >
            {options.buffers.map((value) => (
              <option key={value} value={value}>
                {value === 0 ? 'بلا فاصل' : `${value} دقيقة`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الحجز متاح مسبقًا حتى">
          <select
            className="field"
            value={draft.horizonDays}
            onChange={(event) => set('horizonDays', Number(event.target.value))}
          >
            {options.horizons.map((value) => (
              <option key={value} value={value}>
                {value} يوم
              </option>
            ))}
          </select>
        </Field>
      </div>

      <section className="grid gap-2">
        <span className="label">ساعات العمل</span>
        <p className="-mt-1 text-[11px] text-ink-faint">
          هذه هي الأوقات التي يستطيع العميل الحجز فيها. أي اجتماع أو موعد في تقويمك يُستبعد منها
          تلقائيًا.
        </p>
        <div className="grid gap-1.5">
          {WEEKDAYS.map((day) => (
            <DayRow
              key={day}
              day={day}
              windows={availability[day] ?? []}
              onChange={(windows) =>
                set('availability', { ...availability, [day]: windows } as Availability)
              }
            />
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-surface-line pt-4">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          إغلاق
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => save()}
          disabled={saving}
        >
          {saving ? <Spinner size={14} /> : null}
          حفظ
        </button>
      </div>

      {upcoming.length > 0 && (
        <section className="grid gap-2 border-t border-surface-line pt-4">
          <span className="label flex items-center gap-1.5">
            <CalendarIcon size={14} /> حجوزات العملاء القادمة
            <span className="font-normal text-ink-faint">({upcoming.length})</span>
          </span>
          <ul className="grid gap-1.5">
            {upcoming.map((booking) => (
              <li
                key={booking.id}
                className="flex items-start gap-3 rounded-xl border border-surface-line p-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-ink">
                    {booking.clientName}
                    {booking.clientCompany ? ` · ${booking.clientCompany}` : ''}
                  </span>
                  <span className="block text-[11.5px] text-ink-muted">
                    {slotDay(booking.startAt, page?.timeZone ?? 'Africa/Cairo')} ·{' '}
                    {slotTime(booking.startAt, page?.timeZone ?? 'Africa/Cairo')}
                  </span>
                  <span className="ltr block text-[11px] text-ink-faint">
                    {booking.clientEmail}
                    {booking.clientPhone ? ` · ${booking.clientPhone}` : ''}
                  </span>
                  {booking.clientNote && (
                    <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-ink-muted">
                      {booking.clientNote}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => cancel(booking)}
                  className="btn btn-ghost !min-h-8 shrink-0 !px-2 text-[11px] text-rose-600 hover:bg-rose-50"
                >
                  إلغاء
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One weekday: any number of open windows, or closed. */
function DayRow({
  day,
  windows,
  onChange,
}: {
  day: string;
  windows: { start: string; end: string }[];
  onChange: (windows: { start: string; end: string }[]) => void;
}) {
  const open = windows.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-line px-3 py-2">
      <label className="flex w-24 shrink-0 items-center gap-2 text-[12px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={open}
          onChange={(event) =>
            onChange(event.target.checked ? [{ start: '09:00', end: '17:00' }] : [])
          }
        />
        {WEEKDAY_LABEL[day as keyof typeof WEEKDAY_LABEL].ar}
      </label>

      {!open && <span className="text-[11.5px] text-ink-faint">غير متاح</span>}

      <div className="grid flex-1 gap-1.5">
        {windows.map((window, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="time"
              className="field ltr !min-h-9 !w-28 !py-1"
              value={window.start}
              onChange={(event) =>
                onChange(
                  windows.map((row, at) =>
                    at === index ? { ...row, start: event.target.value } : row
                  )
                )
              }
            />
            <span className="text-[11px] text-ink-faint">إلى</span>
            <input
              type="time"
              className="field ltr !min-h-9 !w-28 !py-1"
              value={window.end}
              onChange={(event) =>
                onChange(
                  windows.map((row, at) => (at === index ? { ...row, end: event.target.value } : row))
                )
              }
            />
            <button
              type="button"
              onClick={() => onChange(windows.filter((_, at) => at !== index))}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint hover:bg-rose-50 hover:text-rose-600"
              aria-label="حذف الفترة"
            >
              {windows.length === 1 ? <X size={13} /> : <Trash2 size={13} />}
            </button>
          </div>
        ))}
        {open && windows.length < 4 && (
          <button
            type="button"
            onClick={() => onChange([...windows, { start: '18:00', end: '20:00' }])}
            className="flex w-fit items-center gap-1 text-[11px] font-semibold text-brand-600"
          >
            <Plus size={12} /> فترة إضافية
          </button>
        )}
      </div>
    </div>
  );
}
