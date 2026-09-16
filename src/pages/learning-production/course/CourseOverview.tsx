/**
 * Course overview: where production stands, what is moving right now, and what
 * needs somebody today.
 *
 * Four figures, the five stages, then the two questions a production manager
 * opens a course to answer — "what is in flight?" and "what is stuck?" — side
 * by side. Everything slower-moving (the description, the dates, the team, the
 * history) sits underneath, because it is context rather than work.
 */

import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, ClipboardCheck, Clock, RotateCcw, SquareStack } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { formatDate } from '../../../lib/utils';
import { paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, roleKey, stageKey } from '../../../lib/learningProduction/format';
import type { AssetSummary, HealthReason, MatrixLesson, MatrixResponse } from '../../../lib/learningProduction/types';
import {
  ActivityFeed,
  AttentionNote,
  DueChip,
  KpiCard,
  PersonChip,
  Section,
  SkeletonRows,
  StageTag,
  StatusBadge,
} from '../../../components/learning-production/kit';
import { StageCards } from '../../../components/learning-production/CourseProgress';
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

/** Overdue first, then what is due soonest — the order a manager works in. */
const URGENCY: Record<string, number> = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2 };

export function CourseOverview() {
  const { t, lang } = useI18n();
  const { detail } = useCourse();
  const { course, stages, team, people, blocked } = detail;
  // The same cached response the Content and Production tabs read — the
  // overview never asks the server for a lesson list of its own.
  const { data: matrix, loading } = useLpQuery<MatrixResponse>(paths.matrix(course.id));

  const inFlight = useMemo(() => {
    if (!matrix) return [];
    const rows: Array<{ lesson: MatrixLesson; asset: AssetSummary }> = [];
    for (const lesson of matrix.lessons) {
      if (!lesson.currentStage || lesson.state === 'COMPLETE' || lesson.state === 'NOT_STARTED') continue;
      const asset = lesson.assets[lesson.currentStage];
      if (asset) rows.push({ lesson, asset });
    }
    return rows
      .sort((a, b) => {
        const urgency = (URGENCY[a.asset.dueState ?? ''] ?? 3) - (URGENCY[b.asset.dueState ?? ''] ?? 3);
        if (urgency) return urgency;
        return String(a.asset.dueDate ?? '9999').localeCompare(String(b.asset.dueDate ?? '9999'));
      })
      .slice(0, 6);
  }, [matrix]);

  const overdueByStage = STAGES.map((type) => ({ type, n: stages.find((stage) => stage.assetType === type)?.overdue ?? 0 })).filter((entry) => entry.n > 0);
  const stagesInReview = stages.filter((stage) => stage.review > 0).length;
  const production = `/learning-production/courses/${course.id}/production`;

  const attention = [
    course.stats.overdueAssets > 0 && {
      key: 'overdue',
      icon: <AlertTriangle size={14} className="text-status-bad" />,
      title: t('lp.overview.attention.overdue', { n: course.stats.overdueAssets }),
      body: overdueByStage.map((entry) => `${entry.n} ${t(stageKey(entry.type))}`).join(' · '),
      to: `${production}?quick=OVERDUE`,
    },
    course.stats.reviewAssets > 0 && {
      key: 'review',
      icon: <ClipboardCheck size={14} className="text-indigo-700" />,
      title: t('lp.overview.attention.review', { n: course.stats.reviewAssets }),
      body: t('lp.overview.attention.reviewBody', { n: stagesInReview }),
      to: `${production}?quick=REVIEW`,
    },
    course.stats.changesAssets > 0 && {
      key: 'changes',
      icon: <RotateCcw size={14} className="text-accent-700" />,
      title: t('lp.overview.attention.changes', { n: course.stats.changesAssets }),
      body: t('lp.overview.attention.changesBody'),
      to: `${production}?quick=CHANGES`,
    },
    blocked.assets > 0 && {
      key: 'blocked',
      icon: <Ban size={14} className="text-ink-muted" />,
      title: t('lp.overview.attention.blocked', { n: blocked.assets, lessons: blocked.lessons }),
      body: t('lp.overview.attention.blockedBody'),
      to: `${production}?quick=BLOCKED`,
    },
  ].filter(Boolean) as Array<{ key: string; icon: ReactNode; title: string; body: string; to: string }>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t('lp.overallCompletion')} value={`${course.progress}%`} progress={course.progress} />
        <KpiCard
          label={t('lp.kpi.totalLessons')}
          value={course.stats.lessons}
          sub={t('lp.overview.inProduction', { n: Math.max(0, course.stats.lessons - course.stats.completedLessons) })}
        />
        <KpiCard
          label={t('lp.kpi.underReview')}
          value={course.stats.reviewAssets}
          sub={t('lp.overview.acrossStages', { n: stagesInReview })}
          icon={<ClipboardCheck size={13} className="text-indigo-700" />}
        />
        <KpiCard
          label={t('lp.kpi.overdue')}
          value={course.stats.overdueAssets}
          bad={course.stats.overdueAssets > 0}
          sub={overdueByStage.length ? overdueByStage.map((entry) => `${entry.n} ${t(stageKey(entry.type))}`).join(' · ') : t('lp.overview.noneOverdue')}
          icon={<AlertTriangle size={13} className={course.stats.overdueAssets > 0 ? 'text-status-bad' : 'text-ink-faint'} />}
        />
      </div>

      <StageCards stages={stages} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Section
          title={t('lp.overview.current')}
          actions={
            <Link to="production" className="btn-ghost btn-sm">
              <SquareStack size={14} />
              {t('lp.overview.openMatrix')}
            </Link>
          }
          bodyClassName="!p-0"
        >
          {loading && !matrix ? (
            <div className="p-4">
              <SkeletonRows rows={3} />
            </div>
          ) : inFlight.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-faint">{t('lp.overview.nothingInFlight')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-surface-line bg-surface-bg/70 text-[11.5px] text-ink-muted">
                    <th className="px-4 py-2 text-start font-bold">{t('lp.lesson')}</th>
                    <th className="px-2 py-2 text-start font-bold">{t('lp.overview.currentStage')}</th>
                    <th className="px-2 py-2 text-start font-bold">{t('lp.status')}</th>
                    <th className="px-2 py-2 text-start font-bold">{t('lp.assignee')}</th>
                    <th className="px-4 py-2 text-start font-bold">{t('lp.dueDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inFlight.map(({ lesson, asset }) => (
                    <tr key={lesson.id} className="border-b border-surface-line last:border-0 hover:bg-surface-bg/60">
                      <td className="max-w-[240px] px-4 py-2.5">
                        <Link to={`/learning-production/courses/${course.id}/lessons/${lesson.id}`} className="block truncate font-bold text-ink hover:text-brand-600">
                          {lesson.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5">
                        <StageTag type={asset.assetType} />
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusBadge status={asset.status} blocked={asset.blocked} size="sm" />
                      </td>
                      <td className="px-2 py-2.5">
                        <PersonChip userId={asset.assigneeUserId} people={matrix?.people ?? people} size={20} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <DueChip dueDate={asset.dueDate} dueState={asset.dueState} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t('lp.dashboard.attention')}>
          {attention.length === 0 && course.healthReasons.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-faint">{t('lp.attention.allClear')}</p>
          ) : (
            <div className="space-y-2">
              {attention.map((note) => (
                <AttentionNote key={note.key} icon={note.icon} title={note.title} body={note.body} to={note.to} />
              ))}
              {course.healthReasons.length > 0 && (
                <AttentionNote
                  icon={<Clock size={14} className="text-accent-600" />}
                  title={t(`lp.health.${course.health}` as never)}
                  body={
                    <span className="space-y-0.5">
                      {course.healthReasons.map((reason) => (
                        <span key={reason.code} className="block">
                          <HealthReasonText reason={reason} />
                        </span>
                      ))}
                    </span>
                  }
                />
              )}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Section
          title={t('lp.dashboard.activity')}
          actions={
            <Link to="activity" className="text-[12.5px] font-semibold text-brand-600 hover:underline">
              {t('lp.viewAll')}
            </Link>
          }
        >
          <ActivityFeed entries={detail.activity} people={people} showWhere={false} />
        </Section>

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
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-end text-ink">{children}</dd>
    </div>
  );
}
