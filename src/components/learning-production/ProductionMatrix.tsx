/**
 * The Production Matrix — lessons down, the five stages across.
 *
 * The primary production view, built for hundreds of lessons: sticky lesson
 * column and stage headers, compact rows, rows off-screen skipped by the
 * browser's own rendering (`content-visibility`), and one request for the
 * whole course. A cell says its status in an icon and a word; hovering or
 * focusing it gives the assignee, reviewer, due date and version; clicking it
 * opens that exact asset.
 */

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { useToast, Spinner } from '../ui';
import { lp } from '../../lib/learningProduction/api';
import { invalidate } from '../../lib/learningProduction/hooks';
import {
  BLOCKED_META,
  STAGE_HEX,
  STAGES,
  STATUS_META,
  TONE_CELL,
  assetRoute,
  formatDay,
  lpErrorKey,
  priorityKey,
  stageKey,
  statusKey,
} from '../../lib/learningProduction/format';
import { STAGE_ROLES } from '@shared/learningProduction/permissions';
import type { AssetSummary, AssetType, MatrixLesson, MatrixResponse, People, Person, Priority } from '../../lib/learningProduction/types';
import { CommentCount, PersonSelect, ProgressBar, StageLabel } from './kit';

export function ProductionMatrix({
  data,
  lessons,
  people,
  selected,
  onToggle,
  onToggleAll,
  teamIds = [],
}: {
  data: MatrixResponse;
  lessons: MatrixLesson[];
  people: Person[];
  selected?: Set<string>;
  onToggle?: (lessonId: string) => void;
  onToggleAll?: (lessonIds: string[]) => void;
  teamIds?: string[];
}) {
  const { t } = useI18n();
  const [assigning, setAssigning] = useState<{ asset: AssetSummary; lesson: MatrixLesson; anchor: DOMRect } | null>(null);
  const moduleName = new Map(data.modules.map((module) => [module.id, module.name]));
  const selectable = Boolean(onToggle) && data.capabilities.assignAny;

  // Module header rows keep a long course scannable without a column for it.
  const rows: Array<{ kind: 'module'; id: string; name: string } | { kind: 'lesson'; lesson: MatrixLesson }> = [];
  let lastModule: string | null | undefined;
  for (const lesson of lessons) {
    if (lesson.moduleId !== lastModule) {
      rows.push({ kind: 'module', id: lesson.moduleId ?? 'none', name: lesson.moduleId ? moduleName.get(lesson.moduleId) ?? '' : t('lp.noModule') });
      lastModule = lesson.moduleId;
    }
    rows.push({ kind: 'lesson', lesson });
  }

  const allSelected = selectable && lessons.length > 0 && lessons.every((lesson) => selected?.has(lesson.id));

  return (
    <div
      className="relative overflow-auto rounded-2xl border border-surface-line bg-white"
      // Tuned for the module's own scrolling pane (sidebar shell, no more
      // stacked module tab strip above it) — nudge if a gap or double
      // scrollbar shows up against the actual chrome above this component.
      style={{ maxHeight: 'calc(100dvh - 220px)', minHeight: 240 }}
    >
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="sticky start-0 top-0 z-30 w-[300px] border-b border-e border-surface-line bg-surface-bg px-3 py-2.5 text-start font-semibold text-ink-muted">
              <span className="flex items-center gap-2">
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={t('lp.matrix.selectAll')}
                    checked={allSelected}
                    onChange={() => onToggleAll?.(lessons.map((lesson) => lesson.id))}
                    className="h-4 w-4 accent-brand-500"
                  />
                )}
                {t('lp.lesson')}
              </span>
            </th>
            {STAGES.map((type) => (
              <th
                key={type}
                scope="col"
                className="sticky top-0 z-20 border-b-2 bg-surface-bg px-2 py-2.5 text-start font-semibold text-ink-muted"
                style={{ borderBottomColor: STAGE_HEX[type] }}
              >
                <StageLabel type={type} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === 'module' ? (
              <tr key={`module-${row.id}`}>
                <th colSpan={6} scope="colgroup" className="sticky start-0 border-b border-surface-line bg-white px-3 pb-1.5 pt-3 text-start text-[11.5px] font-bold uppercase tracking-wide text-ink-faint">
                  {row.name}
                </th>
              </tr>
            ) : (
              <LessonRow
                key={row.lesson.id}
                lesson={row.lesson}
                courseId={data.course.id}
                people={data.people}
                canAssign={data.capabilities.assign}
                selectable={selectable}
                selected={Boolean(selected?.has(row.lesson.id))}
                onToggle={onToggle}
                onAssign={(asset, anchor) => setAssigning({ asset, lesson: row.lesson, anchor })}
              />
            )
          )}
        </tbody>
      </table>

      {assigning && (
        <QuickAssign
          asset={assigning.asset}
          lesson={assigning.lesson}
          anchor={assigning.anchor}
          people={people}
          teamIds={teamIds}
          courseId={data.course.id}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}

const LessonRow = memo(function LessonRow({
  lesson,
  courseId,
  people,
  canAssign,
  selectable,
  selected,
  onToggle,
  onAssign,
}: {
  lesson: MatrixLesson;
  courseId: string;
  people: People;
  canAssign: Record<AssetType, boolean>;
  selectable: boolean;
  selected: boolean;
  onToggle?: (lessonId: string) => void;
  onAssign: (asset: AssetSummary, anchor: DOMRect) => void;
}) {
  const { t } = useI18n();
  return (
    <tr className={cx('group/row', selected && 'bg-brand-50/50')} style={{ contentVisibility: 'auto', containIntrinsicSize: '52px' }}>
      <th scope="row" className={cx('sticky start-0 z-10 border-b border-e border-surface-line px-3 py-1.5 text-start font-normal', selected ? 'bg-brand-50' : 'bg-white group-hover/row:bg-surface-bg')}>
        <div className="flex items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              aria-label={t('lp.matrix.selectLesson', { name: lesson.name })}
              checked={selected}
              onChange={() => onToggle?.(lesson.id)}
              className="h-4 w-4 shrink-0 accent-brand-500"
            />
          )}
          <div className="min-w-0 flex-1">
            <Link to={`/learning-production/courses/${courseId}/lessons/${lesson.id}`} className="block truncate font-semibold text-ink hover:text-brand-600">
              {lesson.name}
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={lesson.progress.percent} className="max-w-[120px]" label={t('lp.progress')} />
              <span className="text-[11px] tabular-nums text-ink-faint">{lesson.progress.percent}%</span>
            </div>
          </div>
        </div>
      </th>
      {STAGES.map((type) => (
        <td key={type} className="border-b border-surface-line p-1">
          {lesson.assets[type] ? (
            <MatrixCell asset={lesson.assets[type]!} lesson={lesson} courseId={courseId} people={people} canAssign={canAssign[type]} onAssign={onAssign} />
          ) : null}
        </td>
      ))}
    </tr>
  );
});

