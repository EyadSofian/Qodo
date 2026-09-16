/**
 * Content — the course's structure, and where every lesson stands.
 *
 * A module is a card; a lesson is one row of that card: its picture, its name,
 * then its five production stages side by side and its own percentage. The row
 * is deliberately shallow — a course of forty lessons has to be scannable in
 * one scroll, and the column a reader's eye runs down (all the PPTs, all the
 * voice-overs) is the one that says where the course is stuck.
 *
 * Everything structural — reordering by drag or by arrow key, renaming,
 * duplicating, moving between modules, archiving — lives in the row's trailing
 * cluster, which appears on hover and on keyboard focus.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  ListPlus,
  Pencil,
  Plus,
} from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx, formatDate, timeAgo } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, lpErrorKey } from '../../../lib/learningProduction/format';
import { parseLessonList } from '@shared/learningProduction/lessonImport';
import type { Lesson, MatrixLesson, MatrixResponse } from '../../../lib/learningProduction/types';
import { Modal, Spinner, useToast } from '../../../components/ui';
import {
  Chip,
  ConfirmDialog,
  EmptyPanel,
  ErrorPanel,
  LessonThumb,
  PersonChip,
  SkeletonRows,
  StageCell,
} from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';

/** Lesson columns: the name, the five stages, the percentage, the tools. */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:grid-cols-[minmax(280px,1.9fr)_repeat(5,minmax(84px,0.7fr))_62px]';

