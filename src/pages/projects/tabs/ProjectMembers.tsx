/**
 * Qodo Projects — who is on this project.
 *
 * Membership is the authorization join: this screen is not a contact list, it
 * is the access control panel. Which is why the role picker names what each
 * role can do rather than only what it is called, and why the client role is
 * separated from the rest with its consequence spelled out.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, UserMinus, UserPlus, Users } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { projectsApi } from '../../../lib/projects/api';
import type { MemberCandidate, ProjectMember, ProjectMemberRole } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Modal, Spinner, useToast } from '../../../components/ui';

const ROLES: ProjectMemberRole[] = ['manager', 'member', 'viewer', 'client'];

export function ProjectMembers() {
  const { detail, can, reload } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { members: loaded } = await projectsApi.members(projectId);
      setMembers(loaded);
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

  const remove = async (member: ProjectMember) => {
    try {
      await projectsApi.removeMember(projectId, member.userId);
      await load();
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  const manage = can('project.manage_members');

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-ink">{t('projects.nav.members')}</h2>
        {manage && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setAdding(true)}>
            <UserPlus size={15} />
            {t('common.add')}
          </button>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<Users size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {members.map((member) => (
            <li key={member.userId} className="group flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink">{member.userId}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {t(`projectMembers.role.${member.role}` as Parameters<typeof t>[0])}
                </p>
              </div>

              {member.isClient && (
                // A customer in the member list is worth flagging loudly. The
                // person scanning this needs to know at a glance that anything
                // marked client-visible in this project reaches an outsider.
                <span className="chip bg-accent-50 text-accent-700">
                  <ShieldAlert size={11} aria-hidden="true" />
                  {t('projectMembers.role.client')}
                </span>
              )}

              {manage && member.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => void remove(member)}
                  aria-label={`${t('common.delete')} — ${member.userId}`}
                  className="btn-danger !min-h-8 rounded-lg px-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                >
                  <UserMinus size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddMemberDialog
        open={adding}
        projectId={projectId}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void load();
        }}
      />
    </section>
  );
}

function AddMemberDialog({
  open,
  projectId,
  onClose,
  onAdded,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t, lang } = useI18n();
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectMemberRole>('member');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUserId('');
      setRole('member');
      setError(null);
      return;
    }
    setLoading(true);
    projectsApi
      .memberCandidates(projectId)
      .then(({ candidates: loaded }) => setCandidates(loaded))
      .catch((caught) => setError(errorMessage(caught, lang)))
      .finally(() => setLoading(false));
  }, [open, projectId, lang]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await projectsApi.addMember(projectId, userId, role);
      onAdded();
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.nav.members')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="member-add" className="btn-primary btn-sm" disabled={!userId || saving}>
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="member-add" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        {loading ? (
          <div className="grid place-items-center py-6">
            <Spinner size={20} className="text-brand-500" />
          </div>
        ) : (
          <>
            <Field label={t('shell.team')} required>
              <select
                className="field"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              >
                <option value="">—</option>
                {candidates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.title ? ` · ${person.title}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="grid gap-2">
              <legend className="label">{t('projectMembers.roleLegend')}</legend>
              {ROLES.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    role === option ? 'border-brand-400 bg-brand-50' : 'border-surface-line hover:bg-surface-sunken'
                  }`}
                >
                  <input
                    type="radio"
                    name="member-role"
                    className="mt-1"
                    checked={role === option}
                    onChange={() => setRole(option)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-ink">
                      {t(`projectMembers.role.${option}` as Parameters<typeof t>[0])}
                    </span>
                    <span className="block text-[12px] leading-relaxed text-ink-muted">
                      {t(`projectMembers.roleHint.${option}` as Parameters<typeof t>[0])}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
      </form>
    </Modal>
  );
}
