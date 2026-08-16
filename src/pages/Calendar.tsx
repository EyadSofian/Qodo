/**
 * Qodo Calendar.
 *
 * The workspace had three things that looked like a calendar and no calendar:
 * Odoo's training courses (read-only, somebody else's data), a task due date (a
 * deadline, not an hour), and the management desk's diary (private to the
 * people who run the company, with typed names instead of invitees). This is
 * the hour-of-your-day one, and it is open to everybody — what an entry reaches
 * is decided per entry, not by rank.
 *
 * The month grid is the default because that is the question people open a
 * calendar with — "what does this week look like" — and the day list underneath
 * it is the answer to the follow-up. Both read from one fetch of the visible
 * window, so switching views costs nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import {
  KIND_LABEL,
  RESPONSE_LABEL,
  addDays,
  addMonths,
  cancelEvent,
  clockOf,
  createEvent,
  dayOf,
  draftFrom,
  emptyDraft,
  eventsOnDay,
  fetchBootstrap,
  fetchEvent,
  fetchEvents,
  monthGrid,
  patchEvent,
  sameDay,
  spanOf,
  startOfDay,
  weekGrid,
  type CalendarBootstrap,
  type CalendarEvent,
  type EventDraft,
} from '../lib/calendar';
import { EventForm } from '../components/calendar/EventForm';
import { EventDetail } from '../components/calendar/EventDetail';
import { EmptyState, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type View = 'month' | 'week' | 'day';

const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const monthFormat = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' });

export function Calendar() {
  const { user } = useAuth();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [meta, setMeta] = useState<CalendarBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openId = params.get('event');

  /** The window the current view needs, padded so a month grid's edges fill in. */
  const range = useMemo(() => {
    if (view === 'month') {
      const grid = monthGrid(anchor);
      return { from: grid[0], to: addDays(grid[grid.length - 1], 1) };
    }
    if (view === 'week') {
      const grid = weekGrid(anchor);
      return { from: grid[0], to: addDays(grid[6], 1) };
    }
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await fetchEvents(range.from, range.to));
    } catch (error) {
      push(errorMessage(error), 'bad');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, push]);

  useEffect(() => {
    fetchBootstrap()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(
    () => new Map((meta?.people ?? []).map((person) => [person.id, person])),
    [meta]
  );

  const opened = useMemo(
    () => (openId ? (events ?? []).find((event) => event.id === openId) ?? null : null),
    [openId, events]
  );

  /**
   * A notification links straight to an entry that may be outside the month the
   * page happens to be showing, so the window moves to it rather than opening a
   * dialog over an empty grid.
   */
  useEffect(() => {
    if (!openId || !events || opened) return;
    let active = true;
    fetchEvent(openId)
      .then((event) => {
        if (!active) return;
        setAnchor(startOfDay(new Date(event.startAt)));
        setSelectedDay(startOfDay(new Date(event.startAt)));
        setEvents((current) => [...(current ?? []), event]);
      })
      .catch(() => {
        if (active) setParams({}, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [openId, events, opened, setParams]);

  const replaceEvent = (event: CalendarEvent) =>
    setEvents((current) =>
      (current ?? []).map((row) => (row.id === event.id ? event : row))
    );

  const openEvent = (id: string) => setParams({ event: id });
  const closeEvent = () => setParams({});

  const startCreate = (day?: Date) => {
    setEditingId(null);
    setDraft(emptyDraft('meeting', day));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = editingId ? await patchEvent(editingId, draft) : await createEvent(draft);
      setDraft(null);
      setEditingId(null);
      await load();
      openEvent(saved.id);
      push(editingId ? 'اتعدّل.' : 'اتبعتت الدعوة.');
    } catch (error) {
      push(errorMessage(error), 'bad');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (event: CalendarEvent) => {
    if (!window.confirm(`إلغاء «${event.title}»؟ هيتبعت إشعار لكل المدعوين.`)) return;
    try {
      replaceEvent(await cancelEvent(event.id));
      push('اتلغى واتبلّغ المدعوون.');
    } catch (error) {
      push(errorMessage(error), 'bad');
    }
  };

  const step = (direction: 1 | -1) => {
    if (view === 'month') setAnchor(addMonths(anchor, direction));
    else setAnchor(addDays(anchor, direction * (view === 'week' ? 7 : 1)));
  };

  const today = () => {
    const now = startOfDay(new Date());
    setAnchor(now);
    setSelectedDay(now);
  };

  const list = events ?? [];
  const mine = useMemo(
    () =>
      list.filter(
        (event) => event.organizerId === user?.id || event.inviteeIds.includes(user?.id ?? '')
      ),
    [list, user]
  );
  const pending = mine.filter(
    (event) => event.status === 'confirmed' && event.myResponse === 'needs_action'
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">التقويم</h1>
          <p className="text-[12.5px] text-ink-muted">
            الاجتماعات والمواعيد، بدعوة ورد من كل واحد.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
            تحديث
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => startCreate()}>
            <Plus size={15} /> ميعاد جديد
          </button>
        </div>
      </header>

      {pending.length > 0 && (
        <button
          type="button"
          onClick={() => openEvent(pending[0].id)}
          className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-start text-[12.5px] font-semibold text-amber-800"
        >
          <Users size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {pending.length === 1
              ? `دعوة مستنية ردك: ${pending[0].title}`
              : `${pending.length} دعوات مستنية ردك`}
          </span>
          <span className="shrink-0 text-[11px] underline">افتح</span>
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-quiet !min-h-9 rounded-lg p-2" onClick={() => step(-1)} aria-label="السابق">
            <ChevronRight size={17} />
          </button>
          <span className="min-w-36 text-center text-[13.5px] font-bold text-ink">
            {view === 'month' ? monthFormat.format(anchor) : dayOf(anchor)}
          </span>
          <button type="button" className="btn btn-quiet !min-h-9 rounded-lg p-2" onClick={() => step(1)} aria-label="التالي">
            <ChevronLeft size={17} />
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={today}>
            النهاردة
          </button>
        </div>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'شهر' },
            { value: 'week', label: 'أسبوع' },
            { value: 'day', label: 'يوم' },
          ]}
        />
      </div>

      {view === 'month' && (
        <MonthGrid
          month={anchor}
          events={list}
          selectedDay={selectedDay}
          currentUserId={user?.id ?? ''}
          onPickDay={(day) => {
            setSelectedDay(day);
            if (day.getMonth() !== anchor.getMonth()) setAnchor(day);
          }}
          onOpen={openEvent}
        />
      )}

      {view === 'week' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {weekGrid(anchor).map((day) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              events={eventsOnDay(list, day)}
              currentUserId={user?.id ?? ''}
              onOpen={openEvent}
              onAdd={() => startCreate(day)}
            />
          ))}
        </div>
      )}

      {(view === 'day' || view === 'month') && (
        <DayList
          day={view === 'month' ? selectedDay : anchor}
          events={eventsOnDay(list, view === 'month' ? selectedDay : anchor)}
          currentUserId={user?.id ?? ''}
          loading={loading && events === null}
          onOpen={openEvent}
          onAdd={() => startCreate(view === 'month' ? selectedDay : anchor)}
        />
      )}

      <Modal
        open={Boolean(opened)}
        onClose={closeEvent}
        title={opened ? KIND_LABEL[opened.kind].ar : ''}
        width="md"
      >
        {opened && meta && (
          <EventDetail
            event={opened}
            people={people}
            currentUserId={user?.id ?? ''}
            maxFiles={meta.limits.files}
            onChanged={replaceEvent}
            onEdit={() => {
              setEditingId(opened.id);
              setDraft(draftFrom(opened));
              closeEvent();
            }}
            onCancel={() => cancel(opened)}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(draft)}
        onClose={() => {
          setDraft(null);
          setEditingId(null);
        }}
        title={editingId ? 'تعديل الميعاد' : 'ميعاد جديد'}
        width="lg"
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={saving || !draft?.title.trim()}
            >
              {saving ? <Spinner size={14} /> : null}
              {editingId ? 'حفظ' : 'إرسال الدعوة'}
            </button>
          </>
        }
      >
        {draft && meta && (
          <EventForm
            draft={draft}
            onChange={setDraft}
            people={meta.people}
            currentUserId={user?.id ?? ''}
            reminderChoices={meta.reminderChoices}
            maxInvitees={meta.limits.invitees}
            lockKind={Boolean(editingId)}
            editingId={editingId}
          />
        )}
      </Modal>
    </div>
  );
}

function MonthGrid({
  month,
  events,
  selectedDay,
  currentUserId,
  onPickDay,
  onOpen,
}: {
  month: Date;
  events: CalendarEvent[];
  selectedDay: Date;
  currentUserId: string;
  onPickDay: (day: Date) => void;
  onOpen: (id: string) => void;
}) {
  const days = monthGrid(month);
  const now = new Date();

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-surface-line bg-surface-sunken/60">
        {WEEKDAYS.map((label) => (
          <span key={label} className="px-1 py-2 text-center text-[10.5px] font-bold text-ink-muted">
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOnDay(events, day);
          const outside = day.getMonth() !== month.getMonth();
          const isToday = sameDay(day, now);
          const picked = sameDay(day, selectedDay);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              className={cx(
                'min-h-20 border-b border-s border-surface-line p-1.5 text-start align-top transition sm:min-h-24',
                outside && 'bg-surface-sunken/40 text-ink-faint',
                picked ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-surface-sunken/60'
              )}
            >
              <span
                className={cx(
                  'mb-1 inline-grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold',
                  isToday ? 'bg-brand-500 text-white' : outside ? 'text-ink-faint' : 'text-ink'
                )}
              >
                {day.getDate()}
              </span>
              <span className="grid gap-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onOpen(event.id);
                    }}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === 'Enter') {
                        keyEvent.stopPropagation();
                        onOpen(event.id);
                      }
                    }}
                    className={cx(
                      'block truncate rounded-md px-1 py-0.5 text-[9.5px] font-semibold',
                      event.status === 'cancelled'
                        ? 'bg-surface-sunken text-ink-faint line-through'
                        : event.organizerId === currentUserId ||
                            event.inviteeIds.includes(currentUserId)
                          ? 'bg-brand-100 text-brand-800'
                          : 'bg-surface-sunken text-ink-muted'
                    )}
                    title={event.title}
                  >
                    {!event.allDay && <span className="ltr opacity-70">{clockOf(event.startAt)} </span>}
                    {event.title}
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1 text-[9.5px] font-bold text-ink-faint">
                    +{dayEvents.length - 3}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  currentUserId,
  onOpen,
  onAdd,
}: {
  day: Date;
  events: CalendarEvent[];
  currentUserId: string;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="card p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className={cx('text-[12.5px] font-bold', sameDay(day, new Date()) ? 'text-brand-600' : 'text-ink')}>
          {dayOf(day)}
        </h3>
        <button type="button" onClick={onAdd} className="btn btn-quiet !min-h-8 rounded-lg p-1.5" aria-label="إضافة">
          <Plus size={14} />
        </button>
      </header>
      {events.length === 0 ? (
        <p className="py-2 text-[11.5px] text-ink-faint">فاضي.</p>
      ) : (
        <ul className="grid gap-1.5">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} currentUserId={currentUserId} onOpen={onOpen} compact />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayList({
  day,
  events,
  currentUserId,
  loading,
  onOpen,
  onAdd,
}: {
  day: Date;
  events: CalendarEvent[];
  currentUserId: string;
  loading: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section className="card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13.5px] font-bold text-ink">{dayOf(day)}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}>
          <Plus size={14} /> أضف
        </button>
      </header>
      {loading ? (
        <p className="flex items-center gap-2 py-4 text-[12px] text-ink-faint">
          <Spinner size={15} /> جارٍ التحميل…
        </p>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={30} />}
          title="مفيش حاجة في اليوم ده"
          body="اليوم فاضي. تقدر تحجز اجتماع أو تسجّل موعد."
        />
      ) : (
        <ul className="grid gap-2">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} currentUserId={currentUserId} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({
  event,
  currentUserId,
  onOpen,
  compact = false,
}: {
  event: CalendarEvent;
  currentUserId: string;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  const involved = event.organizerId === currentUserId || event.inviteeIds.includes(currentUserId);
  const cancelled = event.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className={cx(
        'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-start transition',
        cancelled
          ? 'border-surface-line bg-surface-sunken/50 opacity-70'
          : involved
            ? 'border-brand-200 bg-brand-50/60 hover:border-brand-400'
            : 'border-surface-line bg-white hover:border-brand-200'
      )}
    >
      <span
        className={cx(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
          cancelled ? 'bg-surface-sunken text-ink-faint' : 'bg-brand-500/10 text-brand-600'
        )}
      >
        {event.kind === 'meeting' ? <Users size={15} /> : <CalendarDays size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[12.5px] font-bold text-ink', cancelled && 'line-through')}>
          {event.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-muted">
          <span className="ltr flex items-center gap-1">
            <Clock size={11} />
            {spanOf(event)}
          </span>
          {event.location && !compact && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin size={11} />
              <span className="truncate">{event.location}</span>
            </span>
          )}
          {event.kind === 'meeting' && (
            <span className="flex items-center gap-1">
              <Users size={11} />
              {event.inviteeIds.length + 1}
            </span>
          )}
        </span>
      </span>
      {event.myResponse && !cancelled && (
        <span className={cx('chip shrink-0 text-[10px]', RESPONSE_LABEL[event.myResponse].tone)}>
          {RESPONSE_LABEL[event.myResponse].ar}
        </span>
      )}
    </button>
  );
}
