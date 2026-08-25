import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Building2,
  HelpCircle,
  LayoutGrid,
  Minus,
  Link2,
  MapPin,
  Pencil,
  Plus,
  RotateCw,
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
  type OfficePatch,
  type OfficePlan,
  type OfficeSeat,
  type Point,
  type SeatPatch,
  type SeatState,
  type ShapePreset,
} from '../lib/offices';
import { getDepartment } from '@shared/departments';
import { outlinePoints, presetOutline, roomOutline } from '@shared/offices';
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
  // Off by default even for a manager: most visits are somebody looking up
  // where a colleague sits, and a page full of inputs is a worse answer.
  const [editing, setEditing] = useState(false);
  // Straight on. The room reads as a room the moment it is turned at all, but
  // starting square keeps the first glance comparable with the flat plan.
  const [tilt, setTilt] = useState(0);

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={editing ? 'btn-navy btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setEditing((on) => !on)}
              aria-pressed={editing}
            >
              <Pencil size={15} />
              {editing ? t('offices.editingOn') : t('offices.edit')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setRoomOpen('new')}>
              <Plus size={15} />
              {t('offices.addRoom')}
            </button>
          </div>
        )}
      </header>

      {editing && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[12.5px] text-brand-700">
          <Pencil size={14} className="shrink-0" />
          {t('offices.editingHint')}
        </p>
      )}

      <Summary plan={plan} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Segmented<OfficeLayout>
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'grid', label: t('offices.viewGrid'), icon: <LayoutGrid size={14} /> },
            { value: 'plan', label: t('offices.viewPlan'), icon: <Ruler size={14} /> },
            { value: 'space', label: t('offices.viewSpace'), icon: <Box size={14} /> },
          ]}
        />
        {layout === 'space' && (
          <label className="flex items-center gap-2 rounded-xl border border-surface-line bg-white px-3 py-2">
            <RotateCw size={14} className="shrink-0 text-ink-faint" />
            <span className="sr-only">{t('offices.rotate')}</span>
            <input
              type="range"
              min={-45}
              max={45}
              step={1}
              value={tilt}
              aria-label={t('offices.rotate')}
              onChange={(event) => setTilt(Number(event.target.value))}
              className="h-1 w-28 cursor-pointer accent-brand-500"
            />
          </label>
        )}
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

      {layout !== 'grid' && (
        <p className="mt-3 text-[12px] text-ink-faint">
          {layout === 'space'
            ? t('offices.spaceHint')
            : canManage
              ? t('offices.dragHint')
              : ''}
        </p>
      )}

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
            editing={editing}
            meta={meta}
            placing={placing}
            tilt={tilt}
            onSeat={(office, seat) => setSeatOpen({ office, seat })}
            onEditRoom={(office) => setRoomOpen(office)}
            onPatchRoom={(office, patch) => run(() => officesApi.updateOffice(office.id, patch))}
            onDeleteRoom={(office) => run(() => officesApi.deleteOffice(office.id))}
            onAddSeats={(office) => run(() => officesApi.addSeats(office.id, 1))}
            onRemoveLastSeat={(office) => {
              // The last desk nobody is on — matching what the stepper offers.
              const seat = [...office.seats].reverse().find((row) => row.state !== 'occupied');
              if (seat) run(() => officesApi.removeSeat(office.id, seat.id));
            }}
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
  editing: boolean;
  meta: OfficeBootstrap | null;
  placing: string | null;
  /** How far the 3D view is turned, in degrees. Ignored by the other two. */
  tilt: number;
  onSeat: (office: Office, seat: OfficeSeat) => void;
  onEditRoom: (office: Office) => void;
  onPatchRoom: (office: Office, patch: OfficePatch) => Promise<boolean> | void;
  onDeleteRoom: (office: Office) => void;
  onAddSeats: (office: Office) => void;
  onRemoveLastSeat: (office: Office) => void;
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
  editing,
  meta,
  placing,
  tilt,
  onSeat,
  onEditRoom,
  onPatchRoom,
  onDeleteRoom,
  onAddSeats,
  onRemoveLastSeat,
  onPlace,
}: Omit<ZoneProps, 'zone' | 'offices'> & { office: Office }) {
  const { t, lang } = useI18n();
  const department = office.department ? getDepartment(office.department) : null;
  const color = department?.color ?? '#94A3B8';
  // A room is only drawn to scale — flat or in 3D — once it is measured *and*
  // every desk is placed. Half a plan reads as a room with desks missing, so it
  // falls back to the schematic instead.
  const scaled = layout !== 'grid' && office.plan.ready;

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
        {canManage && !editing && (
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
          editing={editing}
          placing={placing}
          layout={layout}
          tilt={tilt}
          onSeat={onSeat}
          onPlace={onPlace}
          onPatchRoom={onPatchRoom}
        />
      ) : (
        <>
          <SeatGrid office={office} color={color} onSeat={onSeat} />
          {layout !== 'grid' && <PlanGap office={office} />}
        </>
      )}

      {office.note && !editing && (
        <p className="rounded-lg bg-surface-sunken px-2.5 py-1.5 text-[11.5px] text-ink-muted">
          <span className="font-bold">{t('offices.planned')}</span> · {office.note}
        </p>
      )}

      {canManage && editing && meta && (
        <RoomEditor
          office={office}
          meta={meta}
          onPatch={(patch) => onPatchRoom(office, patch)}
          onAddSeats={() => onAddSeats(office)}
          onRemoveLastSeat={() => onRemoveLastSeat(office)}
          onDelete={() => onDeleteRoom(office)}
        />
      )}

      {canManage && !editing && office.kind === 'workroom' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onAddSeats(office)}>
            <Plus size={14} />
            {t('offices.addDesk')}
          </button>
          {/* Offered wherever the room is, not only inside the view that needs
              it — an unmeasured room is a hole somebody has to fill, and
              hiding the way to fill it behind a tab is how it stays open. */}
          {!office.plan.measured && (
            <button
              type="button"
              className="btn-ghost btn-sm !text-accent-600"
              onClick={() => onEditRoom(office)}
            >
              <Ruler size={14} />
              {t('offices.measureRoom')}
            </button>
          )}
        </div>
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

/* ── editing in place ────────────────────────────────────────────── */

/**
 * A field that saves where it stands.
 *
 * Enter and blur commit, Escape puts back what was there. Nothing is written
 * while the value is unchanged, so tabbing across a room's fields does not file
 * a row of no-op edits into the activity log.
 */
function InlineField({
  value,
  onCommit,
  placeholder,
  type = 'text',
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  // A save elsewhere on the page re-renders this card; the field has to follow
  // the new truth rather than keep showing what was typed before it.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft.trim() === value.trim()) return;
    onCommit(draft.trim());
  };

  return (
    <input
      type={type}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          // Blur without committing — the draft is already back to the value.
          requestAnimationFrame(() => event.currentTarget?.blur());
        }
      }}
      className={cx(
        'w-full rounded-lg border border-surface-line bg-white px-2 py-1 text-[13px] text-ink',
        'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
        className
      )}
    />
  );
}

