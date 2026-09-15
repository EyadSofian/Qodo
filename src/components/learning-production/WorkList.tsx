/**
 * A list of production work — My Work, the review queue, the dashboard's
 * attention lists. Each row names the course, the lesson and the stage, and
 * opens that exact asset.
 */

import { Link } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { cx, timeAgo } from '../../lib/utils';
import { assetRoute } from '../../lib/learningProduction/format';
import type { People, WorkItem } from '../../lib/learningProduction/types';
import { CommentCount, DueChip, PersonChip, PriorityChip, StageLabel, StatusBadge } from './kit';

export function WorkList({
  items,
  people,
  show = 'assignee',
  empty,
}: {
  items: WorkItem[];
  people: People;
  show?: 'assignee' | 'submitted' | 'none';
  empty?: string;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return empty ? <p className="px-4 py-6 text-center text-[13px] text-ink-faint">{empty}</p> : null;
  }
  return (
    <ul className="divide-y divide-surface-line">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={assetRoute(item.course.id, item.lesson.id, item.assetType)}
            className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-surface-bg sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <StageLabel type={item.assetType} />
                {item.currentVersionNumber ? <span className="text-[12px] font-normal text-ink-faint">v{item.currentVersionNumber}</span> : null}
                <CommentCount count={item.openComments} />
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                {item.course.code ? `${item.course.code} · ` : `${item.course.name} · `}
                {item.lesson.name}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={item.status} blocked={item.blocked} size="sm" />
              <PriorityChip priority={item.priority} />
            </div>
            <div className={cx('min-w-0 text-[12.5px] text-ink-muted', show === 'none' && 'hidden sm:block')}>
              {show === 'assignee' && <PersonChip userId={item.assigneeUserId} people={people} />}
              {show === 'submitted' && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <PersonChip userId={item.submittedBy ?? item.assigneeUserId} people={people} />
                  {item.submittedAt && <span className="shrink-0 text-ink-faint">· {timeAgo(item.submittedAt, t)}</span>}
                </span>
              )}
            </div>
            <div className="sm:text-end">
              <DueChip dueDate={item.dueDate} dueState={item.dueState} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
