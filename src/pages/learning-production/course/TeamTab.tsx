/**
 * Team.
 *
 * Three layers of who-does-what: the course team (roles on every run of the
 * course, and who makes and reviews each lesson asset by default), roles on
 * this run only — the testers for this UAT cycle, say — and, for the people
 * allowed to see them, the expert candidates this run is sourcing.
 */

import { useState } from 'react';
import { EyeOff, Plus, UserPlus, X } from 'lucide-react';
import { COURSE_ROLES, LEGACY_COURSE_ROLES } from '@shared/learningProduction/constants';
import { CANDIDATE_SOURCES, CANDIDATE_STATUSES } from '@shared/learningProduction/runs';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runPaths, runUploads, runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { Candidate, CandidatesResponse, RunTeamResponse, RunView } from '../../../lib/learningProduction/runTypes';
import { useToast } from '../../../components/ui';
import { PersonSelect, usePeople } from '../../../components/learning-production/kit';
import { Busy, Drawer, EmptyNote, ErrorNote, LoadingRows, Panel, PersonLine, Pill, useDay } from '../../../components/learning-production/studio';
import { useCourse } from '../CourseWorkspace';
import { CourseTeam } from './CourseTeam';

export function TeamTab() {
  const { run } = useCourse();
  const hasExperts = Boolean(run?.stages.some((stage) => stage.key === 'EXPERT_ACQUISITION'));
  return (
    <div className="space-y-4">
      <CourseTeam />
      {run && run.run.scenario !== 'LEGACY' && <RunTeam view={run} />}
      {run && hasExperts && run.capabilities.seeSensitive && <Candidates view={run} />}
    </div>
  );
}

function RunTeam({ view }: { view: RunView }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, error, reload } = useLpQuery<RunTeamResponse>(runPaths.runTeam(view.run.id));
  const people = usePeople(Boolean(data?.canManage));
  const [person, setPerson] = useState<string | null>(null);
  const [role, setRole] = useState('UAT_TESTER');
  const [busy, setBusy] = useState(false);
  const roles = COURSE_ROLES.filter((entry) => !(LEGACY_COURSE_ROLES as readonly string[]).includes(entry));

  async function add() {
    if (!person) return;
    setBusy(true);
    try {
      const existing = data?.members.find((member) => member.userId === person)?.roles ?? [];
      await runsApi.saveRunMember(view.run.id, person, [...new Set([...existing, role])]);
      invalidate();
      setPerson(null);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    try {
      await runsApi.removeRunMember(view.run.id, userId);
      invalidate();
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    }
  }

  return (
    <Panel title={t('lp.team.runOnly')} bodyClassName="p-0">
      <p className="px-4 pt-3 text-[12.5px] lps-muted">{t('lp.team.runOnlyHint')}</p>
      {error ? (
        <div className="p-4">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <LoadingRows rows={2} />
      ) : data.members.length === 0 ? (
        <p className="px-4 py-3 text-[13px] lps-muted">{t('lp.team.runOnlyEmpty')}</p>
      ) : (
        <ul className="mt-2">
          {data.members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: 'var(--lps-line)' }}>
              <PersonLine userId={member.userId} people={data.people} />
              <span className="flex flex-1 flex-wrap gap-1">
                {member.roles.map((entry) => (
                  <Pill key={entry} tone="neutral">
                    {t(`lp.role.${entry}` as StringKey)}
                  </Pill>
                ))}
              </span>
              {data.canManage && (
                <button type="button" className="lps-btn-quiet !min-h-7 !px-1.5" onClick={() => remove(member.userId)} aria-label={t('lp.team.remove')}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--lps-line)' }}>
          <label className="block min-w-[200px] flex-1">
            <span className="lps-label">{t('lp.team.person')}</span>
            <PersonSelect className="lps-input" value={person} onChange={setPerson} people={people} placeholder={t('lp.people.choose')} />
          </label>
          <label className="block">
            <span className="lps-label">{t('lp.team.role')}</span>
            <select className="lps-input" value={role} onChange={(event) => setRole(event.target.value)}>
              {roles.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`lp.role.${entry}` as StringKey)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="lps-btn" onClick={add} disabled={!person || busy}>
            {busy ? <Busy /> : <UserPlus size={14} aria-hidden="true" />}
            {t('common.add')}
          </button>
        </div>
      )}
    </Panel>
  );
}