function MatrixCell({
  asset,
  lesson,
  courseId,
  people,
  canAssign,
  onAssign,
}: {
  asset: AssetSummary;
  lesson: MatrixLesson;
  courseId: string;
  people: People;
  canAssign: boolean;
  onAssign: (asset: AssetSummary, anchor: DOMRect) => void;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const overdue = asset.dueState === 'OVERDUE';
  const meta = asset.blocked ? BLOCKED_META : STATUS_META[asset.status];
  const Icon = meta.icon;
  const tone = overdue ? 'bad' : meta.tone;
  const label = asset.blocked ? t('lp.blocked') : t(statusKey(asset.status));
  const assignee = asset.assigneeUserId ? people[asset.assigneeUserId]?.name ?? t('common.removedUser') : t('lp.unassigned');
  const reviewer = asset.reviewerUserId ? people[asset.reviewerUserId]?.name ?? t('common.removedUser') : '—';

  const details = [
    `${t(stageKey(asset.assetType))}: ${label}`,
    asset.blocked ? `${t('lp.waitingFor')}: ${asset.waitingFor.map((type) => t(stageKey(type))).join('، ')}` : null,
    `${t('lp.assignee')}: ${assignee}`,
    `${t('lp.reviewer')}: ${reviewer}`,
    `${t('lp.dueDate')}: ${asset.dueDate ? formatDay(asset.dueDate, lang) : '—'}${overdue ? ` (${t('lp.due.OVERDUE')})` : ''}`,
    `${t('lp.latestVersion')}: ${asset.currentVersionNumber ? `v${asset.currentVersionNumber}` : '—'}`,
    asset.updatedAt ? `${t('lp.lastUpdated')}: ${formatDay(asset.updatedAt, lang)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const unassigned = !asset.assigneeUserId && asset.status === 'NOT_STARTED';

  return (
    <div className="group/cell relative">
      <button
        type="button"
        onClick={() => navigate(assetRoute(courseId, lesson.id, asset.assetType))}
        title={details}
        aria-label={details.replaceAll('\n', '. ')}
        className={cx(
          'flex h-10 w-full min-w-[120px] items-center gap-1.5 rounded-lg border border-s-[3px] px-2 text-start text-[12px] font-semibold transition-colors hover:brightness-[0.97] focus-visible:ring-2',
          TONE_CELL[tone],
          unassigned && 'border-dashed'
        )}
        style={{ borderInlineStartColor: STAGE_HEX[asset.assetType], borderInlineStartStyle: 'solid' }}
      >
        <Icon size={13} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{overdue && !asset.blocked ? t('lp.due.OVERDUE') : label}</span>
        <CommentCount count={asset.openComments} />
        {asset.assigneeUserId && (
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
            style={{ background: people[asset.assigneeUserId]?.avatarColor ?? '#94A3B8' }}
            aria-hidden="true"
          >
            {(people[asset.assigneeUserId]?.name ?? '?').trim().slice(0, 1)}
          </span>
        )}
      </button>
      {canAssign && asset.status !== 'LOCKED' && (
        <button
          type="button"
          aria-label={t('lp.matrix.quickAssign', { stage: t(stageKey(asset.assetType)), lesson: lesson.name })}
          onClick={(event) => onAssign(asset, (event.currentTarget as HTMLElement).getBoundingClientRect())}
          className={cx(
            'absolute -top-1 end-0 grid h-5 w-5 place-items-center rounded-full border border-surface-line bg-white text-ink-muted shadow-sm',
            unassigned ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover/cell:opacity-100'
          )}
        >
          <MoreHorizontal size={12} />
        </button>
      )}
    </div>
  );
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** The small popover a manager assigns from without leaving the matrix. */
function QuickAssign({
  asset,
  lesson,
  anchor,
  people,
  teamIds,
  onClose,
}: {
  asset: AssetSummary;
  lesson: MatrixLesson;
  anchor: DOMRect;
  people: Person[];
  teamIds: string[];
  courseId: string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const panel = useRef<HTMLDivElement>(null);
  const [assignee, setAssignee] = useState(asset.assigneeUserId);
  const [reviewer, setReviewer] = useState(asset.reviewerUserId);
  const [dueDate, setDueDate] = useState(asset.dueDate ?? '');
  const [priority, setPriority] = useState<Priority>(asset.priority);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ top: anchor.bottom + 6, left: anchor.left });

  useLayoutEffect(() => {
    const width = panel.current?.offsetWidth ?? 300;
    const height = panel.current?.offsetHeight ?? 320;
    const left = Math.min(Math.max(8, lang === 'ar' ? anchor.right - width : anchor.left), window.innerWidth - width - 8);
    const top = anchor.bottom + height + 8 > window.innerHeight ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6;
    setPosition({ top, left });
  }, [anchor, lang]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onPointer = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  const roles = STAGE_ROLES[asset.assetType];
  const submit = async () => {
    setBusy(true);
    try {
      await lp.assign(asset.id, { assigneeUserId: assignee, reviewerUserId: reviewer, dueDate: dueDate || null, priority });
      invalidate();
      toast.push(t('lp.toast.assigned'));
      onClose();
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={t('lp.matrix.assignTitle', { stage: t(stageKey(asset.assetType)), lesson: lesson.name })}
      className="fixed z-[65] w-[300px] rounded-2xl border border-surface-line bg-white p-3 shadow-panel animate-pop-in"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink">
            <StageLabel type={asset.assetType} />
          </p>
          <p className="truncate text-[12px] text-ink-muted">{lesson.name}</p>
        </div>
        <button type="button" className="btn-quiet !min-h-7 rounded-lg p-1" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      </div>
      <div className="space-y-2.5">
        <label className="block">
          <span className="label !mb-1">{t('lp.assignTo')}</span>
          <PersonSelect value={assignee} onChange={setAssignee} people={people} preferred={teamIds} exclude={reviewer} />
        </label>
        <label className="block">
          <span className="label !mb-1">{t('lp.reviewer')}</span>
          <PersonSelect value={reviewer} onChange={setReviewer} people={people} preferred={teamIds} exclude={assignee} placeholder={t('lp.noReviewer')} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label !mb-1">{t('lp.dueDate')}</span>
            <input type="date" className="field !px-2" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="block">
            <span className="label !mb-1">{t('lp.priority')}</span>
            <select className="field !px-2" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(priorityKey(value))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11.5px] text-ink-faint">{t('lp.matrix.roleHint', { maker: t(`lp.role.${roles.maker}` as never), reviewer: t(`lp.role.${roles.reviewer}` as never) })}</p>
        <button type="button" className="btn-primary btn-sm w-full" onClick={submit} disabled={busy}>
          {busy && <Spinner size={14} />}
          {t('lp.assign')}
        </button>
      </div>
    </div>,
    document.body
  );
}
