/**
 * The page a customer sees. The only screen in this workspace built for
 * somebody who does not work here.
 *
 * Which changes what "good" means. There is no navigation, because there is
 * nowhere else this person is going. There is no Arabic/English switch, because
 * they did not set a preference and the company's own language is the honest
 * default. Nothing hints at an app behind it — no launcher, no sign-in prompt,
 * no "powered by" that reads as a way in. A booking page that makes a customer
 * wonder whether they need an account has already failed.
 *
 * The flow is deliberately three steps on one screen: pick a day, pick an hour,
 * say who you are. Anything longer and the person books by phone instead.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Globe2,
  Link2,
  Mail,
  MapPin,
  Phone,
  User,
} from 'lucide-react';
import { LogoMark } from '../components/Brand';
import { Avatar, Field, Spinner } from '../components/ui';
import { cx } from '../lib/utils';
import {
  DURATION_LABEL,
  PublicBookingError,
  bookSlot,
  cancelManagedBooking,
  fetchManagedBooking,
  fetchPublicPage,
  fetchPublicSlots,
  groupByDay,
  slotDay,
  slotTime,
  type ClientDetails,
  type PublicPage,
  type Slot,
} from '../lib/booking';

const EMPTY: ClientDetails = {
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  clientCompany: '',
  clientNote: '',
};

const MESSAGES: Record<string, string> = {
  not_found: 'هذا الرابط لم يعد متاحًا. يُرجى طلب رابط جديد ممن أرسله إليك.',
  slot_unavailable: 'حُجز هذا الموعد قبل قليل. يُرجى اختيار موعد آخر.',
  invalid_client_email: 'البريد الإلكتروني غير صحيح.',
  client_name_required: 'يُرجى إدخال الاسم.',
  too_many_attempts: 'عدد المحاولات كبير خلال وقت قصير. يُرجى الانتظار قليلًا ثم المحاولة مجددًا.',
  range_too_wide: 'المدة المطلوبة أكبر من المسموح.',
};

const message = (error: unknown) =>
  error instanceof PublicBookingError
    ? (MESSAGES[error.code] ?? 'تعذّر إتمام العملية. يُرجى المحاولة مجددًا.')
    : 'تعذّر الاتصال بالخادم. يُرجى المحاولة مجددًا.';

export function Book({ manage = false }: { manage?: boolean }) {
  return (
    <div className="min-h-[100dvh] bg-surface-sunken" dir="rtl">
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-8 sm:py-14">
        <header className="flex items-center justify-center gap-2 pb-1">
          <LogoMark size={30} />
          <span className="text-[13px] font-bold text-ink-muted">إنجوسوفت</span>
        </header>
        {manage ? <ManageBooking /> : <BookSlot />}
        <p className="pt-2 text-center text-[11px] text-ink-faint">
          جميع المواعيد بتوقيت القاهرة.
        </p>
      </div>
    </div>
  );
}

/* ── booking ─────────────────────────────────────────────────────── */

