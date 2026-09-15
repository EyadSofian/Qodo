/**
 * My Work — a production inbox, not a task list. What is late, what came back
 * with feedback, what is assigned, what waits for my review, and what I
 * finished recently. Every row opens the exact asset.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Inbox, RotateCcw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { paths } from '../../lib/learningProduction/api';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import type { MyWorkResponse } from '../../lib/learningProduction/types';
import { EmptyPanel, ErrorPanel, PageHeader, SkeletonRows } from '../../components/learning-production/kit';
import { WorkList } from '../../components/learning-production/WorkList';

export function MyWork() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<MyWorkResponse>(paths.myWork);

  const header = <PageHeader title={t('lp.myWork.title')} description={t('lp.myWork.subtitle')} />;
  if (loading && !data) {
    return (
      <>
        {header}
        <SkeletonRows rows={6} height="h-16" />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        {header}
        <ErrorPanel error={error} onRetry={reload} />
      </>
    );
  }
  if (!data) return null;

  const { sections, people } = data;
  const open = sections.overdue.length + sections.changesRequested.length + sections.assigned.length + sections.waitingForMyReview.length;

  return (
    <>
      {header}
      {open === 0 && sections.recentlyCompleted.length === 0 ? (
        <EmptyPanel icon={<Inbox size={26} />} title={t('lp.myWork.emptyTitle')} body={t('lp.myWork.emptyBody')} />
      ) : (
        <div className="space-y-4">
          {open === 0 && <EmptyPanel icon={<CheckCircle2 size={24} />} title={t('lp.myWork.caughtUp')} />}
          <Group icon={<AlertTriangle size={16} className="text-status-bad" />} title={t('lp.myWork.overdue')} count={sections.overdue.length}>
            <WorkList items={sections.overdue} people={people} show="none" />
          </Group>
          <Group icon={<RotateCcw size={16} className="text-accent-700" />} title={t('lp.myWork.changesRequested')} count={sections.changesRequested.length}>
            <WorkList items={sections.changesRequested} people={people} show="none" />
          </Group>
          <Group icon={<Inbox size={16} className="text-brand-500" />} title={t('lp.myWork.assigned')} count={sections.assigned.length}>
            <WorkList items={sections.assigned} people={people} show="none" />
          </Group>
          <Group icon={<ClipboardCheck size={16} className="text-indigo-700" />} title={t('lp.myWork.review')} count={sections.waitingForMyReview.length}>
            <WorkList items={sections.waitingForMyReview} people={people} show="submitted" />
          </Group>
          <Group icon={<CheckCircle2 size={16} className="text-status-ok" />} title={t('lp.myWork.completed')} count={sections.recentlyCompleted.length} quiet>
            <WorkList items={sections.recentlyCompleted} people={people} show="none" />
          </Group>
        </div>
      )}
    </>
  );
}

function Group({ icon, title, count, children, quiet }: { icon: ReactNode; title: string; count: number; children: ReactNode; quiet?: boolean }) {
  if (count === 0) return null;
  return (
    <section className={quiet ? 'rounded-2xl border border-surface-line bg-white/70' : 'rounded-2xl border border-surface-line bg-white'}>
      <h2 className="flex items-center gap-2 border-b border-surface-line px-4 py-3 text-sm font-bold text-ink">
        {icon}
        {title}
        <span className="rounded-full bg-surface-sunken px-2 text-[12px] font-semibold tabular-nums text-ink-muted">{count}</span>
      </h2>
      {children}
    </section>
  );
}
