/**
 * Reports — operational production intelligence: what is finished, where
 * reviews wait, how many rounds each stage takes, who carries the load, and
 * which stage is holding production up.
 */

import { Link, useSearchParams } from 'react-router-dom';
import { Download, Hourglass } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, STAGE_HEX, healthKey, stageKey } from '../../lib/learningProduction/format';
import type { CourseWithStats, People, ReportsResponse } from '../../lib/learningProduction/types';
import { Chip, ErrorPanel, PageHeader, PersonChip, ProgressBar, Section, SkeletonRows, StageLabel } from '../../components/learning-production/kit';
import { WorkList } from '../../components/learning-production/WorkList';

function hours(value: number | null, t: ReturnType<typeof useI18n>['t']) {
  if (value === null) return '—';
  if (value < 24) return t('lp.reports.hours', { n: Math.round(value) });
  return t('lp.reports.days', { n: Math.round((value / 24) * 10) / 10 });
}

export function Reports() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const courseId = params.get('course') ?? '';
  const { data, error, loading, reload } = useLpQuery<ReportsResponse>(paths.reports(courseId || undefined));
  const { data: courseList } = useLpQuery<{ courses: CourseWithStats[]; people: People }>(paths.courses({}));

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [
      [t('lp.stage'), t('lp.reports.completion'), t('lp.reports.complete'), t('lp.reports.total'), t('lp.reports.review'), t('lp.reports.overdue'), t('lp.reports.avgReview'), t('lp.reports.avgWait'), t('lp.reports.versions'), t('lp.reports.rounds'), t('lp.reports.productionDays')],
      ...data.stages.map((stage) => [
        t(stageKey(stage.assetType)),
        `${stage.percent}%`,
        String(stage.complete),
        String(stage.total),
        String(stage.review),
        String(stage.overdue),
        stage.avgReviewHours === null ? '' : String(Math.round(stage.avgReviewHours)),
        stage.waitDays === null ? '' : String(stage.waitDays),
        stage.avgVersions === null ? '' : String(stage.avgVersions),
        stage.avgChangeRounds === null ? '' : String(stage.avgChangeRounds),
        stage.avgProductionDays === null ? '' : String(stage.avgProductionDays),
      ]),
      [],
      [t('lp.lesson.course'), t('lp.progress'), t('lp.course.health'), t('lp.kpi.totalLessons'), t('lp.kpi.completedLessons'), t('lp.kpi.overdue')],
      ...data.courses.map((course) => [course.name, `${course.progress}%`, t(healthKey(course.health)), String(course.stats.lessons), String(course.stats.completedLessons), String(course.stats.overdueAssets)]),
      [],
      [t('lp.person'), t('lp.workload.active'), t('lp.workload.review'), t('lp.workload.overdue')],
      ...data.workload.map((row) => [data.people[row.userId]?.name ?? row.userId, String(row.active), String(row.reviewing), String(row.overdue)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `production-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const maxThroughput = Math.max(1, ...(data?.throughput.map((week) => week.approved) ?? [1]));

  return (
    <>
      <PageHeader
        title={t('lp.reports.title')}
        description={t('lp.reports.subtitle')}
        actions={
          <>
            <select
              className="field !w-auto"
              value={courseId}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.value) next.set('course', event.target.value);
                else next.delete('course');
                setParams(next, { replace: true });
              }}
              aria-label={t('lp.lesson.course')}
            >
              <option value="">{t('lp.reports.allCourses')}</option>
              {courseList?.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn-ghost btn-sm" onClick={exportCsv} disabled={!data}>
              <Download size={14} />
              {t('lp.reports.export')}
            </button>
          </>
        }
      />

      {loading && !data ? (
        <SkeletonRows rows={6} height="h-16" />
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={cx('rounded-2xl border px-4 py-3', data.bottleneck ? 'border-amber-200 bg-status-warnBg' : 'border-surface-line bg-white')}>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted">
                <Hourglass size={14} aria-hidden="true" />
                {t('lp.reports.bottleneck')}
              </p>
              {data.bottleneck ? (
                <p className="mt-1 text-[15px] font-bold text-ink">
                  <StageLabel type={data.bottleneck.assetType} /> · {t('lp.reports.waitDays', { n: data.bottleneck.waitDays })}
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-ink-faint">{t('lp.reports.noBottleneck')}</p>
              )}
            </div>
            <div className="rounded-2xl border border-surface-line bg-white px-4 py-3">
              <p className="text-[12px] font-semibold text-ink-muted">{t('lp.reports.turnaround')}</p>
              <p className="mt-1 text-[15px] font-bold text-ink">{hours(data.reviewTurnaroundHours, t)}</p>
            </div>
            <div className="rounded-2xl border border-surface-line bg-white px-4 py-3">
              <p className="text-[12px] font-semibold text-ink-muted">{t('lp.reports.throughput')}</p>
              <div className="mt-2 flex h-10 items-end gap-1" role="img" aria-label={t('lp.reports.throughputLabel', { n: data.throughput.reduce((sum, week) => sum + week.approved, 0) })}>
                {data.throughput.map((week) => (
                  <span key={week.week} className="flex-1 rounded-t bg-brand-500/80" style={{ height: `${Math.max(4, (week.approved / maxThroughput) * 100)}%` }} title={`${week.week}: ${week.approved}`} />
                ))}
              </div>
            </div>
          </div>

          <Section title={t('lp.reports.stages')} bodyClassName="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-surface-line text-[11.5px] text-ink-faint">
                    <th className="px-4 py-2 text-start font-semibold">{t('lp.stage')}</th>
                    <th className="px-2 py-2 text-start font-semibold">{t('lp.reports.completion')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.review')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.overdue')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.avgReview')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.avgWait')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.versions')}</th>
                    <th className="px-2 py-2 text-end font-semibold">{t('lp.reports.rounds')}</th>
                    <th className="px-4 py-2 text-end font-semibold">{t('lp.reports.productionDays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stages.map((stage) => (
                    <tr key={stage.assetType} className={cx('border-b border-surface-line last:border-0', data.bottleneck?.assetType === stage.assetType && 'bg-status-warnBg/50')}>
                      <td className="px-4 py-2.5 font-semibold text-ink">
                        <StageLabel type={stage.assetType} />
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={stage.percent} className="max-w-[120px]" color={STAGE_HEX[stage.assetType]} />
                          <span className="tabular-nums">{stage.percent}%</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums">{stage.review}</td>
                      <td className={cx('px-2 py-2.5 text-end tabular-nums', stage.overdue > 0 && 'font-bold text-status-bad')}>{stage.overdue}</td>
                      <td className="px-2 py-2.5 text-end">{hours(stage.avgReviewHours, t)}</td>
                      <td className="px-2 py-2.5 text-end">{stage.waitDays === null ? '—' : t('lp.reports.days', { n: stage.waitDays })}</td>
                      <td className="px-2 py-2.5 text-end tabular-nums">{stage.avgVersions ?? '—'}</td>
                      <td className="px-2 py-2.5 text-end tabular-nums">{stage.avgChangeRounds ?? '—'}</td>
                      <td className="px-4 py-2.5 text-end">{stage.avgProductionDays === null ? '—' : t('lp.reports.days', { n: stage.avgProductionDays })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t('lp.reports.courses')} bodyClassName="!p-0">
              <ul className="divide-y divide-surface-line">
                {data.courses.map((course) => (
                  <li key={course.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                    <Link to={`/learning-production/courses/${course.id}`} className="min-w-0 flex-1 truncate font-semibold text-ink hover:text-brand-600">
                      {course.name}
                    </Link>
                    <ProgressBar value={course.progress} className="max-w-[110px]" />
                    <span className="w-9 text-end tabular-nums">{course.progress}%</span>
                    <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title={t('lp.dashboard.workload')} bodyClassName="!p-0">
              {data.workload.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink-faint">{t('lp.workload.empty')}</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11.5px] text-ink-faint">
                      <th className="px-4 py-2 text-start font-semibold">{t('lp.person')}</th>
                      <th className="px-2 py-2 text-end font-semibold">{t('lp.workload.active')}</th>
                      <th className="px-2 py-2 text-end font-semibold">{t('lp.workload.review')}</th>
                      <th className="px-4 py-2 text-end font-semibold">{t('lp.workload.overdue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workload.map((row) => (
                      <tr key={row.userId} className="border-t border-surface-line">
                        <td className="max-w-0 px-4 py-2">
                          <PersonChip userId={row.userId} people={data.people} />
                        </td>
                        <td className="px-2 py-2 text-end tabular-nums">{row.active}</td>
                        <td className="px-2 py-2 text-end tabular-nums">{row.reviewing}</td>
                        <td className={cx('px-4 py-2 text-end tabular-nums', row.overdue > 0 && 'font-bold text-status-bad')}>{row.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>

          <Section title={t('lp.reports.overdueList', { n: data.overdue.length })} bodyClassName="!p-0">
            <WorkList items={data.overdue} people={data.people} empty={t('lp.reports.noOverdue')} />
          </Section>
          <p className="text-[12px] text-ink-faint">{t('lp.reports.method', { lang })}</p>
        </div>
      ) : null}
    </>
  );
}