/** − n + on the room card: the desk count, adjusted where it is read. */
function DeskStepper({
  office,
  onAdd,
  onRemoveLast,
}: {
  office: Office;
  onAdd: () => void;
  onRemoveLast: () => void;
}) {
  const { t } = useI18n();
  // Only an empty desk may go. Removing the last one when somebody is on it
  // would be an eviction dressed up as a count.
  const removable = [...office.seats].reverse().find((seat) => seat.state !== 'occupied');

  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-surface-line bg-white p-0.5">
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken disabled:opacity-40"
        disabled={!removable}
        onClick={onRemoveLast}
        aria-label={t('offices.removeDesk')}
        title={removable ? t('offices.removeDesk') : t('offices.cannotRemoveSeat')}
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[2ch] text-center text-[13px] font-bold tabular-nums text-ink">
        {office.counts.units}
      </span>
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken"
        onClick={onAdd}
        aria-label={t('offices.addDesk')}
        title={t('offices.addDesk')}
      >
        <Plus size={14} />
      </button>
    </span>
  );
}

/**
 * The editable half of a room card.
 *
 * Shown only in edit mode, and always in full — including the metres for a room
 * nobody has measured. That empty pair is the point: it is the hole م. طه has to
 * fill, sitting on the room it belongs to rather than behind a menu.
 */
