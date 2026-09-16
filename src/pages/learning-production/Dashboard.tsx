/**
 * The production dashboard. Five questions, answered without a click: how much
 * is being made, how much is finished, what is late, what waits for review,
 * and who is carrying too much.
 *
 * It is the one screen in the module that is allowed to be loud. Everywhere
 * else a colour has to earn its place against the work it sits next to; here
 * the figures *are* the content, so each one carries its own tone — brand blue
 * for the catalogue, navy for its size, green for what is finished, indigo for
 * what sits with a reviewer, amber for what came back, red for what is late —
 * and every chart reuses the colour its own badge already has, so a slice of
 * "Changes requested" is the same amber as the chip that says it.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  Library,
  ListTree,
  Plus,
  RotateCcw,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { cx, formatDate } from '../../lib/utils';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { HEALTH_TONE, STAGE_HEX, STAGES, formatDay, healthKey, stageKey, statusKey } from '../../lib/learningProduction/format';
import type { AssetStatus, AttentionKind, CourseHealth, DashboardResponse, People, StageStat, WorkItem } from '../../lib/learningProduction/types';
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
import { ColumnTrend, Donut, HEALTH_HEX, Legend, LoadBars, STATUS_HEX, StackedBar } from '../../components/learning-production/charts';
import { WorkList } from '../../components/learning-production/WorkList';

/** Each headline figure's own colour: tile, number and border come from one row. */
interface Palette {
  bg: string;
  border: string;
  ink: string;
  tile: string;
}

