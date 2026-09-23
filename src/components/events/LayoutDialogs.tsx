/**
 * The small dialogs of the schedule layout editor. Every one of them edits
 * Qodo's arrangement only — none reaches Odoo, and the words say so where it
 * matters ("remove from package", never "delete course").
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { LAYOUT_ACCENTS, LAYOUT_DEPARTMENTS } from '@shared/eventsLayout';
import { departmentLabel, rowMatches, STATUS_LABELS } from '@shared/eventsSchedule';
import { ksaShortDate } from '../../lib/eventsSchedule';
import { searchLayoutCourses, type EventLayout, type LayoutAccent, type LayoutSearchResult, type PlacedRow } from '../../lib/eventsLayout';
import { cx } from '../../lib/utils';
import { Modal, Spinner } from '../ui';
import { TONE } from './tones';

export const ACCENT_AR: Record<LayoutAccent, string> = {
  blue: 'أزرق',
  violet: 'بنفسجي',
  green: 'أخضر',
  amber: 'كهرماني',
  sky: 'سماوي',
  indigo: 'نيلي',
  pink: 'وردي',
  orange: 'برتقالي',
  coral: 'مرجاني',
  slate: 'رمادي',
};

/** Layout accent → the Events tone that draws it. */
export const accentTone = (accent: LayoutAccent | null | undefined) => TONE[accent ?? 'slate'];

function Footer({ onCancel, confirm, disabled, danger }: { onCancel: () => void; confirm: ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <>
      <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
        إلغاء
      </button>
      <button type="submit" form="layout-dialog" className={cx('btn-sm', danger ? 'btn-danger' : 'btn-primary')} disabled={disabled}>
        {confirm}
      </button>
    </>
  );
}

/* ── package: add / edit ─────────────────────────────────────────── */

