/**
 * The strip above every HR page: where you are, a way to jump to any
 * employee, and the recruitment alert centre.
 */

import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, Search } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { normaliseSearch, useHRText } from '../format';
import type { PeopleData } from '../types';
import { PersonAvatar } from '../ui/primitives';
import { useHR } from './HRContext';
import { HR_NAV, PERSONNEL_NAV, RECRUITMENT_NAV } from './nav';
import { subKey } from './SubNav';

function Breadcrumbs() {
  const { pathname } = useLocation();
  const { pick, t } = useHRText();
  const crumbs: Array<{ to: string; label: string }> = [{ to: '/hr', label: t('الموارد البشرية', 'HR') }];
  const section = [...HR_NAV].filter((item) => item.to !== '/hr').find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  if (section) crumbs.push({ to: section.to, label: pick(section.label) });
  const subItems = section?.id === 'recruitment' ? RECRUITMENT_NAV : section?.id === 'personnel' ? PERSONNEL_NAV : null;
  if (subItems) {
    const key = subKey(subItems, pathname);
    const sub = subItems.find((item) => item.to === key && item !== subItems[0]);
    if (sub) crumbs.push({ to: sub.to, label: pick(sub.label) });
    if (pathname.endsWith('/requests/new')) crumbs.push({ to: pathname, label: t('طلب جديد', 'New request') });
  }
  if (section?.id === 'people' && pathname !== section.to) crumbs.push({ to: pathname, label: t('ملف الموظف', 'Employee profile') });
  return (
    <nav aria-label={t('المسار', 'Breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[12.5px] text-[#5A6C82]">
        {crumbs.map((crumb, index) => (
          <li key={crumb.to} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight size={13} className="shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />}
            {index === crumbs.length - 1 ? (
              <span className="truncate font-semibold text-navy" aria-current="page">{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="truncate hover:text-navy">{crumb.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function EmployeeSearch() {
  const { t, lang } = useHRText();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { data } = useHRQuery<PeopleData>(open || query ? hrApi.people : null);
  const results = useMemo(() => {
    const needle = normaliseSearch(query);
    if (!needle || !data) return [];
    return data.employees
      .filter((employee) => normaliseSearch(`${employee.employeeCode} ${employee.nameArabic} ${employee.nameEnglish} ${employee.title}`).includes(needle))
      .slice(0, 7);
  }, [data, query]);

  const choose = (code: string) => {
    setQuery('');
    setOpen(false);
    navigate(`/hr/people/${encodeURIComponent(code)}`);
  };

  return (
    <div
      className="relative w-full max-w-xs"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor="hr-employee-search" className="sr-only">{t('ابحث عن موظف', 'Find an employee')}</label>
      <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
      <input
        id="hr-employee-search"
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="hr-employee-results"
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(results.length - 1, index + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
          if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active].employeeCode); }
          if (event.key === 'Escape') { setQuery(''); setOpen(false); }
        }}
        placeholder={t('اسم أو كود موظف…', 'Employee name or code…')}
        className="h-10 w-full rounded-2xl border border-white/80 bg-white/70 ps-9 pe-3 text-[13px] text-navy shadow-[inset_0_1px_0_rgb(255_255_255/0.9)] outline-none backdrop-blur transition-[border-color,box-shadow,background-color] placeholder:text-slate-400 focus:border-[rgb(var(--hr-a1)/0.55)] focus:bg-white focus:shadow-[0_0_0_4px_rgb(var(--hr-a1)/0.14)]"
      />
      {open && results.length > 0 && (
        <ul id="hr-employee-results" role="listbox" className="hr-glass absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl p-1.5 [--hr-glass:rgb(255_255_255/0.94)]">
          {results.map((employee, index) => {
            const name = lang === 'en' ? employee.nameEnglish || employee.nameArabic : employee.nameArabic || employee.nameEnglish;
            return (
              <li key={employee.employeeCode} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(employee.employeeCode)}
                  className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors', index === active ? 'bg-[rgb(var(--hr-a1)/0.1)]' : 'hover:bg-[rgb(var(--hr-a1)/0.06)]')}
                >
                  <PersonAvatar name={name} photoUrl={employee.photoUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="hr-bidi block truncate text-[12.5px] font-semibold text-navy">{name}</span>
                    <span className="hr-bidi block truncate text-[11px] text-ink-faint">{employee.title || '—'}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">#{employee.employeeCode}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function HRHeader() {
  const { access, alertCenter } = useHR();
  const { t } = useHRText();
  const important = alertCenter.alerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'warning').length;
  const showAlerts = Boolean(access && (access.recruitment || access.kpiReview || access.rewards));
  return (
    <div className="sticky top-[calc(var(--topbar-h)+var(--sat))] z-30 flex items-center gap-3 border-b border-white/70 bg-white/55 px-4 py-2.5 shadow-[0_8px_30px_-24px_rgb(30_41_99/0.5)] backdrop-blur-xl sm:px-6">
      <div className="min-w-0 flex-1"><Breadcrumbs /></div>
      {access?.people && <div className="hidden w-64 sm:block"><EmployeeSearch /></div>}
      {showAlerts && (
        <button
          type="button"
          onClick={alertCenter.openDrawer}
          className={cx('relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/80 bg-white/70 text-slate-500 shadow-[inset_0_1px_0_rgb(255_255_255/0.9)] backdrop-blur transition-[color,transform,box-shadow] duration-200 hover:-translate-y-px hover:text-[rgb(var(--hr-a1))] hover:shadow-[0_10px_22px_-14px_rgb(var(--hr-a1)/0.7)]', alertCenter.unseen.size > 0 && 'text-navy')}
          aria-label={important ? t(`تنبيهات التوظيف (${important})`, `Recruitment alerts (${important})`) : t('تنبيهات التوظيف', 'Recruitment alerts')}
        >
          <Bell size={17} aria-hidden="true" />
          {important > 0 && (
            <span className={cx('absolute -end-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white', alertCenter.alerts.some((alert) => alert.severity === 'critical') ? 'hr-pulse bg-gradient-to-br from-red-500 to-rose-600' : 'bg-gradient-to-br from-amber-400 to-orange-500')}>
              {important > 99 ? '99+' : important}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