const PALETTES: Record<string, Palette> = {
  brand: { bg: 'bg-brand-50', border: 'border-brand-100', ink: 'text-brand-700', tile: 'bg-brand-500' },
  navy: { bg: 'bg-surface-sunken', border: 'border-surface-line', ink: 'text-navy', tile: 'bg-navy' },
  green: { bg: 'bg-status-okBg', border: 'border-green-200', ink: 'text-green-700', tile: 'bg-status-ok' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', ink: 'text-indigo-700', tile: 'bg-indigo-600' },
  amber: { bg: 'bg-status-warnBg', border: 'border-amber-200', ink: 'text-accent-700', tile: 'bg-status-warn' },
  red: { bg: 'bg-status-badBg', border: 'border-red-200', ink: 'text-status-bad', tile: 'bg-status-bad' },
};

/** The four statuses a stage bar is cut into, in the order work moves through them. */
const STAGE_SEGMENTS: Array<{ key: string; status: AssetStatus; pick: (stage: StageStat) => number }> = [
  { key: 'complete', status: 'APPROVED', pick: (stage) => stage.complete },
  { key: 'review', status: 'UNDER_REVIEW', pick: (stage) => stage.review },
  { key: 'changes', status: 'CHANGES_REQUESTED', pick: (stage) => stage.changes },
  { key: 'working', status: 'IN_PROGRESS', pick: (stage) => stage.inProgress },
];

const HEALTHS: CourseHealth[] = ['ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED'];
const MIX_ORDER: AssetStatus[] = ['APPROVED', 'LOCKED', 'UNDER_REVIEW', 'RESUBMITTED', 'SUBMITTED', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'ASSIGNED', 'NOT_STARTED'];

export function Dashboard() {
  const { t, lang } = useI18n();
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
            <div key={index} className="skeleton h-[104px]" />
          ))}
        </div>
        <SkeletonRows rows={6} height="h-14" />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const { kpis, attention, statusMix, throughput, healthCounts } = data;
  const hasWork = kpis.totalLessons > 0 || data.watchlist.length > 0;
  const completedShare = kpis.totalLessons ? Math.round((kpis.completedLessons / kpis.totalLessons) * 100) : 0;
  const totalAssets = MIX_ORDER.reduce((sum, status) => sum + (statusMix?.[status] ?? 0), 0);
  const openAssets = totalAssets - (statusMix?.APPROVED ?? 0) - (statusMix?.LOCKED ?? 0);
  const totalCourses = HEALTHS.reduce((sum, health) => sum + (healthCounts?.[health] ?? 0), 0);
  const weeks = throughput ?? [];
  const lastWeek = weeks[weeks.length - 1]?.approved ?? 0;
  const previousWeek = weeks[weeks.length - 2]?.approved ?? 0;

  return (
    <>
      <PageHeader title={t('lp.dashboard.title')} description={t('lp.dashboard.subtitle')} actions={newCourse} />

      {(data.mine.assigned > 0 || data.mine.reviews > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-100 bg-brand-50/70 px-4 py-3 text-[13px]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-white">
            <Inbox size={15} aria-hidden="true" />
          </span>
          <span className="font-semibold text-ink">{t('lp.dashboard.yourWork')}</span>
          {data.mine.assigned > 0 && (
            <Link to="/learning-production/my-work" className="font-semibold text-brand-700 hover:underline">
              {t('lp.dashboard.assignedToYou', { n: data.mine.assigned })}
            </Link>
          )}
          {data.mine.reviews > 0 && (
            <Link to="/learning-production/reviews" className="font-semibold text-indigo-700 hover:underline">
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
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi palette="brand" icon={Library} label={t('lp.kpi.activeCourses')} value={kpis.activeCourses} hint={t('lp.dashboard.ofCourses', { n: totalCourses })} to="/learning-production/courses" />
            <Kpi palette="navy" icon={ListTree} label={t('lp.kpi.totalLessons')} value={kpis.totalLessons} hint={t('lp.dashboard.assetsTotal', { n: totalAssets })} />
            <Kpi palette="green" icon={CheckCircle2} label={t('lp.kpi.completedLessons')} value={kpis.completedLessons} hint={`${completedShare}%`} bar={completedShare} />
            <Kpi palette="indigo" icon={ClipboardCheck} label={t('lp.kpi.underReview')} value={kpis.underReview} hint={t('lp.dashboard.dueSoon', { n: kpis.dueSoon })} onClick={() => setOpen('review')} />
            <Kpi palette="amber" icon={RotateCcw} label={t('lp.kpi.changesRequested')} value={kpis.changesRequested} hint={t('lp.dashboard.blockedShort', { n: attention.blockedAssets })} onClick={() => setOpen('changes')} />
            <Kpi palette="red" icon={AlertTriangle} label={t('lp.kpi.overdue')} value={kpis.overdue} hint={t('lp.dashboard.ofOpen', { n: openAssets })} onClick={() => setOpen('overdue')} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Section title={t('lp.dashboard.progress')}>
              <div className="space-y-3.5">
                {data.stages.map((stage) => {
                  const rest = Math.max(0, stage.total - STAGE_SEGMENTS.reduce((sum, segment) => sum + segment.pick(stage), 0));
                  return (
                    <div key={stage.assetType}>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[13px]">
                        <span className="flex items-center gap-2 font-bold text-ink">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_HEX[stage.assetType] }} aria-hidden="true" />
                          {t(stageKey(stage.assetType))}
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span className="text-[15px] font-extrabold tabular-nums" style={{ color: STAGE_HEX[stage.assetType] }}>
                            {stage.percent}%
                          </span>
                          <span className="text-[11.5px] tabular-nums text-ink-faint">
                            {stage.complete}/{stage.total}
                          </span>
                        </span>
                      </div>
                      <StackedBar
                        height="h-3"
                        slices={[
                          ...STAGE_SEGMENTS.map((segment) => ({
                            key: segment.key,
                            label: t(statusKey(segment.status)),
                            value: segment.pick(stage),
                            color: STATUS_HEX[segment.status],
                          })),
                          { key: 'rest', label: t('lp.status.NOT_STARTED'), value: rest, color: STATUS_HEX.NOT_STARTED },
                        ]}
                      />
                      {stage.overdue > 0 && (
                        <p className="mt-1 text-[11px] font-semibold text-status-bad">{t('lp.dashboard.stageOverdue', { n: stage.overdue })}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 border-t border-surface-line pt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[13px] font-bold text-ink">{t('lp.overallCompletion')}</span>
                  <span className="text-lg font-extrabold tabular-nums text-status-ok">{data.overallPercent}%</span>
                </div>
                <ProgressBar value={data.overallPercent} tone="ok" className="!h-2.5" label={t('lp.overallCompletion')} />
                <Legend
                  items={[
                    { key: 'done', label: t('lp.status.APPROVED'), color: STATUS_HEX.APPROVED },
                    { key: 'review', label: t('lp.status.UNDER_REVIEW'), color: STATUS_HEX.UNDER_REVIEW },
                    { key: 'changes', label: t('lp.status.CHANGES_REQUESTED'), color: STATUS_HEX.CHANGES_REQUESTED },
                    { key: 'working', label: t('lp.status.IN_PROGRESS'), color: STATUS_HEX.IN_PROGRESS },
                    { key: 'not', label: t('lp.status.NOT_STARTED'), color: STATUS_HEX.NOT_STARTED },
                  ]}
                />
              </div>
            </Section>

            <Section title={t('lp.dashboard.statusMix')}>
              <Donut
                slices={MIX_ORDER.filter((status) => (statusMix?.[status] ?? 0) > 0).map((status) => ({
                  key: status,
                  label: t(statusKey(status)),
                  value: statusMix?.[status] ?? 0,
                  color: STATUS_HEX[status],
                }))}
                total={totalAssets}
                caption={t('lp.dashboard.assetsWord')}
                layout="stack"
                size={148}
              />
              <div className="mt-4 border-t border-surface-line pt-3">
                <p className="mb-2 text-[11.5px] font-semibold text-ink-muted">{t('lp.dashboard.mixBar')}</p>
                <StackedBar
                  height="h-4"
                  slices={MIX_ORDER.map((status) => ({
                    key: status,
                    label: t(statusKey(status)),
                    value: statusMix?.[status] ?? 0,
                    color: STATUS_HEX[status],
                  }))}
                />
                <p className="mt-2 text-[11.5px] text-ink-faint">{t('lp.dashboard.mixHint', { done: (statusMix?.APPROVED ?? 0) + (statusMix?.LOCKED ?? 0), open: openAssets })}</p>
              </div>
            </Section>

            <Section title={t('lp.dashboard.healthMix')}>
              <Donut
                slices={HEALTHS.filter((health) => (healthCounts?.[health] ?? 0) > 0).map((health) => ({
                  key: health,
                  label: t(healthKey(health)),
                  value: healthCounts?.[health] ?? 0,
                  color: HEALTH_HEX[health],
                }))}
                caption={t('lp.dashboard.coursesWord')}
                layout="stack"
                legendColumns={1}
                size={148}
              />
              <ul className="mt-4 grid gap-2 border-t border-surface-line pt-3">
                <AttentionTile palette="red" icon={AlertTriangle} count={attention.overdue} label="lp.attention.overdue" active={open === 'overdue'} onClick={() => setOpen(open === 'overdue' ? null : 'overdue')} />
                <AttentionTile palette="indigo" icon={ClipboardCheck} count={attention.review} label="lp.attention.review" active={open === 'review'} onClick={() => setOpen(open === 'review' ? null : 'review')} />
                <AttentionTile palette="amber" icon={RotateCcw} count={attention.changes} label="lp.attention.changes" active={open === 'changes'} onClick={() => setOpen(open === 'changes' ? null : 'changes')} />
                <AttentionTile palette="navy" icon={Ban} count={attention.blockedLessons} label="lp.attention.blocked" active={open === 'blocked'} onClick={() => setOpen(open === 'blocked' ? null : 'blocked')} />
              </ul>
            </Section>
          </div>

          {open && <AttentionList kind={open} onClose={() => setOpen(null)} />}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section
              title={t('lp.dashboard.throughput')}
              actions={
                <span className={cx('inline-flex items-center gap-1 text-[12px] font-bold', lastWeek >= previousWeek ? 'text-status-ok' : 'text-accent-700')}>
                  <TrendingUp size={13} className={lastWeek >= previousWeek ? '' : 'rotate-180'} aria-hidden="true" />
                  {t('lp.dashboard.thisWeek', { n: lastWeek })}
                </span>
              }
            >
              <ColumnTrend
                height={164}
                points={weeks.map((week, index) => ({
                  label: formatDay(week.week, lang),
                  value: week.approved,
                  highlight: index === weeks.length - 1,
                }))}
              />
              <p className="mt-2 text-[11.5px] text-ink-faint">{t('lp.dashboard.throughputHint')}</p>
            </Section>

            {data.managerView ? (
              <Section title={t('lp.dashboard.workload')}>
                <LoadBars
                  empty={t('lp.workload.empty')}
                  rows={data.workload.map((row) => ({
                    key: row.userId,
                    label: <PersonChip userId={row.userId} people={data.people} size={20} />,
                    active: row.active,
                    reviewing: row.reviewing,
                    overdue: row.overdue,
                  }))}
                />
                <div className="mt-3 border-t border-surface-line pt-2.5">
                  <Legend
                    items={[
                      { key: 'active', label: t('lp.workload.active'), color: '#4A8FCB' },
                      { key: 'review', label: t('lp.workload.review'), color: '#4F46E5' },
                      { key: 'overdue', label: t('lp.workload.overdue'), color: '#DC2626' },
                    ]}
                  />
                </div>
              </Section>
            ) : (
              <Section title={t('lp.dashboard.stagesShare')}>
                <Donut
                  slices={STAGES.map((type) => ({
                    key: type,
                    label: t(stageKey(type)),
                    value: data.stages.find((stage) => stage.assetType === type)?.complete ?? 0,
                    color: STAGE_HEX[type],
                  }))}
                  caption={t('lp.dashboard.approvedWord')}
                />
              </Section>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

            <Section title={t('lp.dashboard.activity')}>
              <ActivityFeed entries={data.activity} people={data.people} />
            </Section>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({
  palette,
  icon: Icon,
  label,
  value,
  hint,
  bar,
  to,
  onClick,
}: {
  palette: keyof typeof PALETTES;
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  bar?: number;
  to?: string;
  onClick?: () => void;
}) {
  const tone = PALETTES[palette];
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white', tone.tile)}>
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-muted">{label}</span>
      </span>
      <span className={cx('mt-2 block text-[26px] font-extrabold leading-none tabular-nums', tone.ink)}>{value}</span>
      {bar !== undefined && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/70">
          <span className={cx('block h-full rounded-full', tone.tile)} style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} />
        </span>
      )}
      {hint && <span className="mt-1.5 block truncate text-[11.5px] font-semibold text-ink-muted">{hint}</span>}
    </>
  );
  const className = cx('block rounded-2xl border px-3.5 py-3 text-start transition-shadow', tone.bg, tone.border);
  if (to) return <Link to={to} className={cx(className, 'hover:shadow-card')}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(className, 'hover:shadow-card')}>{body}</button>;
  return <div className={className}>{body}</div>;
}

function AttentionTile({
  palette,
  icon: Icon,
  count,
  label,
  active,
  onClick,
}: {
  palette: keyof typeof PALETTES;
  icon: LucideIcon;
  count: number;
  label: StringKey;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const tone = PALETTES[palette];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={count === 0}
        aria-expanded={active}
        className={cx(
          'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-start transition-all disabled:cursor-default',
          count === 0 ? 'border-surface-line bg-white opacity-60' : cx(tone.bg, tone.border, 'hover:shadow-card'),
          active && 'ring-2 ring-brand-300'
        )}
      >
        <Icon size={15} className={count === 0 ? 'text-ink-faint' : tone.ink} aria-hidden="true" />
        <span className={cx('text-[17px] font-extrabold tabular-nums', count === 0 ? 'text-ink-faint' : tone.ink)}>{count}</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink-muted">{t(label, { n: count })}</span>
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
                <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: HEALTH_HEX[course.health] }} aria-hidden="true" />
                <BookOpen size={15} className="shrink-0 text-brand-500" aria-hidden="true" />
                <span className="truncate text-[13.5px] font-semibold text-ink">{course.name}</span>
              </span>
              <Chip tone={HEALTH_TONE[course.health]}>{t(healthKey(course.health))}</Chip>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={course.progress} color={HEALTH_HEX[course.health]} />
              <span className="w-9 shrink-0 text-end text-[12px] font-semibold tabular-nums text-ink">{course.progress}%</span>
            </div>
            <p className="mt-1 flex items-center gap-2 truncate text-[11.5px] text-ink-faint">
              <Library size={11} aria-hidden="true" />
              {t('lp.course.lessonsCount', { n: course.stats.lessons })}
              {course.stats.overdueAssets > 0 && <span className="font-bold text-status-bad">· {t('lp.dashboard.stageOverdue', { n: course.stats.overdueAssets })}</span>}
              {course.targetDate && <span>· {t('lp.course.target')}: {formatDate(course.targetDate, lang)}</span>}
              {course.managerUserId && <span className="truncate">· {people[course.managerUserId]?.name ?? ''}</span>}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