function Candidates({ view }: { view: RunView }) {
  const { t } = useI18n();
  const day = useDay();
  const { data, error, reload } = useLpQuery<CandidatesResponse>(runPaths.candidates(view.run.id));
  const [editing, setEditing] = useState<Candidate | 'new' | null>(null);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <EyeOff size={15} aria-hidden="true" />
          {t('lp.candidates.title')}
        </span>
      }
      action={
        data?.canEdit ? (
          <button type="button" className="lps-btn" onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" />
            {t('lp.candidates.add')}
          </button>
        ) : null
      }
      bodyClassName="p-0"
    >
      <p className="px-4 pt-3 text-[12.5px] lps-muted">{t('lp.candidates.sensitive')}</p>
      {error ? (
        <div className="p-4">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <LoadingRows rows={3} />
      ) : data.candidates.length === 0 ? (
        <EmptyNote title={t('lp.candidates.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="lps-table mt-2 min-w-[640px]">
            <thead>
              <tr>
                <th>{t('lp.candidates.name')}</th>
                <th>{t('lp.col.status')}</th>
                <th>{t('lp.candidates.source')}</th>
                <th className="text-center">{t('lp.candidates.years')}</th>
                <th>{t('lp.candidates.files')}</th>
                <th>{t('lp.candidates.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((candidate) => (
                <tr key={candidate.id} className="lps-row-link" onClick={() => setEditing(candidate)}>
                  <td className="lps-bidi font-medium">{candidate.fullName}</td>
                  <td>
                    <Pill tone={candidate.status === 'CONTRACTED' ? 'ok' : candidate.status === 'REJECTED' || candidate.status === 'WITHDRAWN' ? 'outline' : 'accent'}>
                      {t(`lp.candidateStatus.${candidate.status}` as StringKey)}
                    </Pill>
                  </td>
                  <td className="text-[12.5px]">{t(`lp.candidateSource.${candidate.source}` as StringKey)}</td>
                  <td className="text-center">{candidate.yearsExperience ?? '—'}</td>
                  <td className="text-[12.5px]">{candidate.files.length || '—'}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{day(candidate.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && data && <CandidateDrawer runId={view.run.id} candidate={editing === 'new' ? null : editing} canEdit={data.canEdit} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function CandidateDrawer({ runId, candidate, canEdit, onClose }: { runId: string; candidate: Candidate | null; canEdit: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: candidate?.fullName ?? '',
    email: candidate?.email ?? '',
    phone: candidate?.phone ?? '',
    source: candidate?.source ?? 'LINKEDIN',
    profileUrl: candidate?.profileUrl ?? '',
    yearsExperience: candidate?.yearsExperience?.toString() ?? '',
    status: candidate?.status ?? 'SOURCED',
    notes: candidate?.notes ?? '',
    assessment: { ...(candidate?.assessment ?? {}) } as Record<string, number | undefined>,
  });
  const [kind, setKind] = useState('CV');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    setBusy(true);
    const body = {
      fullName: form.fullName.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      source: form.source,
      profileUrl: form.profileUrl.trim() || null,
      yearsExperience: form.yearsExperience === '' ? null : Number(form.yearsExperience),
      status: form.status,
      notes: form.notes,
      assessment: Object.fromEntries(Object.entries(form.assessment).filter(([, value]) => value)),
    };
    try {
      if (candidate) await runsApi.updateCandidate(candidate.id, body);
      else await runsApi.createCandidate(runId, body);
      invalidate();
      toast.push(t('lp.candidates.saved'));
      onClose();
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!candidate) return;
    try {
      await runUploads.candidateFile(candidate.id, file, kind).promise;
      invalidate();
      toast.push(t('lp.evidence.added'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={candidate ? candidate.fullName : t('lp.candidates.add')}
      footer={
        canEdit ? (
          <div className="flex justify-end gap-2">
            <button type="button" className="lps-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="lps-btn-primary" disabled={busy || !form.fullName.trim()} onClick={save}>
              {busy && <Busy />}
              {t('common.save')}
            </button>
          </div>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="lps-label">{t('lp.candidates.name')} *</span>
          <input className="lps-input" value={form.fullName} disabled={!canEdit} onChange={(event) => set({ fullName: event.target.value })} />
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.candidates.email')}</span>
          <input className="lps-input" dir="ltr" value={form.email} disabled={!canEdit} onChange={(event) => set({ email: event.target.value })} />
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.candidates.phone')}</span>
          <input className="lps-input" dir="ltr" value={form.phone} disabled={!canEdit} onChange={(event) => set({ phone: event.target.value })} />
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.candidates.source')}</span>
          <select className="lps-input" value={form.source} disabled={!canEdit} onChange={(event) => set({ source: event.target.value as typeof form.source })}>
            {CANDIDATE_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`lp.candidateSource.${value}` as StringKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.col.status')}</span>
          <select className="lps-input" value={form.status} disabled={!canEdit} onChange={(event) => set({ status: event.target.value as typeof form.status })}>
            {CANDIDATE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`lp.candidateStatus.${value}` as StringKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.candidates.years')}</span>
          <input className="lps-input" type="number" min={0} max={80} value={form.yearsExperience} disabled={!canEdit} onChange={(event) => set({ yearsExperience: event.target.value })} />
        </label>
        <label className="block">
          <span className="lps-label">{t('lp.candidates.profile')}</span>
          <input className="lps-input" dir="ltr" value={form.profileUrl} disabled={!canEdit} onChange={(event) => set({ profileUrl: event.target.value })} />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="lps-label">{t('lp.candidates.assessment')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {['relevantExperience', 'teachingExperience', 'english', 'technical'].map((key) => (
              <label key={key} className="block text-[12.5px]">
                <span className="mb-1 block lps-muted">{t(`lp.candidates.score.${key}` as StringKey)}</span>
                <select
                  className="lps-input !py-1"
                  value={form.assessment[key] ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => set({ assessment: { ...form.assessment, [key]: event.target.value ? Number(event.target.value) : undefined } })}
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <option key={score} value={score}>
                      {score}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block sm:col-span-2">
          <span className="lps-label">{t('lp.candidates.notes')}</span>
          <textarea className="lps-input min-h-[80px]" value={form.notes} disabled={!canEdit} onChange={(event) => set({ notes: event.target.value })} />
        </label>
      </div>

      {candidate && (
        <section className="mt-4">
          <h3 className="lps-eyebrow mb-2">{t('lp.candidates.files')}</h3>
          {candidate.files.length === 0 ? (
            <p className="text-[12.5px] lps-muted">{t('lp.evidence.none')}</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {candidate.files.map((file) => (
                <li key={file.id}>
                  <a href={runPaths.candidateFile(file.id)} target="_blank" rel="noreferrer" className="lps-bidi hover:underline">
                    {file.fileName}
                  </a>
                  <span className="ms-2 text-[12px] lps-muted">{t(`lp.candidateFile.${file.kind}` as StringKey)}</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="lps-input !w-auto !py-1" value={kind} onChange={(event) => setKind(event.target.value)} aria-label={t('lp.candidates.fileKind')}>
                {['CV', 'SAMPLE', 'ASSESSMENT', 'CONTRACT', 'OTHER'].map((value) => (
                  <option key={value} value={value}>
                    {t(`lp.candidateFile.${value}` as StringKey)}
                  </option>
                ))}
              </select>
              <input type="file" className="text-[12.5px]" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} aria-label={t('lp.evidence.addFile')} />
            </div>
          )}
        </section>
      )}
    </Drawer>
  );
}