export function PackageDialog({
  open,
  initial,
  department,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: { label: string; accent: LayoutAccent | null; description: string | null } | null;
  /** Where a new package goes; null asks (the "All" view). */
  department: string | null;
  onClose: () => void;
  onSubmit: (value: { label: string; accent: LayoutAccent | null; description: string | null; department: string }) => void;
}) {
  const [label, setLabel] = useState('');
  const [where, setWhere] = useState<string>(LAYOUT_DEPARTMENTS[0]);
  const [accent, setAccent] = useState<LayoutAccent | null>('blue');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? '');
    setAccent(initial ? initial.accent : 'blue');
    setDescription(initial?.description ?? '');
    setWhere(department ?? LAYOUT_DEPARTMENTS[0]);
  // Reset only as the dialog opens: the parent re-renders constantly and passes
  // fresh objects, and re-seeding on those would wipe what is being typed.
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="sm"
      title={initial ? 'تعديل الباقة' : `باقة جديدة${department ? ` في ${departmentLabel(department)}` : ''}`}
      footer={<Footer onCancel={onClose} confirm={initial ? 'احفظ' : 'ضيف الباقة'} disabled={!label.trim()} />}
    >
      <form
        id="layout-dialog"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim()) return;
          onSubmit({ label: label.trim(), accent, description: description.trim() || null, department: where });
        }}
      >
        <label className="block">
          <span className="label">اسم الباقة</span>
          <input className="field" dir="auto" autoFocus maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Mechanical Package" />
        </label>
        {!initial && !department && (
          <label className="block">
            <span className="label">القسم</span>
            <select className="field" value={where} onChange={(event) => setWhere(event.target.value)}>
              {LAYOUT_DEPARTMENTS.map((name) => (
                <option key={name} value={name}>
                  {departmentLabel(name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset>
          <legend className="label">لون الباقة</legend>
          <div className="flex flex-wrap gap-2">
            {(LAYOUT_ACCENTS as LayoutAccent[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={accent === value}
                aria-label={ACCENT_AR[value]}
                title={ACCENT_AR[value]}
                onClick={() => setAccent(value)}
                className={cx(
                  'grid h-9 w-9 place-items-center rounded-xl transition',
                  accentTone(value).icon,
                  accent === value ? 'ring-2 ring-slate-900 ring-offset-2' : 'opacity-80 hover:opacity-100'
                )}
              >
                {accent === value && <Check size={16} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="label">وصف (اختياري)</span>
          <textarea className="field min-h-[72px]" dir="auto" maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <p className="text-[12px] text-slate-500">الباقة بتتضاف في آخر القسم، وتقدر تسحبها لمكانها بعد كده.</p>
      </form>
    </Modal>
  );
}

/* ── group / level: add / rename ─────────────────────────────────── */

export function GroupDialog({ open, initial, onClose, onSubmit }: { open: boolean; initial?: string | null; onClose: () => void; onSubmit: (label: string) => void }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (open) setLabel(initial ?? '');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} width="sm" title={initial ? 'تغيير اسم المستوى' : 'مستوى / مجموعة جديدة'} footer={<Footer onCancel={onClose} confirm="احفظ" disabled={!label.trim()} />}>
      <form
        id="layout-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim()) onSubmit(label.trim());
        }}
      >
        <label className="block">
          <span className="label">الاسم</span>
          <input className="field" dir="auto" autoFocus maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Basic Level" />
        </label>
        <p className="mt-2 text-[12px] text-slate-500">ممكن يتكرر نفس الاسم في الباقة (دفعة تانية) — كل مستوى له هويته الخاصة.</p>
      </form>
    </Modal>
  );
}

/* ── package: delete ─────────────────────────────────────────────── */

export function DeletePackageDialog({
  open,
  label,
  courseCount,
  targets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  label: string;
  courseCount: number;
  targets: Array<{ id: string; label: string; department: string }>;
  onClose: () => void;
  onSubmit: (moveTo: string | null) => void;
}) {
  const [mode, setMode] = useState<'unassigned' | 'package'>('unassigned');
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (open) {
      setMode('unassigned');
      setTarget(targets[0]?.id ?? '');
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="sm"
      title="شيل الباقة من الترتيب"
      footer={<Footer onCancel={onClose} danger confirm="شيل الباقة" disabled={courseCount > 0 && mode === 'package' && !target} />}
    >
      <form
        id="layout-dialog"
        className="grid gap-3 text-[13.5px] text-slate-700"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(courseCount > 0 && mode === 'package' ? target : null);
        }}
      >
        <p>
          الباقة <bdi className="font-bold text-slate-900">{label}</bdi> هتتشال من ترتيب الجدول بس. الكورسات نفسها مش هتتمسح من أودو.
        </p>
        {courseCount > 0 && (
          <fieldset className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <legend className="px-1 text-[12.5px] font-bold text-slate-900">فيها {courseCount} كورس — يروحوا فين؟</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'unassigned'} onChange={() => setMode('unassigned')} />
              يرجعوا لـ «كورسات مش في باقة»
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'package'} onChange={() => setMode('package')} disabled={targets.length === 0} />
              ينتقلوا لباقة تانية
            </label>
            {mode === 'package' && (
              <select className="field" value={target} onChange={(event) => setTarget(event.target.value)}>
                {targets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {departmentLabel(option.department)} — {option.label}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

/* ── course: move to… ────────────────────────────────────────────── */

export function MoveCourseDialog({
  open,
  courseName,
  layout,
  current,
  onClose,
  onSubmit,
}: {
  open: boolean;
  courseName: string;
  layout: EventLayout | null;
  current: { packageId: string; groupId: string | null } | null;
  onClose: () => void;
  onSubmit: (target: { packageId: string; groupId: string | null }) => void;
}) {
  const packages = useMemo(
    () => (layout?.departments ?? []).flatMap((entry) => entry.packages.map((pkg) => ({ ...pkg, department: entry.department }))),
    [layout]
  );
  const [packageId, setPackageId] = useState('');
  const [groupId, setGroupId] = useState('');
  useEffect(() => {
    if (!open) return;
    setPackageId(current?.packageId ?? packages[0]?.id ?? '');
    setGroupId(current?.groupId ?? '');
  }, [open]);
  const pkg = packages.find((entry) => entry.id === packageId);

  return (
    <Modal open={open} onClose={onClose} width="sm" title="انقل الكورس" footer={<Footer onCancel={onClose} confirm="انقل" disabled={!packageId} />}>
      <form
        id="layout-dialog"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (packageId) onSubmit({ packageId, groupId: groupId || null });
        }}
      >
        <p className="text-[13.5px] text-slate-700">
          <bdi className="font-bold text-slate-900">{courseName}</bdi> — المكان في الجدول بس؛ أودو مش هيتغيّر.
        </p>
        <label className="block">
          <span className="label">الباقة</span>
          <select
            className="field"
            value={packageId}
            onChange={(event) => {
              setPackageId(event.target.value);
              setGroupId('');
            }}
          >
            {(layout?.departments ?? [])
              .filter((entry) => entry.packages.length)
              .map((entry) => (
                <optgroup key={entry.department} label={departmentLabel(entry.department) ?? entry.department}>
                  {entry.packages.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="label">المستوى / المجموعة</span>
          <select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={!pkg?.groups.length}>
            <option value="">— في الباقة نفسها —</option>
            {pkg?.groups.map((group, index) => (
              <option key={group.id} value={group.id}>
                {group.label}
                {pkg.groups.filter((other) => other.label === group.label).length > 1 ? ` (${index + 1})` : ''}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}

/* ── course: display name, badge, note ───────────────────────────── */

export function DisplayDialog({
  open,
  odooName,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  odooName: string;
  initial: { customLabel: string | null; badge: string | null; note: string | null } | null;
  onClose: () => void;
  onSubmit: (value: { customLabel: string; badge: string; note: string }) => void;
}) {
  const [customLabel, setCustomLabel] = useState('');
  const [badge, setBadge] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setCustomLabel(initial?.customLabel ?? '');
    setBadge(initial?.badge ?? '');
    setNote(initial?.note ?? '');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} width="sm" title="اسم العرض" footer={<Footer onCancel={onClose} confirm="احفظ" />}>
      <form
        id="layout-dialog"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ customLabel, badge, note });
        }}
      >
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          الاسم في أودو: <bdi dir="auto" className="font-bold text-slate-900">{odooName}</bdi>
          <p className="mt-0.5 text-slate-500">الاسم ده بيفضل زي ما هو في أودو؛ التعديل هنا للعرض في الجدول بس.</p>
        </div>
        <label className="block">
          <span className="label">اسم العرض</span>
          <div className="flex gap-2">
            <input className="field" dir="auto" maxLength={120} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} placeholder={odooName} />
            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setCustomLabel('')} disabled={!customLabel}>
              رجّع اسم أودو
            </button>
          </div>
        </label>
        <label className="block">
          <span className="label">شارة (اختياري)</span>
          <input className="field" dir="auto" maxLength={40} value={badge} onChange={(event) => setBadge(event.target.value)} placeholder="BIM MEP" />
        </label>
        <label className="block">
          <span className="label">ملاحظة للترتيب (اختياري)</span>
          <textarea className="field min-h-[64px]" dir="auto" maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

/* ── add course: the searchable picker ───────────────────────────── */

/**
 * Existing Odoo courses, never a new one. The loaded schedule is searched by
 * everything on the row (name, code, instructor, department, type, package);
 * two letters or more also ask Odoo by name/code for courses outside the
 * loaded dates. A course already placed says where, and adding it moves it —
 * one course, one place.
 */
export function AddCourseDialog({
  open,
  target,
  rows,
  onClose,
  onPick,
}: {
  open: boolean;
  target: string;
  rows: PlacedRow[];
  onClose: () => void;
  onPick: (course: { id: number; code: string | null }) => void;
}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<LayoutSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (open) {
      setQuery('');
      setRemote([]);
    }
  }, [open]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchLayoutCourses(q)
        .then((result) => !cancelled && setRemote(result.results))
        .catch(() => !cancelled && setRemote([]))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const local = useMemo(() => {
    const matched = rows.filter((row) => rowMatches(row, query));
    // Unplaced first: that is who is waiting for a home.
    return [...matched].sort((a, b) => Number(Boolean(a.placement)) - Number(Boolean(b.placement))).slice(0, 60);
  }, [rows, query]);
  const known = new Set(rows.map((row) => row.id));
  const outside = remote.filter((result) => !known.has(result.id));

  return (
    <Modal open={open} onClose={onClose} width="md" title={`ضيف كورس من أودو — ${target}`}>
      <div className="grid gap-3">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="field ps-9"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="اسم الكورس، الكود، المدرّب، القسم، النوع…"
          />
        </label>
        <ul className="grid max-h-[52dvh] gap-1.5 overflow-y-auto">
          {local.map((row) => (
            <PickRow
              key={row.id}
              name={row.courseName}
              meta={[row.courseCode ? `كود ${row.courseCode}` : null, row.instructor, row.trainingType, departmentLabel(row.department)].filter(Boolean).join(' • ')}
              status={row.statusCanonical ? STATUS_LABELS[row.statusCanonical] : null}
              where={row.placement ? `في ${row.placement.packageLabel}${row.placement.groupLabel ? ` › ${row.placement.groupLabel}` : ''}` : null}
              onPick={() => onPick({ id: row.id, code: row.courseCode })}
            />
          ))}
          {outside.map((result) => (
            <PickRow
              key={`odoo-${result.id}`}
              name={result.courseName}
              meta={[result.courseCode ? `كود ${result.courseCode}` : null, result.startsAt ? `يبدأ ${ksaShortDate(result.startsAt)}` : null, 'برّه الفترة المعروضة'].filter(Boolean).join(' • ')}
              status={null}
              where={null}
              onPick={() => onPick({ id: result.id, code: result.courseCode })}
            />
          ))}
          {searching && (
            <li className="flex items-center justify-center gap-2 py-3 text-[12.5px] text-slate-500">
              <Spinner size={14} /> بندوّر في أودو…
            </li>
          )}
          {!searching && local.length === 0 && outside.length === 0 && (
            <li className="py-8 text-center text-[13px] text-slate-500">مفيش كورسات مطابقة.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}

function PickRow({ name, meta, status, where, onPick }: { name: string; meta: string; status: string | null; where: string | null; onPick: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <bdi dir="auto" className="truncate text-[14px] font-bold text-slate-900">
            {name}
          </bdi>
          {status && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{status}</span>}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-slate-500" dir="auto">
          {meta}
        </p>
        {where && <p className="mt-0.5 text-[11.5px] font-semibold text-amber-700">{where} — هيتنقل من هناك</p>}
      </div>
      <button type="button" onClick={onPick} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-blue-700">
        <Plus size={14} /> {where ? 'انقل هنا' : 'ضيف'}
      </button>
    </li>
  );
}

/* ── confirm ─────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  cancel = 'إلغاء',
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirm: string;
  cancel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="sm"
      title={title}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {cancel}
          </button>
          <button type="button" className={cx('btn-sm', danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirm}
          </button>
        </>
      }
    >
      <div className="text-[13.5px] leading-relaxed text-slate-700">{body}</div>
    </Modal>
  );
}