function BookSlot() {
  const { slug = '' } = useParams();
  const [page, setPage] = useState<PublicPage | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [client, setClient] = useState<ClientDetails>(EMPTY);
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState<{ slot: Slot; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await fetchPublicPage(slug);
      setPage(found);
      const from = new Date();
      const to = new Date(Date.now() + Math.min(found.horizonDays, 30) * 86_400_000);
      setSlots(await fetchPublicSlots(slug, from, to));
    } catch (caught) {
      setFatal(message(caught));
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(
    () => (page && slots ? groupByDay(slots, page.timeZone) : []),
    [slots, page]
  );

  // The first day with anything free is the one worth opening on — asking
  // somebody to hunt for it is the fastest way to lose them.
  useEffect(() => {
    if (!day && days.length > 0) setDay(days[0][0]);
  }, [days, day]);

  if (fatal) return <Card><Notice tone="bad" text={fatal} /></Card>;
  if (!page || !slots) return <Card><Loading /></Card>;

  if (done) {
    return (
      <Card>
        <Confirmed page={page} slot={done.slot} token={done.token} name={client.clientName} />
      </Card>
    );
  }

  const submit = async () => {
    if (!chosen) return;
    setBooking(true);
    setError(null);
    try {
      const result = await bookSlot(slug, chosen, client);
      setDone({ slot: chosen, token: result.manageToken });
    } catch (caught) {
      setError(message(caught));
      // Somebody else took it while this form was open, so the list is stale.
      if (caught instanceof PublicBookingError && caught.code === 'slot_unavailable') {
        setChosen(null);
        setSlots(await fetchPublicSlots(slug, new Date(), new Date(Date.now() + 30 * 86_400_000)));
      }
    } finally {
      setBooking(false);
    }
  };

  const today = days.find(([key]) => key === day)?.[1] ?? [];
  const ready = client.clientName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.clientEmail);

  return (
    <Card>
      <Header page={page} />

      {days.length === 0 ? (
        <Notice tone="soft" text="لا توجد مواعيد متاحة خلال الفترة القادمة. يُرجى المحاولة لاحقًا." />
      ) : (
        <>
          <Step number={1} label="اختر اليوم" />
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map(([key, list]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDay(key);
                  setChosen(null);
                }}
                className={cx(
                  'shrink-0 rounded-2xl border px-3 py-2 text-center transition',
                  key === day
                    ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                    : 'border-surface-line bg-white hover:border-brand-200'
                )}
              >
                <span className="block text-[12.5px] font-bold text-ink">
                  {slotDay(list[0].startAt, page.timeZone).split('،')[0]}
                </span>
                <span className="block text-[11px] text-ink-faint">
                  {new Intl.DateTimeFormat('ar-EG', {
                    timeZone: page.timeZone,
                    day: 'numeric',
                    month: 'short',
                  }).format(new Date(list[0].startAt))}
                </span>
                <span className="mt-1 block text-[10.5px] font-semibold text-brand-600">
                  {list.length} موعد
                </span>
              </button>
            ))}
          </div>

          <Step number={2} label="اختر الوقت" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {today.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                onClick={() => setChosen(slot)}
                className={cx(
                  'rounded-xl border px-2 py-2 text-[12.5px] font-bold transition',
                  chosen?.startAt === slot.startAt
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-surface-line bg-white text-ink hover:border-brand-300'
                )}
              >
                {slotTime(slot.startAt, page.timeZone)}
              </button>
            ))}
          </div>

          {chosen && (
            <>
              <Step number={3} label="بياناتك" />
              <div className="rounded-2xl bg-brand-50/60 px-3 py-2 text-[12px] font-semibold text-brand-700">
                {slotDay(chosen.startAt, page.timeZone)} · {slotTime(chosen.startAt, page.timeZone)}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الاسم" required>
                  <IconInput
                    icon={User}
                    value={client.clientName}
                    onChange={(value) => setClient({ ...client, clientName: value })}
                    placeholder="الاسم بالكامل"
                    maxLength={120}
                  />
                </Field>
                <Field label="البريد الإلكتروني" required>
                  <IconInput
                    icon={Mail}
                    type="email"
                    value={client.clientEmail}
                    onChange={(value) => setClient({ ...client, clientEmail: value })}
                    placeholder="you@example.com"
                    maxLength={200}
                    ltr
                  />
                </Field>
                <Field label="رقم الهاتف">
                  <IconInput
                    icon={Phone}
                    value={client.clientPhone}
                    onChange={(value) => setClient({ ...client, clientPhone: value })}
                    placeholder="01xxxxxxxxx"
                    maxLength={40}
                    ltr
                  />
                </Field>
                <Field label="اسم الشركة">
                  <IconInput
                    icon={Building2}
                    value={client.clientCompany}
                    onChange={(value) => setClient({ ...client, clientCompany: value })}
                    placeholder="اسم الشركة"
                    maxLength={120}
                  />
                </Field>
              </div>

              <Field label="سبب الحجز">
                <textarea
                  className="field min-h-20"
                  value={client.clientNote}
                  onChange={(event) => setClient({ ...client, clientNote: event.target.value })}
                  maxLength={1_000}
                  placeholder="ما الموضوع الذي ترغب في مناقشته؟"
                />
              </Field>

              {error && <Notice tone="bad" text={error} />}

              <button
                type="button"
                onClick={submit}
                disabled={!ready || booking}
                className="btn btn-primary w-full justify-center !py-3 text-[14px]"
              >
                {booking ? <Spinner size={15} /> : null}
                تأكيد الحجز
              </button>
              <p className="text-center text-[11px] text-ink-faint">
                ستصلك رسالة تأكيد على البريد الإلكتروني، ويمكنك الإلغاء في أي وقت.
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function Confirmed({
  page,
  slot,
  token,
  name,
}: {
  page: PublicPage;
  slot: Slot;
  token: string;
  name: string;
}) {
  return (
    <div className="grid gap-4 py-4 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 size={30} />
      </span>
      <div>
        <h1 className="text-[19px] font-extrabold text-ink">تم الحجز</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          شكرًا {name} — تأكد موعدك مع {page.owner.name}.
        </p>
      </div>

      <div className="grid gap-2 rounded-2xl border border-surface-line bg-surface-sunken/60 p-4 text-start">
        <Row icon={CalendarDays} text={slotDay(slot.startAt, page.timeZone)} />
        <Row
          icon={Clock}
          text={`${slotTime(slot.startAt, page.timeZone)} — ${slotTime(slot.endAt, page.timeZone)}`}
        />
        {page.location && <Row icon={MapPin} text={page.location} />}
        {page.onlineUrl && (
          <Row
            icon={Globe2}
            text={
              <a href={page.onlineUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                رابط الموعد
              </a>
            }
          />
        )}
      </div>

      {/* Shown on screen and not only emailed: SMTP is optional in this
          deployment, and a person who cannot cancel simply does not turn up. */}
      <div className="rounded-2xl border border-dashed border-surface-line p-3">
        <p className="text-[11.5px] font-semibold text-ink-muted">
          <Link2 size={13} className="me-1 inline" />
          يُرجى الاحتفاظ بهذا الرابط للإلغاء أو مراجعة الموعد لاحقًا:
        </p>
        <a
          href={`/book/manage/${token}`}
          className="ltr mt-1 block break-all text-[11px] text-brand-600 underline"
        >
          {`${window.location.origin}/book/manage/${token}`}
        </a>
      </div>
    </div>
  );
}

/* ── the client's own appointment ────────────────────────────────── */

function ManageBooking() {
  const { token = '' } = useParams();
  const [state, setState] = useState<Awaited<ReturnType<typeof fetchManagedBooking>> | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    fetchManagedBooking(token)
      .then(setState)
      .catch((caught) => setFatal(message(caught)));
  }, [token]);

  if (fatal) return <Card><Notice tone="bad" text={fatal} /></Card>;
  if (!state) return <Card><Loading /></Card>;

  const { booking, page } = state;
  const zone = page?.timeZone ?? 'Africa/Cairo';
  const cancelled = booking.status === 'cancelled';

  const cancel = async () => {
    if (!window.confirm('هل أنت متأكد من إلغاء الموعد؟')) return;
    setWorking(true);
    try {
      await cancelManagedBooking(token);
      setState({ ...state, booking: { ...booking, status: 'cancelled', cancelledBy: 'client' } });
    } catch (caught) {
      setFatal(message(caught));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card>
      <div className="grid gap-4 text-center">
        <span
          className={cx(
            'mx-auto grid h-14 w-14 place-items-center rounded-full',
            cancelled ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
          )}
        >
          {cancelled ? <AlertCircle size={30} /> : <CheckCircle2 size={30} />}
        </span>
        <div>
          <h1 className="text-[19px] font-extrabold text-ink">
            {cancelled ? 'تم إلغاء الموعد' : 'موعدك مؤكد'}
          </h1>
          {page && (
            <p className="mt-1 text-[13px] text-ink-muted">
              {cancelled
                ? booking.cancelledBy === 'owner'
                  ? `اضطر ${page.owner.name} إلى إلغاء الموعد.`
                  : 'تم الإلغاء بناءً على طلبك.'
                : `مع ${page.owner.name}`}
            </p>
          )}
        </div>

        <div className="grid gap-2 rounded-2xl border border-surface-line bg-surface-sunken/60 p-4 text-start">
          <Row icon={CalendarDays} text={slotDay(booking.startAt, zone)} />
          <Row
            icon={Clock}
            text={`${slotTime(booking.startAt, zone)} — ${slotTime(booking.endAt, zone)}`}
          />
          {page?.location && <Row icon={MapPin} text={page.location} />}
        </div>

        {!cancelled && (
          <button
            type="button"
            onClick={cancel}
            disabled={working}
            className="btn btn-ghost w-full justify-center text-rose-600 hover:bg-rose-50"
          >
            {working ? <Spinner size={14} /> : null}
            إلغاء الموعد
          </button>
        )}
        {cancelled && page && (
          <a href={`/book/${page.slug}`} className="btn btn-primary w-full justify-center">
            حجز موعد جديد
            <ArrowRight size={15} />
          </a>
        )}
      </div>
    </Card>
  );
}

/* ── pieces ──────────────────────────────────────────────────────── */

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-4 rounded-3xl border border-surface-line bg-white p-5 shadow-card sm:p-7">
    {children}
  </div>
);

function Header({ page }: { page: PublicPage }) {
  return (
    <div className="grid gap-3 border-b border-surface-line pb-4">
      <div className="flex items-center gap-3">
        <Avatar name={page.owner.name} color={page.owner.avatarColor} size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-extrabold text-ink">{page.title}</h1>
          <p className="truncate text-[12.5px] text-ink-muted">
            {page.owner.name}
            {page.owner.title ? ` · ${page.owner.title}` : ''}
          </p>
        </div>
      </div>
      {page.description && (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{page.description}</p>
      )}
      <div className="flex flex-wrap gap-2 text-[11.5px] font-semibold text-ink-muted">
        <span className="chip bg-surface-sunken">
          <Clock size={13} /> {DURATION_LABEL(page.durationMinutes)}
        </span>
        {page.location && (
          <span className="chip bg-surface-sunken">
            <MapPin size={13} /> {page.location}
          </span>
        )}
        {page.onlineUrl && (
          <span className="chip bg-surface-sunken">
            <Globe2 size={13} /> عن بُعد
          </span>
        )}
      </div>
    </div>
  );
}

const Step = ({ number, label }: { number: number; label: string }) => (
  <span className="flex items-center gap-2 pt-1 text-[12.5px] font-bold text-ink">
    <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-[10px] text-white">
      {number}
    </span>
    {label}
  </span>
);

const Row = ({ icon: Icon, text }: { icon: typeof Clock; text: React.ReactNode }) => (
  <span className="flex items-center gap-2 text-[12.5px] text-ink">
    <Icon size={14} className="shrink-0 text-ink-faint" />
    {text}
  </span>
);

function IconInput({
  icon: Icon,
  value,
  onChange,
  ltr = false,
  ...rest
}: {
  icon: typeof User;
  value: string;
  onChange: (value: string) => void;
  ltr?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <span className="relative block">
      <Icon size={14} className="absolute top-1/2 start-3 -translate-y-1/2 text-ink-faint" />
      <input
        {...rest}
        className={cx('field ps-9', ltr && 'ltr')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

const Loading = () => (
  <div className="grid place-items-center gap-3 py-10">
    <Spinner size={22} />
    <span className="text-[12px] text-ink-faint">جارٍ تحميل المواعيد المتاحة…</span>
  </div>
);

const Notice = ({ tone, text }: { tone: 'bad' | 'soft'; text: string }) => (
  <p
    className={cx(
      'flex items-start gap-2 rounded-2xl px-3 py-3 text-[12.5px] font-semibold',
      tone === 'bad' ? 'bg-rose-50 text-rose-700' : 'bg-surface-sunken text-ink-muted'
    )}
  >
    <AlertCircle size={15} className="mt-px shrink-0" />
    {text}
  </p>
);