function RoomEditor({
  office,
  meta,
  onPatch,
  onAddSeats,
  onRemoveLastSeat,
  onDelete,
}: {
  office: Office;
  meta: OfficeBootstrap;
  onPatch: (patch: OfficePatch) => void;
  onAddSeats: () => void;
  onRemoveLastSeat: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  const size = office.dimensions;

  /** Both metres travel together — half a measurement is not a measurement. */
  const commitSize = (width: string, height: string) => {
    const w = Number(width);
    const h = Number(height);
    if (!width.trim() || !height.trim()) return onPatch({ dimensions: null });
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    onPatch({ dimensions: { width: w, height: h } });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-dashed border-surface-line bg-surface-sunken/60 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-ink-muted">
            {t('offices.roomName')}
          </span>
          <InlineField
            value={office.nameAr}
            ariaLabel={t('offices.roomName')}
            onCommit={(next) => next && onPatch({ nameAr: next })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-ink-muted">
            {t('offices.department')}
          </span>
          <select
            className="w-full rounded-lg border border-surface-line bg-white px-2 py-1 text-[13px] text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            value={office.department ?? ''}
            onChange={(event) => onPatch({ department: event.target.value || null })}
          >
            <option value="">{t('offices.departmentUnset')}</option>
            {meta.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {lang === 'en' ? item.en : item.ar}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-[11px] font-bold text-ink-muted">
            {t('offices.dimensions')}
            {!size && <span className="ms-1.5 text-accent-600">· {t('offices.missing')}</span>}
          </span>
          <div className="flex items-center gap-1.5 ltr">
            <InlineField
              type="number"
              value={size ? String(size.width) : ''}
              placeholder="6.4"
              ariaLabel={`${t('offices.dimensions')} — width`}
              className={cx('text-center', !size && 'border-accent-300 bg-accent-50/60')}
              onCommit={(next) => commitSize(next, size ? String(size.height) : next)}
            />
            <span className="text-[12px] text-ink-faint">×</span>
            <InlineField
              type="number"
              value={size ? String(size.height) : ''}
              placeholder="4.2"
              ariaLabel={`${t('offices.dimensions')} — height`}
              className={cx('text-center', !size && 'border-accent-300 bg-accent-50/60')}
              onCommit={(next) => commitSize(size ? String(size.width) : next, next)}
            />
            <span className="shrink-0 text-[12px] text-ink-faint">{t('offices.metres')}</span>
          </div>
        </div>

        {office.kind === 'workroom' && (
          <div>
            <span className="mb-1 block text-[11px] font-bold text-ink-muted">
              {t('offices.deskCount')}
            </span>
            <DeskStepper office={office} onAdd={onAddSeats} onRemoveLast={onRemoveLastSeat} />
          </div>
        )}
      </div>

      {size && (
        <div>
          <span className="mb-1 block text-[11px] font-bold text-ink-muted">
            {t('offices.shape')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {meta.shapes.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip border border-surface-line bg-white text-ink-muted hover:border-brand-300 hover:text-brand-600"
                onClick={() =>
                  onPatch({
                    // A preset is a head start, not a claim: the corners are
                    // then dragged onto the real walls in the plan view.
                    shape:
                      preset.id === 'rectangle'
                        ? null
                        : (presetOutline(preset.id as ShapePreset, size) as Point[]),
                  })
                }
              >
                {lang === 'en' ? preset.en : preset.ar}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-ink-faint">{t('offices.shapeHint')}</span>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold text-ink-muted">
          {t('offices.note')}
        </span>
        <InlineField
          value={office.note ?? ''}
          ariaLabel={t('offices.note')}
          placeholder={t('offices.noteHint')}
          onCommit={(next) => onPatch({ note: next || null })}
        />
      </label>

      <button
        type="button"
        className="btn-danger btn-sm self-start"
        disabled={office.counts.occupied > 0}
        onClick={onDelete}
        title={office.counts.occupied > 0 ? t('offices.cannotDeleteRoom') : undefined}
      >
        <Trash2 size={14} />
        {t('offices.deleteRoom')}
      </button>
    </div>
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
 *
 * A free desk carrying a note is drawn as a question rather than as free. Those
 * are ODOO's four: the inventory counts them as taken and names nobody, and
 * showing them as ordinary empty desks would quietly answer a question nobody
 * has answered. Clicking one opens the desk so somebody can say who is on it.
 */
function SeatChip({
  seat,
  color,
  onClick,
  onPointerDown,
  style,
  className,
  spatial,
  draggable,
  ...rest
}: {
  seat: OfficeSeat;
  color: string;
  onClick: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  style?: CSSProperties;
  className?: string;
  /** Standing on the 3D floor: it gets a shadow and loses the hover lift. */
  spatial?: boolean;
  draggable?: boolean;
  'data-seat'?: string;
}) {
  const { t } = useI18n();
  const name = seat.occupantName;
  const unanswered = seat.state === 'free' && Boolean(seat.note);
  const label = unanswered
    ? `${seat.label} — ${seat.note}`
    : seat.state === 'occupied'
      ? `${seat.label} — ${name}`
      : `${seat.label} — ${t(`offices.state.${seat.state}`)}`;

  const shared = cx(
    'grid h-[30px] w-[30px] place-items-center rounded-lg text-[11.5px] font-bold',
    spatial ? 'shadow-lift' : 'transition-transform hover:scale-[1.08]',
    draggable && 'cursor-grab active:cursor-grabbing'
  );

  if (seat.state === 'occupied') {
    return (
      <button
        {...rest}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        title={label}
        aria-label={label}
        className={cx(shared, 'text-ink', className)}
        style={{
          border: `1.5px solid ${color}`,
          background: spatial ? `${color}3D` : `${color}24`,
          ...style,
        }}
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
      {...rest}
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={label}
      aria-label={label}
      className={cx(
        shared,
        unanswered
          ? 'border-[1.5px] border-dashed border-accent-400 bg-accent-50 text-accent-600'
          : tones[seat.state as Exclude<SeatState, 'occupied'>],
        // On the floor plane an empty desk is a hole in the drawing unless it
        // is given a ground of its own.
        spatial && seat.state === 'free' && 'bg-white/70',
        className
      )}
      style={style}
    >
      {unanswered ? '؟' : seat.state === 'reserved' ? '+' : ''}
    </button>
  );
}

/* ── the room, to scale ──────────────────────────────────────────── */

/**
 * The room drawn at its real proportions: an outline, and desks at their real
 * coordinates on it.
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
 *
 * `space` is the same drawing tipped back under a CSS 3D transform. It is the
 * plan seen from a chair rather than from the ceiling, which is how people
 * actually picture a room — and it is the same DOM, so there is no second
 * layout that can disagree with the first.
 */
/** Four pixels — past a thumb's wobble, short of a deliberate move. */
const DRAG_THRESHOLD = 4;

function ScaledPlan({
  office,
  color,
  canManage,
  editing,
  placing,
  layout,
  tilt,
  onSeat,
  onPlace,
  onPatchRoom,
}: {
  office: Office;
  color: string;
  canManage: boolean;
  editing: boolean;
  placing: string | null;
  layout: OfficeLayout;
  tilt: number;
  onSeat: (office: Office, seat: OfficeSeat) => void;
  onPlace: (office: Office, seat: OfficeSeat, point: Point) => void;
  onPatchRoom: (office: Office, patch: OfficePatch) => void;
}) {
  const { t } = useI18n();
  const size = office.dimensions!;
  const target = placing ? office.seats.find((seat) => seat.id === placing) : null;
  const outline: Point[] = roomOutline(office) ?? [];
  const spatial = layout === 'space';
  const [drag, setDrag] = useState<{ kind: 'seat' | 'corner'; id: string; index: number } | null>(
    null
  );
  /**
   * A press that never moved is a tap, and a tap on a desk opens it. Without
   * this the two gestures share a target: every drag ended by opening the panel
   * for the desk you had just finished moving.
   */
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  /** Where a pointer is, in the room's own metres. */
  const metresAt = (box: DOMRect, clientX: number, clientY: number): Point => ({
    x: Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * size.width * 10) / 10,
    y:
      Math.round(Math.max(0, Math.min(1, (clientY - box.top) / box.height)) * size.height * 10) /
      10,
  });

  const surface = useRef<HTMLDivElement>(null);

  /**
   * Dragging is the whole point of "arrange people": pointer capture keeps the
   * gesture alive when the cursor leaves the desk, and only the release writes,
   * so moving one person across the room is one row in the activity log rather
   * than sixty.
   */
  const startDrag = (kind: 'seat' | 'corner', id: string, index: number) =>
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!canManage || spatial) return;
      if (kind === 'corner' && !editing) return;
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      gesture.current = { x: event.clientX, y: event.clientY, moved: false };
      setDrag({ kind, id, index });
    };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !surface.current || !gesture.current) return;
    const travelled =
      Math.abs(event.clientX - gesture.current.x) + Math.abs(event.clientY - gesture.current.y);
    if (travelled > DRAG_THRESHOLD) gesture.current.moved = true;
    if (!gesture.current.moved) return;
    const box = surface.current.getBoundingClientRect();
    const at = metresAt(box, event.clientX, event.clientY);
    if (drag.kind === 'seat') {
      // Live feedback without a request per pixel — the element follows the
      // pointer, and the value is committed once on release.
      const node = surface.current.querySelector<HTMLElement>(`[data-seat="${drag.id}"]`);
      if (node) {
        node.style.left = `${(at.x / size.width) * 100}%`;
        node.style.top = `${(at.y / size.height) * 100}%`;
      }
    } else {
      const node = surface.current.querySelector<SVGPolygonElement>('[data-outline]');
      if (node) {
        const next = outline.map((corner, index) => (index === drag.index ? at : corner));
        node.setAttribute(
          'points',
          next.map((c) => `${(c.x / size.width) * 100},${(c.y / size.height) * 100}`).join(' ')
        );
      }
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !surface.current) return;
    const held = drag;
    const moved = gesture.current?.moved ?? false;
    gesture.current = null;
    setDrag(null);
    // A press that stayed put writes nothing and lets the click through, so a
    // desk still opens on a tap.
    if (!moved) return;
    swallowClick.current = true;
    const at = metresAt(surface.current.getBoundingClientRect(), event.clientX, event.clientY);
    if (held.kind === 'seat') {
      const seat = office.seats.find((row) => row.id === held.id);
      if (seat) onPlace(office, seat, at);
    } else {
      onPatchRoom(office, {
        shape: outline.map((corner, index) => (index === held.index ? at : corner)),
      });
    }
  };

  const place = (event: MouseEvent<HTMLDivElement>) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (!target || !canManage || spatial) return;
    onPlace(office, target, metresAt(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Tipping the floor back changes what it paints but not the box it
          reserves, so in 3D the drawing needs a stage of its own: shorter,
          because a tilted floor is shorter than a flat one, and clipped,
          because a turned one is wider. */}
      <div
        className={cx(spatial && 'relative grid w-full place-items-center overflow-hidden')}
        style={
          spatial
            ? {
                perspective: '1000px',
                perspectiveOrigin: '50% 34%',
                aspectRatio: `${size.width} / ${size.height * 0.62}`,
              }
            : undefined
        }
      >
        <div
          ref={surface}
          onClick={place}
          onPointerMove={drag ? moveDrag : undefined}
          onPointerUp={drag ? endDrag : undefined}
          onPointerCancel={drag ? endDrag : undefined}
          role={target ? 'button' : undefined}
          tabIndex={target ? 0 : undefined}
          dir="ltr"
          className={cx(
            'relative w-full rounded-xl',
            target && !spatial && 'cursor-crosshair ring-2 ring-brand-300',
            drag && 'select-none'
          )}
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            width: spatial ? '78%' : undefined,
            transformStyle: spatial ? 'preserve-3d' : undefined,
            transform: spatial ? `rotateX(56deg) rotateZ(${tilt}deg)` : undefined,
            transition: drag ? 'none' : 'transform 260ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          {/* The floor. An SVG polygon rather than a border, because a room is
              not always a rectangle and a CSS box always is. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <polygon
              data-outline=""
              points={outlinePoints(office)}
              className="fill-surface-sunken stroke-surface-line"
              strokeWidth={spatial ? 1.4 : 1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {office.seats.map((seat) =>
            seat.point ? (
              <SeatChip
                key={seat.id}
                seat={seat}
                color={color}
                onClick={() => {
                  if (swallowClick.current) {
                    swallowClick.current = false;
                    return;
                  }
                  onSeat(office, seat);
                }}
                onPointerDown={startDrag('seat', seat.id, 0)}
                data-seat={seat.id}
                spatial={spatial}
                draggable={canManage && !spatial}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${(seat.point.x / size.width) * 100}%`,
                  top: `${(seat.point.y / size.height) * 100}%`,
                  // Stand the desks up off the floor plane so the room reads as
                  // a room; the counter-rotation keeps their faces to the eye.
                  transform: spatial
                    ? `translate(-50%, -50%) translateZ(14px) rotateZ(${-tilt}deg) rotateX(-56deg)`
                    : undefined,
                }}
              />
            ) : null
          )}

          {/* Corner handles, only while editing — the room's shape is not
              something to change by brushing past it. */}
          {canManage && editing && !spatial &&
            outline.map((corner, index) => (
              <button
                key={`${corner.x}-${corner.y}-${index}`}
                type="button"
                aria-label={t('offices.corner', { n: index + 1 })}
                title={t('offices.corner', { n: index + 1 })}
                onPointerDown={startDrag('corner', office.id, index)}
                className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-brand-500 shadow-sm transition-transform hover:scale-125"
                style={{
                  left: `${(corner.x / size.width) * 100}%`,
                  top: `${(corner.y / size.height) * 100}%`,
                }}
              />
            ))}
        </div>
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

        {/* A note on an empty desk is an unanswered question carried over from
            the inventory — ODOO's four. It stays until somebody answers it, and
            answering is what clears it. */}
        {seat.note && (
          <div className="flex items-start gap-2.5 rounded-xl border border-accent-100 bg-accent-50 px-3 py-2.5">
            <HelpCircle size={15} className="mt-0.5 shrink-0 text-accent-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-bold text-accent-600">
                {t('offices.openQuestion')}
              </span>
              <span className="block text-[13px] text-ink-muted">{seat.note}</span>
            </span>
            {canManage && (
              <button
                type="button"
                className="btn-quiet btn-sm !min-h-0 shrink-0 !px-2 !py-1 !text-[12px]"
                disabled={busy}
                onClick={() => save({ note: null })}
              >
                {t('offices.markAnswered')}
              </button>
            )}
          </div>
        )}

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
