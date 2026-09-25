/**
 * The organization as Odoo knows it right now: every active employee under
 * their manager (`hr.employee.parent_id`), with their photo, and the
 * department tree with each department's manager. Branches open and close
 * with a glide; a search opens every branch that holds a match.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, UsersRound } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { normaliseSearch, num, useHRText } from '../format';
import type { OdooChartPerson, OrganizationData } from '../types';
import { Card, PersonAvatar, SectionTitle } from '../ui/primitives';
import { EmptyBlock } from '../ui/states';
import { useMotion } from '../ui/motion';
import { labelColor } from '../ui/theme';
import { personName } from '../ui/timeOff';

type Connected = Extract<OrganizationData['odoo'], { connected: true }>;

function PersonNode({ person, branches, depth, open, toggle, highlight }: { person: OdooChartPerson; branches: Map<number, OdooChartPerson[]>; depth: number; open: Set<number>; toggle: (id: number) => void; highlight: Set<number> | null }) {
  const { lang, t } = useHRText();
  const motionPresets = useMotion();
  const children = branches.get(person.odooId) ?? [];
  const expanded = open.has(person.odooId);
  const name = personName(person, lang);
  const color = labelColor(person.department || name);
  const card = (
    <>
      <PersonAvatar name={name} photoUrl={person.photoUrl} size={42} ring={depth === 0} />
      <span className="min-w-0 flex-1">
        <span className="hr-bidi block truncate text-[13.5px] font-bold text-navy">{name}</span>
        <span className="hr-bidi block truncate text-[11.5px] text-slate-500">{person.jobTitle || person.title || '—'}</span>
        {person.department && <span className="hr-bidi mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ color: `rgb(${color})`, backgroundColor: `rgb(${color} / 0.1)` }}>{person.department}</span>}
      </span>
    </>
  );
  return (
    <li className={cx(depth > 0 && 'ms-3 border-s-2 border-dashed border-[rgb(var(--hr-a1)/0.2)] ps-2.5 sm:ms-8 sm:ps-4')}>
      <div className={cx('hr-glass mb-2 flex items-center gap-2 rounded-2xl p-2.5 transition-shadow', highlight?.has(person.odooId) && 'ring-2 ring-[rgb(var(--hr-a1)/0.5)]')}>
        {children.length > 0 ? (
          <button type="button" onClick={() => toggle(person.odooId)} aria-expanded={expanded} aria-label={t(`فريق ${name} (${children.length})`, `${name}'s team (${children.length})`)} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_6px_14px_-8px_rgb(var(--hr-a1)/0.9)] transition-transform hover:scale-105">
            <ChevronDown size={15} className={cx('transition-transform duration-200', !expanded && '-rotate-90 rtl:rotate-90')} aria-hidden="true" />
          </button>
        ) : <span className="w-8 shrink-0" aria-hidden="true" />}
        {person.code ? <Link to={`/hr/people/${encodeURIComponent(person.code)}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl hover:opacity-90">{card}</Link> : <span className="flex min-w-0 flex-1 items-center gap-3">{card}</span>}
        {children.length > 0 && <span className="shrink-0 rounded-full bg-[rgb(var(--hr-a1)/0.1)] px-2.5 py-0.5 text-[11.5px] font-bold tabular-nums text-[rgb(var(--hr-a1))]">{num(children.length, lang)}</span>}
      </div>
      <AnimatePresence initial={false}>
        {expanded && children.length > 0 && (
          <motion.ul
            initial={motionPresets.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={motionPresets.reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={motionPresets.reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={motionPresets.ease}
            className="overflow-hidden"
          >
            {children.map((child) => <PersonNode key={child.odooId} person={child} branches={branches} depth={depth + 1} open={open} toggle={toggle} highlight={highlight} />)}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

export function OdooPeopleChart({ odoo }: { odoo: Connected }) {
  const { t } = useHRText();
  const [q, setQ] = useState('');
  const { roots, branches, byId } = useMemo(() => {
    const ids = new Set(odoo.people.map((person) => person.odooId));
    const map = new Map<number, OdooChartPerson[]>();
    for (const person of odoo.people) {
      if (person.parentId === null || !ids.has(person.parentId) || person.parentId === person.odooId) continue;
      map.set(person.parentId, [...(map.get(person.parentId) ?? []), person]);
    }
    for (const list of map.values()) list.sort((left, right) => (map.get(right.odooId)?.length ?? 0) - (map.get(left.odooId)?.length ?? 0) || left.nameEnglish.localeCompare(right.nameEnglish));
    const top = odoo.people.filter((person) => person.parentId === null || !ids.has(person.parentId) || person.parentId === person.odooId);
    top.sort((left, right) => (map.get(right.odooId)?.length ?? 0) - (map.get(left.odooId)?.length ?? 0));
    return { roots: top, branches: map, byId: new Map(odoo.people.map((person) => [person.odooId, person])) };
  }, [odoo]);
  const [open, setOpen] = useState<Set<number>>(() => new Set(roots.map((person) => person.odooId)));
  const highlight = useMemo(() => {
    const needle = normaliseSearch(q);
    if (!needle) return null;
    return new Set(odoo.people.filter((person) => normaliseSearch(`${person.nameArabic} ${person.nameEnglish} ${person.jobTitle} ${person.department} ${person.code ?? ''}`).includes(needle)).map((person) => person.odooId));
  }, [odoo, q]);
  // A search opens the path down to every match.
  const openNow = useMemo(() => {
    if (!highlight) return open;
    const next = new Set(open);
    for (const id of highlight) {
      let cursor = byId.get(id)?.parentId ?? null;
      const guard = new Set<number>();
      while (cursor !== null && !guard.has(cursor)) {
        guard.add(cursor);
        next.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    return next;
  }, [highlight, open, byId]);
  const toggle = (id: number) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <Card>
      <SectionTitle
        title={t('خطوط الإدارة من Odoo', 'Reporting lines from Odoo')}
        hint={t(`${num(odoo.people.length, 'ar')} موظفاً نشطاً تحت مديريهم كما في Odoo الآن.`, `${num(odoo.people.length, 'en')} active employees under their managers, as Odoo has them now.`)}
        action={
          <span className="relative block w-56">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input className="field !py-1.5 ps-8 !text-[12.5px]" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('اسم، مسمى، قسم…', 'Name, title, department…')} aria-label={t('بحث في الهيكل', 'Search the structure')} />
          </span>
        }
      />
      {roots.length ? <ul className="max-h-[75dvh] overflow-auto pe-1">{roots.map((root) => <PersonNode key={root.odooId} person={root} branches={branches} depth={0} open={openNow} toggle={toggle} highlight={highlight} />)}</ul> : <EmptyBlock title={t('لا يوجد موظفون نشطون في Odoo', 'No active employees in Odoo')} />}
      {highlight && <p className="mt-2 text-[12px] font-semibold text-slate-500">{t(`النتائج المظللة: ${num(highlight.size, 'ar')}`, `${num(highlight.size, 'en')} matches highlighted`)}</p>}
    </Card>
  );
}

export function OdooDepartments({ odoo }: { odoo: Connected }) {
  const { t, lang } = useHRText();
  const parents = new Map(odoo.departments.map((department) => [department.id, department.name]));
  const max = Math.max(1, ...odoo.departments.map((department) => department.employees));
  return (
    <ul className="hr-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {odoo.departments.map((department) => {
        const color = labelColor(department.name);
        const manager = department.manager;
        return (
          <li key={department.id}>
            <div className="hr-glass hr-lift relative h-full overflow-hidden rounded-3xl p-4">
              <span className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundImage: `linear-gradient(90deg, rgb(${color}), rgb(${color} / 0.4))` }} aria-hidden="true" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="hr-bidi truncate text-[14px] font-bold text-navy" title={department.name}>{department.name}</h3>
                  {department.parentId !== null && parents.has(department.parentId) && <p className="hr-bidi truncate text-[11.5px] text-slate-500">{parents.get(department.parentId)}</p>}
                </div>
                <span className="shrink-0 text-end">
                  <span className="flex items-center justify-end gap-1 text-[22px] font-extrabold tabular-nums text-navy"><UsersRound size={15} className="text-slate-400" aria-hidden="true" />{num(department.employees, lang)}</span>
                </span>
              </div>
              <span className="mt-3 block h-2 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full" style={{ width: `${(department.employees / max) * 100}%`, backgroundImage: `linear-gradient(90deg, rgb(${color}), rgb(${color} / 0.55))` }} /></span>
              {manager ? (
                <div className="mt-3 flex items-center gap-2.5">
                  <PersonAvatar name={personName(manager, lang)} photoUrl={manager.photoUrl} size={34} />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-slate-500">{t('المدير', 'Manager')}</span>
                    {manager.code ? <Link to={`/hr/people/${encodeURIComponent(manager.code)}`} className="hr-bidi block truncate text-[12.5px] font-bold text-navy hover:text-[rgb(var(--hr-a1))]">{personName(manager, lang)}</Link> : <span className="hr-bidi block truncate text-[12.5px] font-bold text-navy">{personName(manager, lang)}</span>}
                  </span>
                </div>
              ) : <p className="mt-3 text-[12px] text-slate-400">{t('بلا مدير محدد في Odoo', 'No manager set in Odoo')}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
