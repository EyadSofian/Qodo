/**
 * The course history, in sentences, newest first.
 */

import { useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { lp, paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import type { ActivityEntry, People } from '../../../lib/learningProduction/types';
import { ActivityFeed, ErrorPanel, Section, SkeletonRows } from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';

export function CourseActivity() {
  const { t } = useI18n();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const { data, error, loading, reload } = useLpQuery<{ entries: ActivityEntry[]; hasMore: boolean; people: People }>(paths.courseActivity(courseId));
  const [older, setOlder] = useState<{ entries: ActivityEntry[]; people: People; hasMore: boolean }>({ entries: [], people: {}, hasMore: true });

  if (loading && !data) return <SkeletonRows rows={6} />;
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const entries = [...data.entries, ...older.entries];
  const hasMore = older.entries.length ? older.hasMore : data.hasMore;
  const loadMore = async () => {
    const next = await lp.courseActivity(courseId, entries[entries.length - 1]?.id);
    setOlder((current) => ({ entries: [...current.entries, ...next.entries], people: { ...current.people, ...next.people }, hasMore: next.hasMore }));
  };

  return (
    <Section title={t('lp.tab.activity')}>
      <ActivityFeed entries={entries} people={{ ...data.people, ...older.people }} showWhere={false} />
      {hasMore && (
        <div className="mt-3 text-center">
          <button type="button" className="btn-ghost btn-sm" onClick={() => void loadMore()}>
            {t('lp.loadMore')}
          </button>
        </div>
      )}
    </Section>
  );
}
