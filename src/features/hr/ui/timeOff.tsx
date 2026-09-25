/**
 * Odoo time off, shown the same way everywhere: a leave-type chip in Odoo's
 * own colour, a request row with the person's face, and the "out today"
 * strip that opens HR Home and the Leave page.
 */

import { Link } from 'react-router-dom';
import { CalendarClock, Plane, Sparkle } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { date, num, useHRText } from '../format';
import type { Localised, OdooLeave, OdooLeaveType, PersonRef } from '../types';
import { Badge, PersonAvatar } from './primitives';
import { odooColor } from './theme';
import type { Tone } from './tones';

export const LEAVE_STATE: Record<string, { label: Localised; tone: Tone }> = {
  draft: { label: { ar: 'مسودة', en: 'To submit' }, tone: 'neutral' },
  confirm: { label: { ar: 'بانتظار الموافقة', en: 'To approve' }, tone: 'warning' },
  validate1: { label: { ar: 'موافقة ثانية', en: 'Second approval' }, tone: 'warning' },
  validate: { label: { ar: 'معتمدة', en: 'Approved' }, tone: 'success' },
  refuse: { label: { ar: 'مرفوضة', en: 'Refused' }, tone: 'critical' },
};

export function personName(person: Pick<PersonRef, 'nameArabic' | 'nameEnglish' | 'code'>, lang: 'ar' | 'en') {
  return (lang === 'en' ? person.nameEnglish || person.nameArabic : person.nameArabic || person.nameEnglish) || (person.code ? `#${person.code}` : '—');
}

export function LeaveTypeChip({ type }: { type: OdooLeaveType }) {
  const color = odooColor(type.color);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ color: `rgb(${color})`, backgroundColor: `rgb(${color} / 0.1)`, borderColor: `rgb(${color} / 0.28)` }}>
      {type.away ? <Plane size={11} aria-hidden="true" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${color})` }} aria-hidden="true" />}
      <span className="truncate">{type.name}</span>
    </span>
  );
}

/** "يوم واحد", "يومان", "3 أيام", "12 يوماً" — or Odoo's own text for an hourly request. */
export function leaveLength(leave: Pick<OdooLeave, 'days' | 'hours' | 'duration'>, lang: 'ar' | 'en') {
  if (leave.hours && leave.duration) return <span className="ltr">{leave.duration}</span>;
  const days = Number(leave.days) || 0;
  if (lang === 'en') return `${num(days, 'en', 1)} ${days === 1 ? 'day' : 'days'}`;
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  if (Number.isInteger(days) && days >= 3 && days <= 10) return `${num(days, 'ar')} أيام`;
  return `${num(days, 'ar', 1)} يوماً`;
}

function span(leave: Pick<OdooLeave, 'from' | 'to'>, lang: 'ar' | 'en') {
  if (!leave.from) return '—';
  return leave.to && leave.to !== leave.from ? `${date(leave.from, lang, 'short')} → ${date(leave.to, lang, 'short')}` : date(leave.from, lang);
}

/** One request: who, what, when, how long, where it stands. */
export function LeaveRow({ leave }: { leave: OdooLeave }) {
  const { lang, pick } = useHRText();
  const name = personName(leave.employee, lang);
  const state = LEAVE_STATE[leave.state] ?? { label: { ar: leave.state, en: leave.state }, tone: 'neutral' as Tone };
  const body = (
    <>
      <PersonAvatar name={name} photoUrl={leave.employee.photoUrl} size={38} />
      <span className="min-w-0 flex-1">
        <span className="hr-bidi block truncate text-[13px] font-bold text-navy">{name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
          <LeaveTypeChip type={leave.type} />
          <span className="inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden="true" />{span(leave, lang)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={state.tone} dot>{pick(state.label)}</Badge>
        <span className="text-[11.5px] font-semibold tabular-nums text-slate-500">{leaveLength(leave, lang)}</span>
      </span>
    </>
  );
  const className = 'flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors';
  return leave.employee.code
    ? <Link to={`/hr/people/${encodeURIComponent(leave.employee.code)}`} className={cx(className, 'hover:bg-[rgb(var(--hr-a1)/0.06)]')}>{body}</Link>
    : <div className={className}>{body}</div>;
}

/** Faces of everyone out today, with the type under each. */
export function OutTodayStrip({ absent, away, empty }: { absent: OdooLeave[]; away: OdooLeave[]; empty: string }) {
  const { lang, t } = useHRText();
  const people = [...absent.map((leave) => ({ leave, away: false })), ...away.map((leave) => ({ leave, away: true }))];
  if (!people.length) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-emerald-50/80 px-3.5 py-3 text-[12.5px] font-semibold text-emerald-800">
        <Sparkle size={15} aria-hidden="true" />{empty}
      </p>
    );
  }
  return (
    <ul className="hr-stagger no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {people.map(({ leave, away }) => {
        const name = personName(leave.employee, lang);
        const content = (
          <>
            <span className="relative">
              <PersonAvatar name={name} photoUrl={leave.employee.photoUrl} size={52} ring />
              <span className={cx('absolute -bottom-0.5 -end-0.5 grid h-5 w-5 place-items-center rounded-full text-white ring-2 ring-white', away ? 'bg-sky-500' : 'bg-rose-500')} aria-hidden="true">
                {away ? <Plane size={10} /> : <CalendarClock size={10} />}
              </span>
            </span>
            <span className="hr-bidi mt-2 block max-w-[7.5rem] truncate text-center text-[12px] font-bold text-navy">{name}</span>
            <span className="hr-bidi block max-w-[7.5rem] truncate text-center text-[11px] text-slate-500">{leave.type.name}</span>
            <span className="block text-[10.5px] font-semibold text-slate-400">{t(`حتى ${date(leave.to, 'ar', 'short')}`, `until ${date(leave.to, 'en', 'short')}`)}</span>
          </>
        );
        return (
          <li key={leave.id} className="shrink-0">
            {leave.employee.code ? (
              <Link to={`/hr/people/${encodeURIComponent(leave.employee.code)}`} className="hr-glass hr-lift flex w-32 flex-col items-center rounded-3xl px-2 py-3 text-center">{content}</Link>
            ) : (
              <div className="hr-glass flex w-32 flex-col items-center rounded-3xl px-2 py-3 text-center">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
