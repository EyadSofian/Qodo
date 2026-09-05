/**
 * Qodo Projects — the issue tracker.
 *
 * Sorted by severity by default, not by date. An issue list is a triage queue:
 * the question it answers is "what is worst", and a newest-first list buries a
 * blocker under three cosmetic reports within a day.
 *
 * The SLA state is on every row rather than behind a click, for the same
 * reason. A breach that has to be looked for is a breach nobody sees.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertOctagon, Bug, Eye, Plus, Timer } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { issuesApi, projectSettingsApi } from '../../../lib/projects/api';
import type { Issue, IssueSeverity, StatusDefinition } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Modal, Segmented, Spinner, useToast } from '../../../components/ui';

type Filter = 'open' | 'mine' | 'reported' | 'all';

const SEVERITIES: IssueSeverity[] = ['blocker', 'critical', 'major', 'minor', 'cosmetic'];

/**
 * Severity as a colour *and* a word.
 *
 * §74 forbids conveying status by colour alone, and severity is the one field
 * on this screen somebody scans for. The chip always carries its label.
 */
const SEVERITY_TONE: Record<IssueSeverity, string> = {
  blocker: 'bg-status-badBg text-status-bad',
  critical: 'bg-status-badBg text-status-bad',
  major: 'bg-status-warnBg text-accent-700',
  minor: 'bg-surface-sunken text-ink-muted',
  cosmetic: 'bg-surface-sunken text-ink-faint',
};

export function ProjectIssues() {
  const { detail, can } = useProject();
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [filter, setFilter] = useState<Filter>('open');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [issueResult, statusResult] = await Promise.all([
        issuesApi.list(projectId, {
          open: filter === 'open' || undefined,
          mine: filter === 'mine' || undefined,
          reported: filter === 'reported' || undefined,
          sort: 'severity',
          direction: 'asc',
          limit: 100,
        }),
        projectSettingsApi.statuses('issue').catch(() => ({ statuses: [] as StatusDefinition[] })),
      ]);
      setIssues(issueResult.issues);
      setStatuses(statusResult.statuses);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, lang]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const changeStatus = async (issue: Issue, statusId: string) => {
    try {
      await issuesApi.update(projectId, issue.id, { statusId });
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const filters = useMemo(
    () => [
      { value: 'open' as Filter, label: t('issues.filter.open') },
      { value: 'mine' as Filter, label: t('issues.filter.mine') },
      { value: 'reported' as Filter, label: t('issues.filter.reported') },
      { value: 'all' as Filter, label: t('issues.filter.all') },
    ],
    [t]
  );

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={filter} onChange={setFilter} options={filters} className="flex-1 min-w-[260px]" />
        {can('issue.create') && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={15} />
            {t('issues.new')}
          </button>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<Bug size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : issues.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bug size={32} />}
            title={t('issues.empty')}
            body={t('issues.emptyHint')}
            action={
              can('issue.create') ? (
                <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
                  <Plus size={15} />
                  {t('issues.new')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {issues.map((issue) => {
            const breached = issue.sla?.responseBreached || issue.sla?.resolutionBreached;
            return (
              <li key={issue.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="chip shrink-0 bg-surface-sunken font-mono text-[11.5px] text-ink-muted">
                  {issue.key}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{issue.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-ink-muted">
                    <span className={`chip ${SEVERITY_TONE[issue.severity]}`}>
                      {t(`issues.severity.${issue.severity}`)}
                    </span>
                    {issue.isExternal && (
                      <span className="inline-flex items-center gap-1 text-status-info">
                        <Eye size={11} aria-hidden="true" />
                        {t('issues.visibility.external')}
                      </span>
                    )}
                    {issue.sla?.resolutionDueAt && !breached && (
                      <span className="inline-flex items-center gap-1">
                        <Timer size={11} aria-hidden="true" />
                        {new Date(issue.sla.resolutionDueAt).toLocaleDateString(
                          lang === 'ar' ? 'ar-EG' : 'en-GB'
                        )}
                      </span>
                    )}
                    {breached && (
                      <span className="inline-flex items-center gap-1 font-semibold text-status-bad">
                        <AlertOctagon size={11} aria-hidden="true" />
                        {t('issues.sla.breached')}
                        {issue.sla && issue.sla.escalationLevel > 0 &&
                          ` · ${t('issues.sla.escalated', { n: issue.sla.escalationLevel })}`}
                      </span>
                    )}
                  </p>
                </div>

                {can('issue.edit') && statuses.length > 0 ? (
                  <label className="shrink-0">
                    <span className="sr-only">{issue.title}</span>
                    <select
                      className="field !w-auto !py-1 !text-[12px]"
                      value={issue.statusId ?? ''}
                      onChange={(event) => void changeStatus(issue, event.target.value)}
                    >
                      {statuses
                        .filter((status) => status.isActive || status.id === issue.statusId)
                        .map((status) => (
                          <option key={status.id} value={status.id}>
                            {pick(status.label)}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  issue.status && (
                    <span
                      className="chip shrink-0"
                      style={{ backgroundColor: `${issue.status.color}1A`, color: issue.status.color }}
                    >
                      {pick(issue.status.label)}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      <IssueDialog
        open={creating}
        projectId={projectId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />
    </section>
  );
}

function IssueDialog({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IssueSeverity>('minor');
  const [moduleAffected, setModuleAffected] = useState('');
  const [isExternal, setIsExternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle('');
    setDescription('');
    setSeverity('minor');
    setModuleAffected('');
    setIsExternal(false);
    setError(null);
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await issuesApi.create(projectId, {
        title: title.trim(),
        description: description.trim(),
        severity,
        moduleAffected: moduleAffected.trim() || null,
        isExternal,
      });
      onCreated();
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
      title={t('issues.new')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="issue-create" className="btn-primary btn-sm" disabled={!title.trim() || saving}>
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="issue-create" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <Field label={t('issues.field.title')} required>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={200} />
        </Field>

        <Field label={t('projects.field.description')}>
          <textarea
            className="field min-h-[84px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('issues.field.severity')}>
            <select className="field" value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)}>
              {SEVERITIES.map((option) => (
                <option key={option} value={option}>
                  {t(`issues.severity.${option}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('issues.field.module')}>
            <input
              className="field"
              value={moduleAffected}
              onChange={(e) => setModuleAffected(e.target.value)}
              maxLength={120}
            />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="label">{t('issues.field.visibility')}</legend>
          {([false, true] as const).map((option) => (
            <label
              key={String(option)}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                isExternal === option ? 'border-brand-400 bg-brand-50' : 'border-surface-line hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                name="issue-visibility"
                className="mt-1"
                checked={isExternal === option}
                onChange={() => setIsExternal(option)}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink">
                  {option ? t('issues.visibility.external') : t('issues.visibility.internal')}
                </span>
                <span className="block text-[12px] leading-relaxed text-ink-muted">
                  {option ? t('issues.visibility.externalHint') : t('issues.visibility.internalHint')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}
