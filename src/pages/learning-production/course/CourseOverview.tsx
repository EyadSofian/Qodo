/**
 * Course overview: where production stands, why its health is what it is, who
 * is on it and what happened lately.
 */

import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, ClipboardCheck, SquareStack } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { formatDate } from '../../../lib/utils';
import { roleKey } from '../../../lib/learningProduction/format';
import type { HealthReason } from '../../../lib/learningProduction/types';
import { ActivityFeed, PersonChip, Section } from '../../../components/learning-production/kit';
import { Pipeline } from '../../../components/learning-production/CourseProgress';
import { useCourse } from '../CourseWorkspace';

export function HealthReasonText({ reason }: { reason: HealthReason }) {
  const { t, lang } = useI18n();
  switch (reason.code) {
    case 'TARGET_PASSED':
      return <>{t('lp.healthReason.TARGET_PASSED', { date: formatDate(reason.targetDate ?? '', lang) })}</>;
    case 'MANY_OVERDUE':
      return <>{t('lp.healthReason.MANY_OVERDUE', { n: reason.count ?? 0, share: reason.share ?? 0 })}</>;
    case 'SOME_OVERDUE':
      return <>{t('lp.healthReason.SOME_OVERDUE', { n: reason.count ?? 0 })}</>;
    case 'BEHIND_SCHEDULE':
      return <>{t('lp.healthReason.BEHIND_SCHEDULE', { expected: reason.expected ?? 0, actual: reason.actual ?? 0 })}</>;
    case 'TARGET_CLOSE':
      return <>{t('lp.healthReason.TARGET_CLOSE', { n: reason.daysLeft ?? 0, actual: reason.actual ?? 0 })}</>;
    default:
      return null;
  }
}

export function CourseOverview() {
  const { t, lang } = useI18n();
  const { detail } = useCourse();
  const { course, stages, team, people, blocked } = detail;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section
          title={t('lp.overview.pipeline')}
          actions={
            <Link to="production" className="btn-ghost btn-sm">
              <SquareStack size={14} />
              {t('lp.overview.openMatrix')}
            </Link>
          }
        >
          <Pipeline stages={stages} />
          {course.healthReasons.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-xl bg-surface-bg px-3 py-2.5 text-[13px] text-ink-muted">
              {course.healthReasons.map((reason) => (
                <li key={reason.code} className="flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-600" aria-hidden="true" />
                  <HealthReasonText reason={reason} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={t('lp.kpi.totalLessons')} value={course.stats.lessons} />
          <Figure label={t('lp.kpi.completedLessons')} value={course.stats.completedLessons} />
          <Figure label={t('lp.kpi.underReview')} value={course.stats.reviewAssets} icon={<ClipboardCheck size={14} className="text-indigo-700" />} />
          <Figure label={t('lp.kpi.overdue')} value={course.stats.overdueAssets} bad={course.stats.overdueAssets > 0} icon={<AlertTriangle size={14} className="text-status-bad" />} />
        </div>
        {blocked.assets > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-surface-line bg-white px-3 py-2 text-[13px] text-ink-muted">
            <Ban size={14} aria-hidden="true" />
            {t('lp.overview.blocked', { n: blocked.assets, lessons: blocked.lessons })}
          </p>
        )}

        <Section title={t('lp.dashboard.activity')}>
          <ActivityFeed entries={detail.activity} people={people} showWhere={false} />
        </Section>
      </div>

      <div className="space-y-4">
        <Section title={t('lp.overview.details')}>
          <dl className="space-y-2.5 text-[13px]">
            <Row label={t('lp.course.manager')}>
              <PersonChip userId={course.managerUserId} people={people} />
            </Row>
            <Row label={t('lp.course.startDate')}>{formatDate(course.startDate, lang)}</Row>
            <Row label={t('lp.course.targetDate')}>{formatDate(course.targetDate, lang)}</Row>
            <Row label={t('lp.priority')}>{t(`lp.priority.${course.priority}` as never)}</Row>
          </dl>
          {course.description && <p className="mt-3 whitespace-pre-line border-t border-surface-line pt-3 text-[13px] leading-relaxed text-ink-muted">{course.description}</p>}
        </Section>

        <Section
          title={t('lp.tab.team')}
          actions={
            <Link to="team" className="text-[12.5px] font-semibold text-brand-600 hover:underline">
              {t('lp.viewAll')}
            </Link>
          }
        >
          {team.length === 0 ? (
            <p className="text-[13px] text-ink-faint">{t('lp.team.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {team.slice(0, 8).map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-2">
                  <PersonChip userId={member.userId} people={people} />
                  <span className="truncate text-[11.5px] text-ink-faint">{member.roles.map((role) => t(roleKey(role))).join('، ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Figure({ label, value, icon, bad }: { label: string; value: number; icon?: React.ReactNode; bad?: boolean }) {
  return (
    <div className="rounded-2xl border border-surface-line bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
        {icon}
        {label}
      </p>
      <p className={bad ? 'mt-0.5 text-xl font-bold tabular-nums text-status-bad' : 'mt-0.5 text-xl font-bold tabular-nums text-ink'}>{value}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-end text-ink">{children}</dd>
    </div>
  );
}
