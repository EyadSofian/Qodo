/**
 * Qodo Projects — what happened in this project.
 *
 * A projection of the append-only audit log rather than a second table, which
 * is what keeps the feed and the audit from ever disagreeing. It also means the
 * feed inherits the audit's redaction, and that is correct: a feed entry that
 * reveals a rate is the same leak as an audit entry that does.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, RotateCcw } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { projectsApi } from '../../../lib/projects/api';
import type { ProjectActivityEvent } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Spinner } from '../../../components/ui';

/**
 * How each recorded action reads to a person.
 *
 * A map rather than a formatter, so an action with no entry falls through to
 * its raw name — visibly unstyled, which is how a missing translation gets
 * noticed rather than silently rendering as an empty row.
 */
const ACTIONS: Record<string, { ar: string; en: string }> = {
  'project.create': { ar: 'أنشأ المشروع', en: 'created the project' },
  'project.update': { ar: 'عدّل المشروع', en: 'updated the project' },
  'project.archive': { ar: 'أرشف المشروع', en: 'archived the project' },
  'project.unarchive': { ar: 'ألغى أرشفة المشروع', en: 'unarchived the project' },
  'project.delete': { ar: 'نقل المشروع لسلة المحذوفات', en: 'moved the project to the recycle bin' },
  'project.restore': { ar: 'استرجع المشروع', en: 'restored the project' },
  'project.member.add': { ar: 'أضاف عضوًا', en: 'added a member' },
  'project.member.remove': { ar: 'أزال عضوًا', en: 'removed a member' },
  'phase.create': { ar: 'أنشأ مرحلة', en: 'created a phase' },
  'phase.update': { ar: 'عدّل مرحلة', en: 'updated a phase' },
  'phase.delete': { ar: 'حذف مرحلة', en: 'deleted a phase' },
  'phase.reorder': { ar: 'أعاد ترتيب المراحل', en: 'reordered the phases' },
  'tasklist.create': { ar: 'أنشأ قائمة مهام', en: 'created a task list' },
  'tasklist.update': { ar: 'عدّل قائمة مهام', en: 'updated a task list' },
  'tasklist.delete': { ar: 'حذف قائمة مهام', en: 'deleted a task list' },
  'task.create': { ar: 'أنشأ مهمة', en: 'created a task' },
  'task.update': { ar: 'عدّل مهمة', en: 'updated a task' },
  'task.delete': { ar: 'حذف مهمة', en: 'deleted a task' },
  'task.assign': { ar: 'غيّر إسناد مهمة', en: 'changed a task assignment' },
  'task.reparent': { ar: 'نقل مهمة', en: 'moved a task' },
};

export function ProjectActivity() {
  const { detail } = useProject();
  const { t, lang } = useI18n();
  const projectId = detail.project.id;

  const [events, setEvents] = useState<ProjectActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { events: loaded } = await projectsApi.activity(projectId, 100);
      setEvents(loaded);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, lang]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <EmptyState
          icon={<Activity size={32} />}
          title={t('projects.error.load')}
          body={error}
          action={
            <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
              <RotateCcw size={15} />
              {t('projects.error.retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<Activity size={32} />} title={t('common.none')} />
      </div>
    );
  }

  return (
    <ol className="card divide-y divide-surface-line">
      {events.map((event) => {
        const action = ACTIONS[event.action];
        const changed = event.after_state ? Object.keys(event.after_state) : [];
        return (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5">
            <span className="text-[13px] font-semibold text-ink">{event.actor_id ?? t('common.unknown')}</span>
            <span className="text-[13px] text-ink-muted">
              {action ? action[lang] : event.action}
            </span>
            {changed.length > 0 && (
              <span className="chip bg-surface-sunken text-[11px] text-ink-faint">
                {changed.slice(0, 3).join(', ')}
                {changed.length > 3 && ` +${changed.length - 3}`}
              </span>
            )}
            {/* `source` says whether a person or an automation did this. An
                audit trail that cannot tell them apart is not much of one. */}
            {event.source !== 'user' && (
              <span className="chip bg-status-infoBg text-[11px] text-status-info">{event.source}</span>
            )}
            <time
              dateTime={event.occurred_at}
              className="ms-auto shrink-0 text-[11.5px] tabular-nums text-ink-faint"
            >
              {new Date(event.occurred_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
