/**
 * /hr/settings — every rule HR runs on, in one place: SLA and the working
 * calendar, classifications, capacity, the team, KPI rules, reward rules,
 * permissions, Odoo, imports, migration, reconciliation and the audit trail.
 * Reading needs `hr.manage` or `hr.settings.manage`; changing needs the latter,
 * and every save carries the revision it started from.
 */

import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRightLeft, BadgeCheck, CalendarClock, ClipboardList, Database, FileClock, Gauge, Gift, Layers3, Link2, Scale, ShieldCheck, UsersRound, type LucideIcon } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { hrApi, useHRQuery } from '../api';
import { dateTime, useHRText } from '../format';
import type { Localised, SettingsView } from '../types';
import { useMotion } from '../ui/motion';
import { PageHeader } from '../ui/primitives';
import { PillTabs } from '../ui/PillTabs';
import { ErrorBlock, PageSkeleton } from '../ui/states';
import { AuditSection, ImportsSection, MigrationSection, PermissionsSection, ReconciliationSection } from './DataSections';
import { KpiSection, RewardsSection } from './KpiRewardSections';
import { CapacitySection, ChecklistsSection, ClassificationsSection, OdooSection, SlaSection, TeamSection } from './PolicySections';

interface SectionDef {
  id: string;
  icon: LucideIcon;
  label: Localised;
  group: 'recruitment' | 'people' | 'data';
  render: (view: SettingsView) => ReactNode;
}

const SECTIONS: SectionDef[] = [
  { id: 'sla', icon: CalendarClock, label: { ar: 'الـSLA وأيام العمل', en: 'SLA & working days' }, group: 'recruitment', render: (view) => <SlaSection view={view} /> },
  { id: 'classifications', icon: Layers3, label: { ar: 'التصنيفات', en: 'Classifications' }, group: 'recruitment', render: (view) => <ClassificationsSection view={view} /> },
  { id: 'capacity', icon: Gauge, label: { ar: 'السعة', en: 'Capacity' }, group: 'recruitment', render: (view) => <CapacitySection view={view} /> },
  { id: 'team', icon: UsersRound, label: { ar: 'فريق التوظيف', en: 'Recruitment team' }, group: 'recruitment', render: (view) => <TeamSection view={view} /> },
  { id: 'kpi', icon: BadgeCheck, label: { ar: 'قواعد KPI', en: 'KPI rules' }, group: 'recruitment', render: (view) => <KpiSection view={view} /> },
  { id: 'rewards', icon: Gift, label: { ar: 'قواعد المكافآت', en: 'Reward rules' }, group: 'recruitment', render: (view) => <RewardsSection view={view} /> },
  { id: 'odoo', icon: Link2, label: { ar: 'Odoo', en: 'Odoo' }, group: 'recruitment', render: (view) => <OdooSection view={view} /> },
  { id: 'checklists', icon: ClipboardList, label: { ar: 'القوائم والتقييم', en: 'Checklists & reviews' }, group: 'people', render: (view) => <ChecklistsSection view={view} /> },
  { id: 'permissions', icon: ShieldCheck, label: { ar: 'الصلاحيات', en: 'Permissions' }, group: 'people', render: (view) => <PermissionsSection view={view} /> },
  { id: 'imports', icon: Database, label: { ar: 'تحديث البيانات', en: 'Imports' }, group: 'data', render: (view) => <ImportsSection view={view} /> },
  { id: 'migration', icon: ArrowRightLeft, label: { ar: 'الترحيل', en: 'Migration' }, group: 'data', render: (view) => <MigrationSection view={view} /> },
  { id: 'reconciliation', icon: Scale, label: { ar: 'المطابقة', en: 'Reconciliation' }, group: 'data', render: () => <ReconciliationSection /> },
  { id: 'audit', icon: FileClock, label: { ar: 'سجل التدقيق', en: 'Audit log' }, group: 'data', render: () => <AuditSection /> },
];

const GROUP_LABEL: Record<SectionDef['group'], Localised> = {
  recruitment: { ar: 'التوظيف', en: 'Recruitment' },
  people: { ar: 'الموظفون', en: 'People' },
  data: { ar: 'البيانات', en: 'Data' },
};

export function SettingsPage() {
  const { t, lang, pick } = useHRText();
  const motionPresets = useMotion();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useHRQuery<SettingsView>(hrApi.settings);
  const current = SECTIONS.find((section) => section.id === params.get('section')) ?? SECTIONS[0];
  const choose = (id: string) => setParams(id === SECTIONS[0].id ? {} : { section: id });

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('إعدادات HR', 'HR Settings')}
        title={pick(current.label)}
        description={data.canEdit
          ? t(`آخر تعديل ${data.updatedAt ? dateTime(data.updatedAt, lang) : '—'} · نسخة ${data.revision}`, `Last changed ${data.updatedAt ? dateTime(data.updatedAt, lang) : '—'} · revision ${data.revision}`)
          : t('للعرض فقط — التعديل يحتاج صلاحية إعدادات HR.', 'Read only — changes need the HR settings permission.')}
      />

      {/* Phones and tablets: one scrolling row of sections. */}
      <PillTabs
        className="lg:hidden"
        value={current.id}
        onChange={choose}
        options={SECTIONS.map((section) => ({ id: section.id, label: pick(section.label), icon: <section.icon size={14} aria-hidden="true" /> }))}
        label={t('أقسام الإعدادات', 'Settings sections')}
        layoutId="settings-section-phone"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={t('أقسام الإعدادات', 'Settings sections')} className="hidden lg:block">
          <div className="hr-glass sticky top-[calc(var(--topbar-h)+var(--sat)+4.75rem)] space-y-4 rounded-3xl p-3">
            {(Object.keys(GROUP_LABEL) as Array<SectionDef['group']>).map((group) => (
              <div key={group}>
                <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">{pick(GROUP_LABEL[group])}</p>
                <ul className="space-y-0.5">
                  {SECTIONS.filter((section) => section.group === group).map((section) => {
                    const active = current.id === section.id;
                    return (
                      <li key={section.id}>
                        <button type="button" aria-current={active ? 'page' : undefined} onClick={() => choose(section.id)} className={cx('relative flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-start text-[13px] font-semibold transition-colors', active ? 'text-navy' : 'text-slate-600 hover:bg-white/70 hover:text-navy')}>
                          {active && <motion.span layoutId="settings-section" className="absolute inset-0 rounded-2xl bg-white shadow-[0_10px_24px_-16px_rgb(var(--hr-a1)/0.9)] ring-1 ring-[rgb(var(--hr-a1)/0.18)]" transition={motionPresets.spring} aria-hidden="true" />}
                          <span className={cx('relative grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-all duration-200', active ? 'bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_8px_16px_-8px_rgb(var(--hr-a1)/0.9)]' : 'bg-[rgb(var(--hr-a1)/0.08)] text-[rgb(var(--hr-a1))]')}>
                            <section.icon size={15} aria-hidden="true" />
                          </span>
                          <span className="relative truncate">{pick(section.label)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">{current.render(data)}</div>
      </div>
    </div>
  );
}

export default SettingsPage;
