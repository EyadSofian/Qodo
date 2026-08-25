import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  LayoutGrid,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { errorMessage } from '../lib/api';
import {
  byZone,
  officesApi,
  zoneCounts,
  type Office,
  type OfficeBootstrap,
  type OfficeLayout,
  type OfficePlan,
  type OfficeSeat,
  type SeatPatch,
  type SeatState,
} from '../lib/offices';
import { getDepartment } from '@shared/departments';
import { Avatar, EmptyState, Field, Modal, Segmented, useToast } from '../components/ui';
import { cx } from '../lib/utils';

/**
 * The seating plan.
 *
 * Two ways of drawing the same seats, because the inventory answers "who sits
 * where" long before anybody has measured a room. The schematic needs nothing
 * but the desks; the scaled plan needs the room's metres and a coordinate on
 * every desk, and a room missing either falls back to the schematic rather than
 * drawing a floor with holes in it.
 */
export function Offices() {
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [plan, setPlan] = useState<OfficePlan | null>(null);
  const [meta, setMeta] = useState<OfficeBootstrap | null>(null);
  const [layout, setLayout] = useState<OfficeLayout>('grid');
  const [zone, setZone] = useState<string>('all');
  const [seatOpen, setSeatOpen] = useState<{ office: Office; seat: OfficeSeat } | null>(null);
  const [roomOpen, setRoomOpen] = useState<Office | 'new' | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);

  const canManage = meta?.canManage ?? false;

  useEffect(() => {
    let active = true;
    Promise.all([officesApi.plan(), officesApi.bootstrap()])
      .then(([nextPlan, nextMeta]) => {
        if (!active) return;
        setPlan(nextPlan);
        setMeta(nextMeta);
      })
      .catch((error) => active && push(errorMessage(error, lang), 'bad'));
    return () => {
      active = false;
    };
  }, [lang, push]);

  /** Every mutation answers with the whole plan, so nothing is patched by hand. */
  const run = useCallback(
    async (work: () => Promise<OfficePlan>) => {
      try {
        setPlan(await work());
        return true;
      } catch (error) {
        push(errorMessage(error, lang), 'bad');
        return false;
      }
    },
    [lang, push]
  );

  const zones = useMemo(() => plan?.zones ?? [], [plan]);
  const shown = useMemo(() => {
    const offices = plan?.offices ?? [];
    return zone === 'all' ? offices : offices.filter((office) => office.zone === zone);
  }, [plan, zone]);

  if (!plan) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-9">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton mt-4 h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-9">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-extrabold text-ink sm:text-[26px]">
            <Building2 size={22} className="text-brand-500" />
            {t('offices.title')}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">{t('offices.subtitle')}</p>
        </div>
        {canManage && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setRoomOpen('new')}>
            <Plus size={15} />
            {t('offices.addRoom')}
          </button>
        )}
      </header>

      <Summary plan={plan} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Segmented<OfficeLayout>
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'grid', label: t('offices.viewGrid'), icon: <LayoutGrid size={14} /> },
            { value: 'plan', label: t('offices.viewPlan'), icon: <Ruler size={14} /> },
          ]}
        />
        {zones.length > 1 && (
          <Segmented<string>
            value={zone}
            onChange={setZone}
            options={[
              { value: 'all', label: t('common.all') },
              ...zones.map((name) => ({ value: name, label: name })),
            ]}
          />
        )}
      </div>

      {shown.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            icon={<Building2 size={26} />}
            title={t('offices.emptyTitle')}
            body={canManage ? t('offices.emptyBodyManage') : t('offices.emptyBody')}
          />
        </div>
      ) : (
        byZone(shown).map((group) => (
          <ZoneSection
            key={group.zone}
            zone={group.zone}
            offices={group.offices}
            layout={layout}
            canManage={canManage}
            placing={placing}
            onSeat={(office, seat) => setSeatOpen({ office, seat })}
            onEditRoom={(office) => setRoomOpen(office)}
            onAddSeats={(office) => run(() => officesApi.addSeats(office.id, 1))}
            onPlace={async (office, seat, point) => {
              const ok = await run(() => officesApi.updateSeat(office.id, seat.id, { point }));
              if (ok) setPlacing(null);
            }}
          />
        ))
      )}

      {plan.unlinked.length > 0 && <Unlinked plan={plan} canManage={canManage} />}

      {seatOpen && meta && (
        <SeatPanel
          office={seatOpen.office}
          seat={seatOpen.seat}
          meta={meta}
          canManage={canManage}
          onClose={() => setSeatOpen(null)}
          onPlaceOnPlan={() => {
            setPlacing(seatOpen.seat.id);
            setSeatOpen(null);
            setLayout('plan');
          }}
          onSave={async (patch) => {
            const ok = await run(() => officesApi.updateSeat(seatOpen.office.id, seatOpen.seat.id, patch));
            if (ok) setSeatOpen(null);
          }}
          onRemove={async () => {
            const ok = await run(() => officesApi.removeSeat(seatOpen.office.id, seatOpen.seat.id));
            if (ok) setSeatOpen(null);
          }}
        />
      )}

      {roomOpen && meta && (
        <RoomForm
          office={roomOpen === 'new' ? null : roomOpen}
          meta={meta}
          zones={zones}
          onClose={() => setRoomOpen(null)}
          onSave={async (body, seats) => {
            const ok = await run(() =>
              roomOpen === 'new'
                ? officesApi.createOffice({ ...body, seats })
                : officesApi.updateOffice(roomOpen.id, body)
            );
            if (ok) setRoomOpen(null);
          }}
          onDelete={
            roomOpen === 'new'
              ? undefined
              : async () => {
                  const ok = await run(() => officesApi.deleteOffice(roomOpen.id));
                  if (ok) setRoomOpen(null);
                }
          }
        />
      )}
    </div>
  );
}

