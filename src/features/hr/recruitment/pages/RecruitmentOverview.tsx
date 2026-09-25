/**
 * /hr/recruitment — the team first.
 *
 * The page opens on the people doing the work, not on a wall of numbers:
 * who carries what against their limits, how their month is going, how close
 * the next reward is. The figures come after, and every one of them is a door
 * into the rows behind it.
 */

import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Armchair, ArrowUpRight, Bell, Briefcase, CalendarRange, CheckCircle2, CircleAlert, ClipboardCheck, Hourglass, Plus, Siren, Target, TimerOff } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, isForbidden, useHRQuery } from '../../api';
import { useHRText } from '../../format';
import { useHR } from '../../shell/HRContext';
import type { RecruiterCardData, RecruitmentOverviewData } from '../../types';
import { Card, LinkArrow, Metric, PageHeader, SectionTitle } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { SEVERITY_TONE, TONE } from '../../ui/tones';
import { RecruiterCarousel } from '../components/RecruiterCarousel';
import { RecruiterDrawer } from '../components/RecruiterDrawer';
import { SEVERITY_ICON } from '../components/RecruitmentAlert';

export function RecruitmentOverview() {
  const { t, pick } = useHRText();
  const { access, alertCenter } = useHR();
  const { data, error, loading, reload } = useHRQuery<RecruitmentOverviewData>(hrApi.recruitment.overview, { refreshMs: 120_000 });
  const [open, setOpen] = useState<RecruiterCardData | null>(null);

  // A department manager who can only ask for hires lands on their requests.
  if (isForbidden(error) || (access && !access.recruitment && !access.kpiReview && !access.rewards && access.requests)) {
    return <Navigate to="/hr/recruitment/requests" replace />;
  }
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton />;
  if (!data) return null;

  const s = data.summary;
  const canRequest = Boolean(data.context.perms.request || data.context.perms.assign);
  const tiles = [
    { key: 'active', icon: Briefcase, label: t('وظائف نشطة', 'Active jobs'), value: s.activeJobs, to: '/hr/recruitment/hiring', tone: 'info' as const },
    { key: 'critical', icon: Siren, label: t('حرجة', 'Critical'), value: s.critical, to: '/hr/recruitment/hiring?priority=critical', tone: 'critical' as const },
    { key: 'required', icon: CircleAlert, label: t('مطلوبة', 'Required'), value: s.required, to: '/hr/recruitment/hiring?priority=required', tone: 'warning' as const },
    { key: 'planned', icon: CalendarRange, label: t('مخطط لها', 'Planned'), value: s.planned, to: '/hr/recruitment/hiring?priority=planned', tone: 'info' as const },
    { key: 'overdue', icon: TimerOff, label: t('متأخرة', 'Overdue'), value: s.overdue, to: '/hr/recruitment/hiring?sla=overdue', tone: s.overdue ? ('critical' as const) : ('neutral' as const) },
    { key: 'due', icon: Hourglass, label: t('قريبة الاستحقاق', 'Due soon'), value: s.dueSoon, to: '/hr/recruitment/hiring?sla=due_soon', tone: s.dueSoon ? ('warning' as const) : ('neutral' as const) },
    { key: 'seats', icon: Armchair, label: t('مقاعد مفتوحة', 'Open seats'), value: s.openSeats, to: '/hr/recruitment/hiring', tone: 'neutral' as const },
    {
      key: 'sla',
      icon: Target,
      label: t('نجاح الـSLA', 'SLA success'),
      value: s.slaSuccess.percent === null ? '—' : `${Math.round(s.slaSuccess.percent)}%`,
      to: '/hr/reports?report=recruitment_sla',
      tone: 'success' as const,
      hint: t(`${s.slaSuccess.judged} وظيفة في ${s.slaSuccess.year}`, `${s.slaSuccess.judged} jobs in ${s.slaSuccess.year}`),
    },
  ];
  const attention = data.alerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'warning').slice(0, 5);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={t('مكتب التوظيف', 'Recruitment desk')}
        description={t('الفريق وحمله وتقدمه أولاً، ثم الأرقام — وكل رقم يفتح الوظائف التي خلفه.', 'The team, their load and their progress first — then the figures, each one opening the jobs behind it.')}
        actions={
          <>
            {alertCenter.alerts.length > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={alertCenter.openDrawer}>
                <Bell size={15} />
                {t(`${alertCenter.alerts.length} تنبيه`, `${alertCenter.alerts.length} alerts`)}
              </button>
            )}
            {canRequest && (
              <Link to="/hr/recruitment/requests/new" className="btn-primary btn-sm">
                <Plus size={16} />
                {t('طلب وظيفة جديد', 'New job request')}
              </Link>
            )}
          </>
        }
      />

      <section aria-labelledby="recruitment-team-title">
        <SectionTitle
          id="recruitment-team-title"
          title={t('فريق التوظيف', 'Recruitment team')}
          hint={t('من قاعدة الموظفين وإسناد الطلبات — الصور من ملفات Odoo.', 'From the employee database and request assignments — photos from Odoo.')}
          action={data.scope === 'all' ? <LinkArrow to="/hr/recruitment/capacity">{t('السعة بالتفصيل', 'Capacity detail')}</LinkArrow> : null}
        />
        {data.team.length ? (
          <RecruiterCarousel cards={data.team} onOpen={setOpen} />
        ) : (
          <EmptyBlock
            title={t('لا يوجد أعضاء في فريق التوظيف بعد', 'No recruitment team members yet')}
            body={t('يظهر الفريق تلقائياً من المسمى الوظيفي أو من إسناد الطلبات، ويمكن إضافته من إعدادات HR.', 'The team appears from job titles or request assignments, and can be edited in HR Settings.')}
          />
        )}
      </section>

      <section aria-label={t('مؤشرات التوظيف', 'Recruitment figures')}>
        <div className="hr-stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <Metric key={tile.key} icon={tile.icon} label={tile.label} value={tile.value} to={tile.to} tone={tile.tone} hint={'hint' in tile ? tile.hint : undefined} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle title={t('يحتاج انتباهاً الآن', 'Needs attention now')} action={data.alerts.length > attention.length ? <button type="button" className="text-brand-600 hover:underline" onClick={alertCenter.openDrawer}>{t('كل التنبيهات', 'All alerts')}</button> : null} />
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700">
              <CheckCircle2 size={18} aria-hidden="true" />
              {t('لا توجد وظيفة متأخرة ولا سعة ممتلئة.', 'Nothing overdue and no recruiter at a limit.')}
            </div>
          ) : (
            <ul className="divide-y divide-[#EEF2F7]">
              {attention.map((alert) => {
                const Icon = SEVERITY_ICON[alert.severity];
                const tone = SEVERITY_TONE[alert.severity];
                return (
                  <li key={alert.id}>
                    <Link to={alert.link} className="flex items-start gap-3 py-3 hover:bg-[#F9FBFD]">
                      <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', TONE[tone].bg, TONE[tone].text)}><Icon size={16} aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-navy">{pick(alert.title)}</span>
                        <span className="block text-[12.5px] leading-5 text-[#5A6C82]">{pick(alert.body)}</span>
                      </span>
                      <ArrowUpRight size={15} className="mt-1 shrink-0 text-ink-faint rtl:-scale-x-100" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title={t('في الطريق للتوظيف', 'On the way to hiring')} action={<LinkArrow to="/hr/recruitment/requests">{t('كل الطلبات', 'All requests')}</LinkArrow>} />
          <ul className="space-y-2.5">
            {[
              { label: t('بانتظار مراجعة القسم', 'Awaiting department review'), value: s.pendingReview, to: '/hr/recruitment/requests?status=pending_review' },
              { label: t('بانتظار الاعتماد النهائي', 'Awaiting final approval'), value: s.pendingApproval, to: '/hr/recruitment/requests?status=pending_approval' },
              { label: t('معلّقة', 'On hold'), value: s.onHold, to: '/hr/recruitment/hiring?status=on_hold' },
              { label: t('أُغلقت هذا الشهر', 'Closed this month'), value: s.completedThisMonth, to: '/hr/recruitment/requests?status=completed' },
            ].map((row) => (
              <li key={row.label}>
                <Link to={row.to} className="flex items-center justify-between gap-3 rounded-xl border border-[#EEF2F7] px-3.5 py-2.5 hover:border-brand-200 hover:bg-[#F7FAFD]">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-navy"><ClipboardCheck size={15} className="text-ink-faint" aria-hidden="true" />{row.label}</span>
                  <span className="text-[16px] font-bold tabular-nums text-navy">{row.value}</span>
                </Link>
              </li>
            ))}
          </ul>
          {s.unclassified > 0 && (
            <p className="mt-3 text-[12px] text-amber-700">{t(`${s.unclassified} وظيفة نشطة بدون أولوية — حدّدها لتُحسب السعة والـSLA.`, `${s.unclassified} active jobs have no priority — set one so capacity and SLA can count them.`)}</p>
          )}
        </Card>
      </div>

      <RecruiterDrawer card={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default RecruitmentOverview;
