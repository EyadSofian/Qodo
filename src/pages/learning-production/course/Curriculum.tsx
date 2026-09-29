/**
 * Curriculum & lessons.
 *
 * The curriculum is program-level work (research, the first draft, the final
 * curriculum); the lessons are what it becomes. This tab shows where the
 * curriculum stands — its stages and the documents they produced — above the
 * lesson structure itself. Lessons can be added at any time, but the page
 * says plainly when the curriculum is not approved yet.
 */

import { Link } from 'react-router-dom';
import { FileCheck2 } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import type { RunView } from '../../../lib/learningProduction/runTypes';
import { Panel, Pill, StageStatusPill, TaskStatusPill, usePick } from '../../../components/learning-production/studio';
import { useCourse } from '../CourseWorkspace';
import { CourseLessons } from './CourseLessons';

const CURRICULUM_STAGES = ['RESEARCH', 'CURRICULUM_DRAFT', 'FINAL_CURRICULUM', 'AI_INPUT', 'AI_OUTLINES', 'AI_OUTLINE_REVIEW', 'CHANGE_IMPACT'];
const DOCUMENT_TASKS = ['research.document', 'draft.fill', 'draft.apply', 'final.document', 'final.id_approval', 'final.consultant_review', 'final.mcqs', 'final.tasks', 'final.projects', 'impact.review'];

export function Curriculum() {
  const { run } = useCourse();
  return (
    <div className="space-y-4">
      {run && run.run.scenario !== 'LEGACY' && <CurriculumStatus view={run} />}
      <CourseLessons />
    </div>
  );
}

function CurriculumStatus({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const stages = view.stages.filter((stage) => CURRICULUM_STAGES.includes(stage.key));
  const documents = stages.flatMap((stage) => stage.tasks).filter((task) => DOCUMENT_TASKS.includes(task.key));
  const final = view.stages.find((stage) => stage.key === 'FINAL_CURRICULUM');
  const approved = final?.status === 'DONE';
  if (stages.length === 0) return null;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <FileCheck2 size={16} aria-hidden="true" />
          {t('lp.curriculum.title')}
        </span>
      }
      action={
        <span className="flex flex-wrap gap-1.5">
          {stages.map((stage) => (
            <span key={stage.key} className="flex items-center gap-1 text-[12px]">
              <span className="lps-muted">{pick(stage.label)}</span>
              <StageStatusPill status={stage.status} />
            </span>
          ))}
        </span>
      }
      bodyClassName="p-0"
    >
      {!approved && <p className="lps-callout-info m-4 mb-0">{t('lp.curriculum.notApproved')}</p>}
      {documents.length > 0 && (
        <ul className="mt-2">
          {documents.map((task) => (
            <li key={task.id} className="border-t" style={{ borderColor: 'var(--lps-line)' }}>
              <Link to={`/learning-production/courses/${view.course.id}/plan?task=${task.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 hover:bg-[color:var(--lps-sunken)]">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{pick(task.label)}</span>
                {task.counts?.evidence ? <Pill tone="outline">{t('lp.task.evidenceCount', { n: task.counts.evidence })}</Pill> : null}
                {task.requiresApproval && <span className="text-[11.5px] lps-faint">{t(`lp.role.${task.reviewerRole}` as StringKey)}</span>}
                <TaskStatusPill display={task.display} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