export function CourseLessons() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const { data, error, loading, reload } = useLpQuery<MatrixResponse>(paths.matrix(courseId));
  const [params, setParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ moduleId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; kind: 'module' | 'lesson' } | null>(null);
  const [archiving, setArchiving] = useState<MatrixLesson | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canCreate = detail.capabilities.createLessons;
  const canEdit = detail.capabilities.editLessons;

  // `?add=1` — the header's "+ Add lesson" button, which lives one component
  // up and has no dialog of its own.
  const wantsAdd = params.get('add') === '1';
  useEffect(() => {
    if (!wantsAdd) return;
    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
    if (canCreate) setAdding({ moduleId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs for the arriving link only.
  }, [wantsAdd, canCreate]);

  const groups = useMemo(() => {
    if (!data) return [];
    const list = data.modules.map((module) => ({ id: module.id as string | null, name: module.name, lessons: [] as MatrixLesson[] }));
    const byId = new Map(list.map((group) => [group.id, group]));
    const loose = { id: null as string | null, name: t('lp.noModule'), lessons: [] as MatrixLesson[] };
    for (const lesson of data.lessons) (lesson.moduleId ? byId.get(lesson.moduleId) ?? loose : loose).lessons.push(lesson);
    for (const group of list) group.lessons.sort((a, b) => a.sortOrder - b.sortOrder);
    return loose.lessons.length ? [...list, loose] : list;
  }, [data, t]);

  const run = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await work();
      invalidate();
      if (success) toast.push(success);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const reorder = (moduleId: string | null, ids: string[]) => run(() => lp.reorderLessons(courseId, moduleId, ids));

  const moveWithin = (group: (typeof groups)[number], lessonId: string, delta: number) => {
    const ids = group.lessons.map((lesson) => lesson.id);
    const index = ids.indexOf(lessonId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorder(group.id, ids);
  };

  const dropOn = (group: (typeof groups)[number], beforeId: string | null) => {
    if (!dragging) return;
    const ids = group.lessons.map((lesson) => lesson.id).filter((id) => id !== dragging);
    const index = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(index < 0 ? ids.length : index, 0, dragging);
    setDragging(null);
    void reorder(group.id, ids);
  };

  if (loading && !data) return <SkeletonRows rows={6} height="h-16" />;
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-muted">{t('lp.lessons.summary', { modules: data.modules.length, lessons: data.lessons.length })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-quiet btn-sm" onClick={() => setShowArchived((value) => !value)} aria-pressed={showArchived}>
            <Archive size={14} />
            {t('lp.lessons.archived')}
          </button>
          {canCreate && (
            <>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  const name = window.prompt(t('lp.module.namePrompt'));
                  if (name?.trim()) void run(() => lp.createModule(courseId, name.trim()), t('lp.toast.moduleCreated'));
                }}
              >
                <Plus size={14} />
                {t('lp.module.add')}
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={() => setAdding({ moduleId: data.modules[0]?.id ?? null })}>
                <ListPlus size={14} />
                {t('lp.lessons.add')}
              </button>
            </>
          )}
        </div>
      </div>

      {showArchived && <ArchivedLessons courseId={courseId} canEdit={canEdit} />}

      {groups.length === 0 ? (
        <EmptyPanel
          icon={<ListPlus size={26} />}
          title={t('lp.lessons.emptyTitle')}
          body={t('lp.lessons.emptyBody')}
          action={
            canCreate ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => setAdding({ moduleId: null })}>
                <ListPlus size={14} />
                {t('lp.lessons.add')}
              </button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const key = group.id ?? 'none';
            const isCollapsed = collapsed.has(key);
            const totals = group.lessons.reduce(
              (sum, lesson) => ({ complete: sum.complete + lesson.progress.complete, total: sum.total + lesson.progress.total }),
              { complete: 0, total: 0 }
            );
            const percent = totals.total ? Math.round((totals.complete / totals.total) * 100) : 0;

            return (
              <section
                key={key}
                className="overflow-hidden rounded-2xl border border-surface-line bg-white"
                onDragOver={(event) => canEdit && dragging && event.preventDefault()}
                onDrop={() => dropOn(group, null)}
              >
                <header className="flex items-center gap-2 border-b border-surface-line bg-surface-bg/60 px-3 py-2.5">
                  <button
                    type="button"
                    className="btn-quiet !min-h-8 rounded-lg px-1.5"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    aria-label={isCollapsed ? t('lp.lessons.expand') : t('lp.lessons.collapse')}
                  >
                    <ChevronDown size={16} className={cx('transition-transform', isCollapsed && '-rotate-90 rtl:rotate-90')} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-bold text-ink">{group.name}</h3>
                    <p className="text-[11.5px] text-ink-faint">
                      {t('lp.course.lessonsCount', { n: group.lessons.length })} · {t('lp.lessons.moduleComplete', { n: percent })}
                    </p>
                  </div>
                  {group.id && canEdit && (
                    <>
                      <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setRenaming({ id: group.id!, name: group.name, kind: 'module' })} aria-label={t('lp.module.rename')}>
                        <Pencil size={14} />
                      </button>
                      {group.lessons.length === 0 && (
                        <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => void run(() => lp.archiveModule(group.id!), t('lp.toast.moduleArchived'))} aria-label={t('lp.module.archive')}>
                          <Archive size={14} />
                        </button>
                      )}
                    </>
                  )}
                  {canCreate && (
                    <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setAdding({ moduleId: group.id })} aria-label={t('lp.lessons.addTo', { module: group.name })}>
                      <Plus size={15} />
                    </button>
                  )}
                </header>

                {!isCollapsed && (
                  <ul>
                    {group.lessons.length === 0 && <li className="px-4 py-5 text-[13px] text-ink-faint">{t('lp.lessons.moduleEmpty')}</li>}
                    {group.lessons.map((lesson, index) => {
                      const updatedAt = Object.values(lesson.assets).reduce<string | null>(
                        (latest, asset) => (asset?.updatedAt && (!latest || asset.updatedAt > latest) ? asset.updatedAt : latest),
                        null
                      );
                      const meta = [
                        lesson.estimatedDurationMinutes ? t('lp.lessons.minutes', { n: lesson.estimatedDurationMinutes }) : null,
                        t(`lp.lessonState.${lesson.state}` as never),
                        updatedAt ? t('lp.lessons.updated', { when: timeAgo(updatedAt, t) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <li
                          key={lesson.id}
                          draggable={canEdit}
                          onDragStart={() => setDragging(lesson.id)}
                          onDragEnd={() => setDragging(null)}
                          onDragOver={(event) => canEdit && dragging && event.preventDefault()}
                          onDrop={(event) => {
                            event.stopPropagation();
                            dropOn(group, lesson.id);
                          }}
                          className={cx(
                            'group/row relative border-b border-surface-line px-3 py-2.5 last:border-0 hover:bg-surface-bg/50',
                            dragging === lesson.id && 'opacity-50'
                          )}
                        >
                          <div className={ROW_GRID}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={cx('text-ink-faint', canEdit ? 'cursor-grab' : 'hidden')} aria-hidden="true">
                                <GripVertical size={15} />
                              </span>
                              <LessonThumb seed={lesson.id} />
                              <div className="min-w-0">
                                <Link
                                  to={`/learning-production/courses/${courseId}/lessons/${lesson.id}`}
                                  className="block truncate text-[13.5px] font-bold text-ink hover:text-brand-600"
                                >
                                  {lesson.name}
                                </Link>
                                <p className="truncate text-[11.5px] text-ink-faint">{meta}</p>
                              </div>
                            </div>

                            {STAGES.map((type) => (
                              <div key={type} className="hidden min-w-0 lg:block">
                                <StageCell type={type} asset={lesson.assets[type]} courseId={courseId} lessonId={lesson.id} />
                              </div>
                            ))}

                            <div className="flex items-center justify-end gap-2 lg:justify-start">
                              <Chip tone={lesson.progress.percent === 100 ? 'ok' : lesson.state === 'CHANGES_REQUESTED' ? 'warn' : lesson.state === 'IN_REVIEW' ? 'review' : 'neutral'}>
                                {lesson.progress.percent}%
                              </Chip>
                            </div>

                            {/* On a wide screen the tools float over the end of
                                the row on hover, so every pixel of the row
                                itself belongs to the lesson and its stages.
                                Narrower, they are simply the row's second line. */}
                            <div className="col-span-2 flex flex-nowrap items-center justify-end gap-0.5 lg:absolute lg:end-2 lg:top-2 lg:z-10 lg:col-span-1 lg:rounded-xl lg:border lg:border-surface-line lg:bg-white/95 lg:px-1 lg:opacity-0 lg:shadow-sm lg:backdrop-blur-sm lg:transition-opacity lg:focus-within:opacity-100 lg:group-hover/row:opacity-100">
                              <span className="me-1 hidden xl:block">
                                <PersonChip userId={lesson.ownerUserId} people={data.people} size={20} showName={false} empty="" />
                              </span>
                              {lesson.targetDate && <span className="me-1 hidden whitespace-nowrap text-[11.5px] text-ink-faint xl:block">{formatDate(lesson.targetDate, lang)}</span>}
                              {canEdit && (
                                <>
                                  <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" disabled={index === 0 || busy} onClick={() => moveWithin(group, lesson.id, -1)} aria-label={t('lp.lessons.moveUp')}>
                                    <ChevronUp size={14} />
                                  </button>
                                  <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" disabled={index === group.lessons.length - 1 || busy} onClick={() => moveWithin(group, lesson.id, 1)} aria-label={t('lp.lessons.moveDown')}>
                                    <ChevronDown size={14} />
                                  </button>
                                  <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setRenaming({ id: lesson.id, name: lesson.name, kind: 'lesson' })} aria-label={t('lp.lessons.rename')}>
                                    <Pencil size={14} />
                                  </button>
                                </>
                              )}
                              {canCreate && (
                                <button
                                  type="button"
                                  className="btn-quiet !min-h-8 rounded-lg px-1.5"
                                  onClick={() => void run(() => lp.duplicateLesson(lesson.id, t('lp.lessons.copyName', { name: lesson.name })), t('lp.toast.lessonDuplicated'))}
                                  aria-label={t('lp.lessons.duplicate')}
                                >
                                  <Copy size={14} />
                                </button>
                              )}
                              {canEdit && (
                                <>
                                  {data.modules.length > 1 && (
                                    <select
                                      className="field !min-h-8 !w-[104px] !px-1.5 !py-1 !text-[12px]"
                                      value={lesson.moduleId ?? ''}
                                      aria-label={t('lp.lessons.moveTo')}
                                      onChange={(event) => void run(() => lp.moveLessons(courseId, event.target.value || null, [lesson.id]), t('lp.toast.lessonMoved'))}
                                    >
                                      {data.modules.map((module) => (
                                        <option key={module.id} value={module.id}>
                                          {module.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setArchiving(lesson)} aria-label={t('lp.lessons.archive')}>
                                    <Archive size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Phone and tablet: the five stages become their own
                              band under the lesson, so the row never becomes a
                              horizontal scroller. */}
                          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:hidden">
                            {STAGES.map((type) => (
                              <StageCell key={type} type={type} asset={lesson.assets[type]} courseId={courseId} lessonId={lesson.id} />
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {adding && <AddLessons courseId={courseId} modules={data.modules} initialModuleId={adding.moduleId} onClose={() => setAdding(null)} />}

      <RenameDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name) =>
          renaming &&
          run(
            () => (renaming.kind === 'module' ? lp.updateModule(renaming.id, name) : lp.updateLesson(renaming.id, { name })),
            t('lp.toast.saved')
          ).then(() => setRenaming(null))
        }
      />

      <ConfirmDialog
        open={Boolean(archiving)}
        title={t('lp.lessons.archiveTitle')}
        body={t('lp.lessons.archiveBody', { name: archiving?.name ?? '' })}
        confirmLabel={t('lp.lessons.archive')}
        tone="danger"
        busy={busy}
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && run(() => lp.archiveLessons(courseId, [archiving.id]), t('lp.toast.lessonArchived')).then(() => setArchiving(null))}
      />
    </>
  );
}

function RenameDialog({ target, onClose, onSave }: { target: { name: string } | null; onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={t('lp.rename')}
      width="sm"
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <input className="field" defaultValue={target?.name} key={target?.name} onChange={(event) => setName(event.target.value)} ref={(element) => element && !name && setName(element.value)} autoFocus />
    </Modal>
  );
}

/** One lesson, or a pasted list — the same dialog. */
function AddLessons({ courseId, modules, initialModuleId, onClose }: { courseId: string; modules: MatrixResponse['modules']; initialModuleId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [moduleId, setModuleId] = useState(initialModuleId ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = parseLessonList(text);

  const save = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      await lp.createLessons(
        courseId,
        rows.map((row) => (row.moduleName ? { name: row.name, moduleName: row.moduleName } : { name: row.name, moduleId: moduleId || null }))
      );
      invalidate();
      toast.push(t('lp.toast.lessonsCreated', { n: rows.length }));
      onClose();
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('lp.lessons.add')}
      footer={
        <>
          <span className="me-auto text-[12.5px] text-ink-muted">{t('lp.create.totalAssets', { lessons: rows.length, assets: rows.length * 5 })}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!rows.length || busy} onClick={save}>
            {busy && <Spinner size={14} />}
            {t('lp.lessons.create', { n: rows.length })}
          </button>
        </>
      }
    >
      {modules.length > 0 && (
        <label className="mb-3 block">
          <span className="label">{t('lp.module.label')}</span>
          <select className="field" value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
            <option value="">{t('lp.noModule')}</option>
            {modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label">{t('lp.create.lessonsLabel')}</span>
        <textarea className="field min-h-[180px] font-mono text-[13px]" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('lp.create.lessonsPlaceholder')} autoFocus />
      </label>
      <p className="mt-1.5 text-[12px] text-ink-faint">{t('lp.lessons.pasteHint')}</p>
    </Modal>
  );
}

function ArchivedLessons({ courseId, canEdit }: { courseId: string; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, loading } = useLpQuery<{ lessons: Lesson[] }>(paths.archivedLessons(courseId));
  if (loading && !data) return <SkeletonRows rows={2} />;
  return (
    <div className="mb-3 rounded-2xl border border-dashed border-surface-line bg-white/60 p-3">
      {!data?.lessons.length ? (
        <p className="text-center text-[13px] text-ink-faint">{t('lp.lessons.noArchived')}</p>
      ) : (
        <ul className="space-y-1">
          {data.lessons.map((lesson) => (
            <li key={lesson.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-ink-muted">
                {lesson.name} · {formatDate(lesson.archivedAt, lang)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await lp.restoreLesson(lesson.id);
                      invalidate();
                      toast.push(t('lp.toast.lessonRestored'));
                    } catch (error) {
                      toast.push(t(lpErrorKey(error)), 'bad');
                    }
                  }}
                >
                  <ArchiveRestore size={14} />
                  {t('lp.restore')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
