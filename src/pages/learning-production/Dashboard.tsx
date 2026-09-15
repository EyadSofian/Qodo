/**
 * The production dashboard. Five questions, answered without a click: how much
 * is being made, how much is finished, what is late, what waits for review,
 * and who is carrying too much.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, BookOpen, ClipboardCheck, GraduationCap, Inbox, Library, Plus, RotateCcw } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx, formatDate } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, healthKey } from '../../lib/learningProduction/format';
import type { AttentionKind, DashboardResponse, People, WorkItem } from '../../lib/learningProduction/types';
import {
  ActivityFeed,
  Chip,
  EmptyPanel,
  ErrorPanel,
  PageHeader,
  PersonChip,
  ProgressBar,
  Section,
  SkeletonRows,
} from '../../components/learning-production/kit';
import { StageBars } from '../../components/learning-production/CourseProgress';
import { WorkList } from '../../components/learning-production/WorkList';

export function Dashboard() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<DashboardResponse>(paths.dashboard);
  const [open, setOpen] = useState<AttentionKind | null>(null);

  const newCourse = data?.canCreateCourse ? (
    <Link to="/learning-production/courses/new" className="btn-primary btn-sm">
      <Plus size={15} />
      {t('lp.course.new')}
    </Link>
  ) : null;

  if (loading && !data) {
    return (
      <>
        <PageHeader title={t('lp.dashboard.title')} description={t('lp.dashboard.subtitle')} />
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton h-[84px]" />
          ))}
        </div>
        <SkeletonRows rows={6} height="h-14" />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const { kpis, attention } = data;
  const hasWork = kpis.totalLessons > 0 || data.watchlist.length > 0;

  return (
    <>
      <PageHeader title={t('lp.dashboard.title')} description={t('lp.dashboard.subtitle')} actions={newCourse} />

      {(data.mine.assigned > 0 || data.mine.reviews > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-surface-line bg-white px-4 py-3 text-[13px]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <Inbox size={15} aria-hidden="true" />
          </span>
          <span className="font-semibold text-ink">{t('lp.dashboard.yourWork')}</span>
          {data.mine.assigned > 0 && (
            <Link to="/learning-production/my-work" className="font-semibold text-brand-600 hover:underline">
              {t('lp.dashboard.assignedToYou', { n: data.mine.assigned })}
            </Link>
          )}
          {data.mine.reviews > 0 && (
            <Link to="/learning-production/reviews" className="font-semibold text-brand-600 hover:underline">
              {t('lp.dashboard.waitingForYou', { n: data.mine.reviews })}
            </Link>
          )}
          {data.mine.overdue > 0 && <Chip tone="bad">{t('lp.dashboard.yourOverdue', { n: data.mine.overdue })}</Chip>}
        </div>
      )}

      {!hasWork ? (
        <EmptyPanel
          icon={<GraduationCap size={28} />}
          title={t('lp.course.emptyTitle')}
          body={data.canCreateCourse ? t('lp.course.emptyBodyManager') : t('lp.course.emptyBody')}
          action={
            data.canCreateCourse ? (
              <Link to="/learning-production/courses/new" className="btn-primary btn-sm">
                <Plus size={15} />
                {t('lp.course.createFirst')}
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label={t('lp.kpi.activeCourses')} value={kpis.activeCourses} to="/learning-production/courses" />
            <Kpi label={t('lp.kpi.totalLessons')} value={kpis.totalLessons} />
            <Kpi label={t('lp.kpi.completedLessons')} value={kpis.completedLessons} hint={`${kpis.totalLessons ? Math.round((kpis.completedLessons / kpis.totalLessons) * 100) : 0}%`} />
            <Kpi label={t('lp.kpi.underReview')} value={kpis.underReview} onClick={() => setOpen('review')} />
            <Kpi label={t('lp.kpi.changesRequested')} value={kpis.changesRequested} tone={kpis.changesRequested ? 'warn' : undefined} onClick={() => setOpen('changes')} />
            <Kpi label={t('lp.kpi.overdue')} value={kpis.overdue} tone={kpis.overdue ? 'bad' : undefined} onClick={() => setOpen('overdue')} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Section title={t('lp.dashboard.progress')}>
              <StageBars stages={data.stages} overall={data.overallPercent} />
            </Section>

            <Section title={t('lp.dashboard.attention')}>
              <ul className="space-y-1.5">
                <AttentionRow icon={AlertTriangle} tone="bad" count={attention.overdue} label="lp.attention.overdue" active={open === 'overdue'} onClick={() => setOpen(open === 'overdue' ? null : 'overdue')} />
                <AttentionRow icon={ClipboardCheck} tone="review" count={attention.review} label="lp.attention.review" active={open === 'review'} onClick={() => setOpen(open === 'review' ? null : 'review')} />
                <AttentionRow icon={RotateCcw} tone="warn" count={attention.changes} label="lp.attention.changes" active={open === 'changes'} onClick={() => setOpen(open === 'changes' ? null : 'changes')} />
                <AttentionRow icon={Ban} tone="neutral" count={attention.blockedLessons} label="lp.attention.blocked" active={open === 'blocked'} onClick={() => setOpen(open === 'blocked' ? null : 'blocked')} />
              </ul>
              {attention.overdue + attention.review + attention.changes + attention.blockedLessons === 0 && (
                <p className="mt-2 text-[13px] text-status-ok">{t('lp.attention.allClear')}</p>
              )}
            </Section>
          </div>

          {open && <AttentionList kind={open} onClose={() => setOpen(null)} />}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Section
              title={t('lp.dashboard.courses')}
              actions={
                <Link to="/learning-production/courses" className="text-[12.5px] font-semibold text-brand-600 hover:underline">
                  {t('lp.viewAll')}
                </Link>
              }
              bodyClassName="!p-0"
            >
              <CourseWatchlist courses={data.watchlist} people={data.people} />
            </Section>

            {data.managerView && (
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
            )}

            <Section title={t('lp.dashboard.activity')} className={data.managerView ? '' : 'lg:col-span-2'}>
              <ActivityFeed entries={data.activity} people={data.people} />
            </Section>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, hint, tone, to, onClick }: { label: string; value: number; hint?: string; tone?: 'warn' | 'bad'; to?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-[12px] font-semibold text-ink-muted">{label}</span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className={cx('text-2xl font-bold tabular-nums', tone === 'bad' ? 'text-status-bad' : tone === 'warn' ? 'text-accent-700' : 'text-ink')}>{value}</span>
        {hint && <span className="text-[12px] text-ink-faint">{hint}</span>}
      </span>
    </>
  );
  const className = 'block rounded-2xl border border-surface-line bg-white px-3.5 py-2.5 text-start transition-shadow';
  if (to) return <Link to={to} className={cx(className, 'hover:shadow-card')}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(className, 'hover:shadow-card')}>{body}</button>;
  return <div className={className}>{body}</div>;
}

function AttentionRow({
  icon: Icon,
  tone,
  count,
  label,
  active,
  onClick,
}: {
  icon: typeof AlertTriangle;
  tone: 'bad' | 'warn' | 'review' | 'neutral';
  count: number;
  label: StringKey;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const color = count === 0 ? 'text-ink-faint' : { bad: 'text-status-bad', warn: 'text-accent-700', review: 'text-indigo-700', neutral: 'text-ink-muted' }[tone];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={count === 0}
        aria-expanded={active}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-[13.5px] transition-colors disabled:cursor-default',
          active ? 'bg-brand-50' : 'hover:bg-surface-bg'
        )}
      >
        <Icon size={17} className={color} aria-hidden="true" />
        <span className={cx('text-lg font-bold tabular-nums', color)}>{count}</span>
        <span className={cx('flex-1', count === 0 ? 'text-ink-faint' : 'text-ink')}>{t(label, { n: count })}</span>
      </button>
    </li>
  );
}

function AttentionList({ kind, onClose }: { kind: AttentionKind; onClose: () => void }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<{ items: WorkItem[]; people: People }>(paths.attention(kind));
  return (
    <Section
      className="mt-4"
      title={t(`lp.attention.list.${kind}` as StringKey)}
      actions={
        <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
          {t('common.close')}
        </button>
      }
      bodyClassName="!p-0"
    >
      {loading && !data ? (
        <div className="p-4">
          <SkeletonRows rows={3} />
        </div>
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : (
        <WorkList items={data?.items ?? []} people={data?.people ?? {}} empty={t('lp.attention.allClear')} />
      )}
    </Section>
  );
}

function CourseWatchlist({ courses, people }: { courses: DashboardResponse['watchlist']; people: People }) {
  const { t, lang } = useI18n();
  if (courses.length === 0) return <p className="px-4 py-6 text-center text-[13px] text-ink-faint">{t('lp.course.noneActive')}</p>;
  return (
    <ul className="divide-y divide-surface-line">
      {courses.map((course) => (
        <li key={course.id}>
          <Link to={`/learning-production/courses/${course.id}`} className="block px-4 py-3 hover:bg-surface-bg">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <BookOpen size={15} className="shrink-0 text-brand-500" aria-hidden="true" />
                <span className="truncate text-[13.5px] font-semibold text-ink">{course.name}</span>
              </span>
              <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={course.progress} />
              <span className="w-9 shrink-0 text-end text-[12px] font-semibold tabular-nums text-ink">{course.progress}%</span>
            </div>
            <p className="mt-1 flex items-center gap-2 truncate text-[11.5px] text-ink-faint">
              <Library size={11} aria-hidden="true" />
              {t('lp.course.lessonsCount', { n: course.stats.lessons })}
              {course.targetDate && <span>· {t('lp.course.target')}: {formatDate(course.targetDate, lang)}</span>}
              {course.managerUserId && <span className="truncate">· {people[course.managerUserId]?.name ?? ''}</span>}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