/* ── summary ─────────────────────────────────────────────────────── */

function Summary({ plan }: { plan: OfficePlan }) {
  const { t } = useI18n();
  const { summary } = plan;
  // The room holding the most empty desks. A single "29 available" hides that
  // most of it is in one place, which is the thing anybody planning a move
  // actually needs to know.
  const emptiest = [...plan.offices]
    .filter((office) => office.kind === 'workroom')
    .sort((a, b) => b.counts.free - a.counts.free)[0];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label={t('offices.statUnits')} value={summary.units} />
      <Stat label={t('offices.statOccupied')} value={summary.occupied} tone="info" />
      <Stat label={t('offices.statFree')} value={summary.free} tone="ok" />
      <div className="card flex flex-col justify-center gap-1 px-4 py-3.5">
        <span className="text-[12px] font-semibold text-ink-muted">{t('offices.statOccupancy')}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold tabular-nums text-ink">
            {summary.occupancyPercent}%
          </span>
          {emptiest && emptiest.counts.free > 0 && (
            <span className="truncate text-[11.5px] text-ink-faint">
              {t('offices.emptiest', { room: emptiest.nameAr, n: emptiest.counts.free })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'info' | 'ok' }) {
  const tones = { info: 'text-brand-600', ok: 'text-status-ok' };
  return (
    <div className="card flex flex-col justify-center gap-1 px-4 py-3.5">
      <span className="text-[12px] font-semibold text-ink-muted">{label}</span>
      <span
        className={cx('text-2xl font-extrabold tabular-nums', tone ? tones[tone] : 'text-ink')}
      >
        {value}
      </span>
    </div>
  );
}

/* ── zones and rooms ─────────────────────────────────────────────── */

interface ZoneProps {
  zone: string;
  offices: Office[];
  layout: OfficeLayout;
  canManage: boolean;
  placing: string | null;
  onSeat: (office: Office, seat: OfficeSeat) => void;
  onEditRoom: (office: Office) => void;
  onAddSeats: (office: Office) => void;
  onPlace: (office: Office, seat: OfficeSeat, point: { x: number; y: number }) => void;
}

function ZoneSection({ zone, offices, ...rest }: ZoneProps) {
  const { t } = useI18n();
  const counts = zoneCounts(offices.filter((office) => office.kind === 'workroom'));

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-bold text-ink">{zone}</h2>
        <p className="text-[12px] tabular-nums text-ink-faint">
          {t('offices.zoneCounts', {
            rooms: offices.length,
            units: counts.units,
            occupied: counts.occupied,
            free: counts.free,
          })}
        </p>
      </div>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {offices.map((office) => (
          <RoomCard key={office.id} office={office} {...rest} />
        ))}
      </div>
    </section>
  );
}

function RoomCard({
  office,
  layout,
  canManage,
  placing,
  onSeat,
  onEditRoom,
  onAddSeats,
  onPlace,
}: Omit<ZoneProps, 'zone' | 'offices'> & { office: Office }) {
  const { t, lang } = useI18n();
  const department = office.department ? getDepartment(office.department) : null;
  const color = department?.color ?? '#94A3B8';
  // A room is only drawn to scale once it is measured *and* every desk is
  // placed. Half a plan reads as a room with desks missing, so it falls back.
  const scaled = layout === 'plan' && office.plan.ready;

  return (
    <article className="card flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">
          {lang === 'en' && office.nameEn ? office.nameEn : office.nameAr}
        </h3>
        {department && (
          <span className="hidden text-[11.5px] text-ink-faint sm:inline">
            {lang === 'en' ? department.en : department.ar}
          </span>
        )}
        <span className="text-[14px] font-extrabold tabular-nums text-ink ltr">
          {office.counts.occupied}
          <span className="text-[12px] font-semibold text-ink-faint">/{office.counts.units}</span>
        </span>
        {canManage && (
          <button
            type="button"
            className="btn-quiet btn-sm !min-h-0 !px-1.5 !py-1"
            onClick={() => onEditRoom(office)}
            aria-label={t('offices.editRoom')}
            title={t('offices.editRoom')}
          >
            <Pencil size={14} />
          </button>
        )}
      </header>

      {office.counts.free > 0 && (
        <p className="-mt-1.5 text-[11.5px] font-bold text-brand-500">
          {t('offices.freeHere', { n: office.counts.free })}
        </p>
      )}

      {office.kind !== 'workroom' ? (
        <p className="text-[13px] text-ink-faint">{t('offices.noDesks')}</p>
      ) : scaled ? (
        <ScaledPlan
          office={office}
          color={color}
          canManage={canManage}
          placing={placing}
          onSeat={onSeat}
          onPlace={onPlace}
        />
      ) : (
        <>
          <SeatGrid office={office} color={color} onSeat={onSeat} />
          {layout === 'plan' && <PlanGap office={office} />}
        </>
      )}

      {office.note && (
        <p className="rounded-lg bg-surface-sunken px-2.5 py-1.5 text-[11.5px] text-ink-muted">
          <span className="font-bold">{t('offices.planned')}</span> · {office.note}
        </p>
      )}

      {canManage && office.kind === 'workroom' && (
        <button
          type="button"
          className="btn-ghost btn-sm self-start"
          onClick={() => onAddSeats(office)}
        >
          <Plus size={14} />
          {t('offices.addDesk')}
        </button>
      )}
    </article>
  );
}

/** What is still missing before this room can be drawn to scale. */
function PlanGap({ office }: { office: Office }) {
  const { t } = useI18n();
  const message = !office.plan.measured
    ? t('offices.notMeasured')
    : t('offices.notPlaced', { placed: office.plan.placed, total: office.plan.total });
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-accent-600">
      <Ruler size={13} />
      {message}
    </p>
  );
}

