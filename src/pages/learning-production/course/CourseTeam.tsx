/**
 * Team: who works on the course, in which roles, how loaded they are here, and
 * who normally makes and reviews each stage.
 */

import { useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { STAGES, lpErrorKey, roleKey } from '../../../lib/learningProduction/format';
import { COURSE_ROLES } from '@shared/learningProduction/constants';
import { STAGE_ROLES } from '@shared/learningProduction/permissions';
import type { AssetType, CourseRole, ProductionDefaults, TeamResponse } from '../../../lib/learningProduction/types';
import { Modal, Spinner, useToast } from '../../../components/ui';
import { ErrorPanel, PersonChip, PersonSelect, Section, SkeletonRows, StageLabel, usePeople } from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';

export function CourseTeam() {
  const { t } = useI18n();
  const toast = useToast();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const { data, error, loading, reload } = useLpQuery<TeamResponse>(paths.team(courseId));
  const manage = Boolean(data?.capabilities.manageTeam);
  const people = usePeople(manage);
  const [editing, setEditing] = useState<{ userId: string | null; roles: CourseRole[] } | null>(null);

  if (loading && !data) return <SkeletonRows rows={5} />;
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return null;

  const remove = async (userId: string) => {
    try {
      await lp.removeMember(courseId, userId);
      invalidate();
      toast.push(t('lp.toast.memberRemoved'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Section
        title={t('lp.team.members', { n: data.members.length })}
        actions={
          manage ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setEditing({ userId: null, roles: [] })}>
              <UserPlus size={14} />
              {t('lp.team.add')}
            </button>
          ) : null
        }
        bodyClassName="!p-0"
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-ink-faint">
              <th className="px-4 py-2 text-start font-semibold">{t('lp.person')}</th>
              <th className="px-2 py-2 text-start font-semibold">{t('lp.team.roles')}</th>
              <th className="px-2 py-2 text-end font-semibold">{t('lp.workload.active')}</th>
              <th className="px-2 py-2 text-end font-semibold">{t('lp.workload.review')}</th>
              <th className="px-2 py-2 text-end font-semibold">{t('lp.workload.overdue')}</th>
              {manage && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.userId} className="border-t border-surface-line">
                <td className="min-w-[170px] whitespace-nowrap px-4 py-2.5">
                  <PersonChip userId={member.userId} people={data.people} />
                </td>
                <td className="px-2 py-2.5">
                  <button
                    type="button"
                    disabled={!manage}
                    onClick={() => setEditing({ userId: member.userId, roles: member.roles })}
                    className={cx('flex flex-wrap gap-1 text-start', manage && 'hover:opacity-80')}
                  >
                    {member.roles.map((role) => (
                      <span key={role} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11.5px] font-semibold text-ink-muted">
                        {t(roleKey(role))}
                      </span>
                    ))}
                  </button>
                </td>
                <td className="px-2 py-2.5 text-end tabular-nums">{member.workload.active}</td>
                <td className="px-2 py-2.5 text-end tabular-nums">{member.workload.reviewing}</td>
                <td className={cx('px-2 py-2.5 text-end tabular-nums', member.workload.overdue > 0 && 'font-bold text-status-bad')}>{member.workload.overdue}</td>
                {manage && (
                  <td className="px-2">
                    <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => void remove(member.userId)} aria-label={t('lp.team.remove')}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data.contributors.length > 0 && (
          <div className="border-t border-surface-line px-4 py-3">
            <p className="mb-2 text-[12px] font-semibold text-ink-muted">{t('lp.team.contributors')}</p>
            <ul className="flex flex-wrap gap-3">
              {data.contributors.map((person) => (
                <li key={person.userId} className="flex items-center gap-1.5 text-[12.5px]">
                  <PersonChip userId={person.userId} people={data.people} />
                  <span className="text-ink-faint">({person.workload.active + person.workload.reviewing})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <DefaultsEditor courseId={courseId} initial={data.productionDefaults} editable={manage} people={people} peopleMap={data.people} teamIds={data.members.map((member) => member.userId)} />

      {editing && (
        <MemberDialog
          courseId={courseId}
          initial={editing}
          people={people}
          existing={data.members.map((member) => member.userId)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MemberDialog({
  courseId,
  initial,
  people,
  existing,
  onClose,
}: {
  courseId: string;
  initial: { userId: string | null; roles: CourseRole[] };
  people: ReturnType<typeof usePeople>;
  existing: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [userId, setUserId] = useState(initial.userId);
  const [roles, setRoles] = useState<CourseRole[]>(initial.roles);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!userId || roles.length === 0) return;
    setBusy(true);
    try {
      await lp.saveMember(courseId, userId, roles);
      invalidate();
      toast.push(t('lp.toast.saved'));
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
      title={initial.userId ? t('lp.team.editRoles') : t('lp.team.add')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!userId || roles.length === 0 || busy} onClick={save}>
            {busy && <Spinner size={14} />}
            {t('common.save')}
          </button>
        </>
      }
    >
      {!initial.userId && (
        <label className="mb-3 block">
          <span className="label">{t('lp.person')}</span>
          <PersonSelect value={userId} onChange={setUserId} people={people.filter((person) => !existing.includes(person.id))} placeholder={t('lp.team.choose')} />
        </label>
      )}
      <fieldset>
        <legend className="label">{t('lp.team.roles')}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {COURSE_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-bg">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-500"
                checked={roles.includes(role)}
                onChange={() => setRoles((list) => (list.includes(role) ? list.filter((entry) => entry !== role) : [...list, role]))}
              />
              {t(roleKey(role))}
            </label>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}

function DefaultsEditor({
  courseId,
  initial,
  editable,
  people,
  peopleMap,
  teamIds,
}: {
  courseId: string;
  initial: ProductionDefaults;
  editable: boolean;
  people: ReturnType<typeof usePeople>;
  peopleMap: TeamResponse['people'];
  teamIds: string[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [defaults, setDefaults] = useState<ProductionDefaults>(initial);
  const [applyToOpen, setApplyToOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDefaults(initial), [initial]);

  const change = (type: AssetType, field: 'assigneeUserId' | 'reviewerUserId', value: string | null) =>
    setDefaults((current) => ({
      ...current,
      [type]: { assigneeUserId: current[type]?.assigneeUserId ?? null, reviewerUserId: current[type]?.reviewerUserId ?? null, [field]: value },
    }));

  const save = async () => {
    setBusy(true);
    try {
      const result = await lp.saveDefaults(courseId, defaults, applyToOpen);
      invalidate();
      toast.push(applyToOpen ? t('lp.toast.defaultsApplied', { n: result.filled }) : t('lp.toast.saved'));
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('lp.team.defaults')}>
      <p className="mb-3 text-[12.5px] text-ink-muted">{t('lp.team.defaultsHint')}</p>
      <div className="space-y-3">
        {STAGES.map((type) => (
          <div key={type}>
            <p className="mb-1 text-[13px] font-semibold text-ink">
              <StageLabel type={type} />
            </p>
            {editable ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <PersonSelect value={defaults[type]?.assigneeUserId ?? null} onChange={(value) => change(type, 'assigneeUserId', value)} people={people} preferred={teamIds} exclude={defaults[type]?.reviewerUserId} placeholder={t(roleKey(STAGE_ROLES[type].maker))} />
                <PersonSelect value={defaults[type]?.reviewerUserId ?? null} onChange={(value) => change(type, 'reviewerUserId', value)} people={people} preferred={teamIds} exclude={defaults[type]?.assigneeUserId} placeholder={t('lp.reviewer')} />
              </div>
            ) : (
              <p className="flex flex-wrap gap-3 text-[12.5px]">
                <PersonChip userId={defaults[type]?.assigneeUserId ?? null} people={peopleMap} empty="—" />
                <span className="text-ink-faint">→</span>
                <PersonChip userId={defaults[type]?.reviewerUserId ?? null} people={peopleMap} empty="—" />
              </p>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-surface-line pt-3">
          <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={applyToOpen} onChange={(event) => setApplyToOpen(event.target.checked)} />
            {t('lp.team.applyToOpen')}
          </label>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy && <Spinner size={14} />}
            {t('common.save')}
          </button>
        </div>
      )}
    </Section>
  );
}