/* ── the schematic ───────────────────────────────────────────────── */

function SeatGrid({
  office,
  color,
  onSeat,
}: {
  office: Office;
  color: string;
  onSeat: (office: Office, seat: OfficeSeat) => void;
}) {
  if (office.seats.length === 0) {
    return <p className="text-[13px] text-ink-faint">—</p>;
  }
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, 30px)' }}>
      {office.seats.map((seat) => (
        <SeatChip key={seat.id} seat={seat} color={color} onClick={() => onSeat(office, seat)} />
      ))}
    </div>
  );
}

/**
 * One desk.
 *
 * State is carried by shape and content as well as colour — filled with an
 * initial, dashed and empty, dotted with a plus — so the plan still reads for
 * somebody who cannot separate the department hues.
 */
function SeatChip({
  seat,
  color,
  onClick,
  style,
  className,
}: {
  seat: OfficeSeat;
  color: string;
  onClick: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  const { t } = useI18n();
  const name = seat.occupantName;
  const label =
    seat.state === 'occupied'
      ? `${seat.label} — ${name}`
      : `${seat.label} — ${t(`offices.state.${seat.state}`)}`;

  const shared = 'grid h-[30px] w-[30px] place-items-center rounded-lg text-[11.5px] font-bold transition-transform hover:scale-[1.08]';

  if (seat.state === 'occupied') {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className={cx(shared, 'text-ink', className)}
        style={{ border: `1.5px solid ${color}`, background: `${color}24`, ...style }}
      >
        {name ? [...name.trim()][0] : '•'}
      </button>
    );
  }

  const tones: Record<Exclude<SeatState, 'occupied'>, string> = {
    free: 'border-[1.5px] border-dashed border-surface-line text-ink-faint hover:border-brand-300',
    reserved: 'border-[1.5px] border-dotted border-accent-500 bg-accent-50 text-accent-600',
    blocked: 'border-[1.5px] border-surface-line bg-surface-sunken text-ink-faint line-through',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx(shared, tones[seat.state as Exclude<SeatState, 'occupied'>], className)}
      style={style}
    >
      {seat.state === 'reserved' ? '+' : ''}
    </button>
  );
}

/* ── the room, to scale ──────────────────────────────────────────── */

/**
 * The room drawn at its real proportions, desks at their real coordinates.
 *
 * Positions are percentages of the room's own metres, so the drawing is correct
 * at any width and needs no viewport arithmetic.
 *
 * `left` rather than `inset-inline-start`, and deliberately so — this is the
 * one place in the app that must NOT flip with the page direction. The
 * schematic's order is reading order and mirrors correctly with the language;
 * a floor plan is a physical room, and a plan that mirrors when somebody
 * switches to English is a plan that matches the building for half its readers.
 * x = 0 is one fixed corner of the room, whatever language you read it in.
 */
function ScaledPlan({
  office,
  color,
  canManage,
  placing,
  onSeat,
  onPlace,
}: {
  office: Office;
  color: string;
  canManage: boolean;
  placing: string | null;
  onSeat: (office: Office, seat: OfficeSeat) => void;
  onPlace: (office: Office, seat: OfficeSeat, point: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();
  const size = office.dimensions!;
  const target = placing ? office.seats.find((seat) => seat.id === placing) : null;

  const place = (event: MouseEvent<HTMLDivElement>) => {
    if (!target || !canManage) return;
    const box = event.currentTarget.getBoundingClientRect();
    onPlace(office, target, {
      x: Math.max(0, Math.min(size.width, ((event.clientX - box.left) / box.width) * size.width)),
      y: Math.max(0, Math.min(size.height, ((event.clientY - box.top) / box.height) * size.height)),
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        onClick={place}
        role={target ? 'button' : undefined}
        tabIndex={target ? 0 : undefined}
        dir="ltr"
        className={cx(
          'relative w-full overflow-hidden rounded-xl border-2 border-surface-line bg-surface-sunken',
          target && 'cursor-crosshair ring-2 ring-brand-300'
        )}
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {office.seats.map((seat) =>
          seat.point ? (
            <SeatChip
              key={seat.id}
              seat={seat}
              color={color}
              onClick={() => onSeat(office, seat)}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(seat.point.x / size.width) * 100}%`,
                top: `${(seat.point.y / size.height) * 100}%`,
              }}
            />
          ) : null
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-faint ltr">
        <Ruler size={12} />
        {size.width} × {size.height} {t('offices.metres')}
      </p>
    </div>
  );
}

/* ── the seat panel ──────────────────────────────────────────────── */

function SeatPanel({
  office,
  seat,
  meta,
  canManage,
  onClose,
  onSave,
  onRemove,
  onPlaceOnPlan,
}: {
  office: Office;
  seat: OfficeSeat;
  meta: OfficeBootstrap;
  canManage: boolean;
  onClose: () => void;
  onSave: (patch: SeatPatch) => void;
  onRemove: () => void;
  onPlaceOnPlan: () => void;
}) {
  const { t, lang } = useI18n();
  const { directory } = useWorkspace();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return directory.slice(0, 8);
    return directory
      .filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [directory, query]);

  const save = async (patch: SeatPatch) => {
    setBusy(true);
    await onSave(patch);
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title={`${office.nameAr} · ${seat.label}`} width="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-surface-sunken px-3 py-2.5">
          {seat.occupant ? (
            <Avatar name={seat.occupant.name} color={seat.occupant.avatarColor} size={34} />
          ) : (
            <span className="grid h-[34px] w-[34px] place-items-center rounded-full border border-dashed border-surface-line text-ink-faint">
              <MapPin size={15} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold text-ink">
              {seat.occupantName ?? t(`offices.state.${seat.state}`)}
            </span>
            {seat.occupant ? (
              <Link
                to={`/people/${seat.occupant.id}`}
                className="text-[12px] text-brand-500 hover:underline"
              >
                {t('offices.openProfile')}
              </Link>
            ) : (
              <span className="text-[12px] text-ink-faint">
                {t(`offices.state.${seat.state}`)}
              </span>
            )}
          </span>
        </div>

        {!canManage ? (
          <p className="text-[13px] text-ink-muted">{t('offices.readOnly')}</p>
        ) : (
          <>
            {seat.occupantName ? (
              <button
                type="button"
                className="btn-ghost btn-sm self-start"
                disabled={busy}
                onClick={() => save({ userId: null, occupantName: null })}
              >
                <X size={14} />
                {t('offices.clearSeat')}
              </button>
            ) : (
              <>
                <Field label={t('offices.seatPerson')} hint={t('offices.seatPersonHint')}>
                  <input
                    className="field"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('common.search')}
                  />
                </Field>
                <div className="flex flex-col gap-1">
                  {matches.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      disabled={busy}
                      onClick={() => save({ userId: person.id })}
                      className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-surface-sunken"
                    >
                      <Avatar name={person.name} color={person.avatarColor} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {person.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-faint">
                          {person.title ?? person.email}
                        </span>
                      </span>
                      <UserPlus size={14} className="text-ink-faint" />
                    </button>
                  ))}
                </div>

                <Field label={t('offices.seatName')} hint={t('offices.seatNameHint')}>
                  <div className="flex gap-2">
                    <input
                      className="field"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy || !name.trim()}
                      onClick={() => save({ occupantName: name.trim() })}
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </Field>

                <Field label={t('offices.seatState')}>
                  <div className="flex flex-wrap gap-2">
                    {meta.settableStates.map((state) => (
                      <button
                        key={state}
                        type="button"
                        disabled={busy}
                        onClick={() => save({ status: state as Exclude<SeatState, 'occupied'> })}
                        className={cx(
                          'chip border',
                          seat.state === state
                            ? 'border-brand-400 bg-brand-50 text-brand-600'
                            : 'border-surface-line bg-white text-ink-muted'
                        )}
                      >
                        {t(`offices.state.${state}`)}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            <div className="flex flex-wrap gap-2 border-t border-surface-line pt-3">
              {office.plan.measured && (
                <button type="button" className="btn-ghost btn-sm" onClick={onPlaceOnPlan}>
                  <MapPin size={14} />
                  {seat.point ? t('offices.movePlacement') : t('offices.placeOnPlan')}
                </button>
              )}
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={busy || seat.state === 'occupied'}
                onClick={onRemove}
                title={seat.state === 'occupied' ? t('offices.cannotRemoveSeat') : undefined}
              >
                <Trash2 size={14} />
                {t('offices.removeDesk')}
              </button>
            </div>
            {lang === 'ar' && seat.point && (
              <p className="text-[11.5px] text-ink-faint ltr">
                x {seat.point.x} · y {seat.point.y}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ── the room form ───────────────────────────────────────────────── */

function RoomForm({
  office,
  meta,
  zones,
  onClose,
  onSave,
  onDelete,
}: {
  office: Office | null;
  meta: OfficeBootstrap;
  zones: string[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>, seats?: number) => void;
  onDelete?: () => void;
}) {
  const { t, lang } = useI18n();
  const [nameAr, setNameAr] = useState(office?.nameAr ?? '');
  const [zone, setZone] = useState(office?.zone ?? zones[0] ?? '');
  const [department, setDepartment] = useState(office?.department ?? '');
  const [kind, setKind] = useState(office?.kind ?? 'workroom');
  const [seats, setSeats] = useState('0');
  const [width, setWidth] = useState(office?.dimensions ? String(office.dimensions.width) : '');
  const [height, setHeight] = useState(office?.dimensions ? String(office.dimensions.height) : '');
  const [note, setNote] = useState(office?.note ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const measured = width.trim() !== '' && height.trim() !== '';
    await onSave(
      {
        nameAr: nameAr.trim(),
        zone: zone.trim(),
        department: department || null,
        kind,
        note: note.trim() || null,
        // An empty pair clears the measurement rather than leaving a stale one:
        // a room that was re-partitioned is better unmeasured than wrong.
        dimensions: measured ? { width: Number(width), height: Number(height) } : null,
      },
      office ? undefined : Number(seats) || undefined
    );
    setBusy(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={office ? t('offices.editRoom') : t('offices.addRoom')}
      width="md"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={submit}>
            {t('common.save')}
          </button>
          <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {onDelete && (
            <button
              type="button"
              className="btn-danger btn-sm ms-auto"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={14} />
              {t('common.delete')}
            </button>
          )}
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('offices.roomName')} required>
          <input className="field" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('offices.zone')} required hint={t('offices.zoneHint')}>
          <input
            className="field"
            list="office-zones"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
          <datalist id="office-zones">
            {zones.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label={t('offices.department')}>
          <select
            className="field"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">{t('common.none')}</option>
            {meta.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {lang === 'en' ? item.en : item.ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('offices.kind')}>
          <select
            className="field"
            value={kind}
            onChange={(e) => setKind(e.target.value as Office['kind'])}
          >
            {meta.kinds.map((item) => (
              <option key={item.id} value={item.id}>
                {lang === 'en' ? item.en : item.ar}
              </option>
            ))}
          </select>
        </Field>
        {!office && (
          <Field label={t('offices.deskCount')} hint={t('offices.deskCountHint')}>
            <input
              className="field ltr"
              type="number"
              min={0}
              max={meta.limits.seatsPerRequest}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </Field>
        )}
        <Field label={t('offices.dimensions')} hint={t('offices.dimensionsHint')}>
          <div className="flex items-center gap-2">
            <input
              className="field ltr"
              type="number"
              min={1}
              step="0.1"
              placeholder="6.4"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
            <span className="text-ink-faint">×</span>
            <input
              className="field ltr"
              type="number"
              min={1}
              step="0.1"
              placeholder="4.2"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('offices.note')} hint={t('offices.noteHint')}>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ── names that never found an account ───────────────────────────── */

function Unlinked({ plan, canManage }: { plan: OfficePlan; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <section className="card mt-7 p-4">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
        <Link2 size={16} className="text-accent-500" />
        {t('offices.unlinkedTitle', { n: plan.unlinked.length })}
      </h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        {canManage ? t('offices.unlinkedBodyManage') : t('offices.unlinkedBody')}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {plan.unlinked.map((entry) => (
          <span key={entry.seatId} className="chip bg-surface-sunken text-ink-muted">
            {entry.name}
            <span className="text-ink-faint">· {entry.officeName}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
