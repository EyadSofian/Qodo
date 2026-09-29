/**
 * QA & release.
 *
 * Everything between "the content is approved" and "learners have it", in
 * one place: whether the run is ready for release and why not, the
 * deployment and UAT sign-offs, every dry-run and UAT issue with its owner
 * and state, the release itself — prepared, signed off by someone else,
 * published with the platform link as evidence — and every release before
 * it. A revamp also records its change impact here.
 *
 * `?issue=<id>` and `?release=<id>` open the issue or the release, so a
 * notification can link straight to either.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bug, CheckCircle2, ExternalLink, Flag, Package, Plus, Rocket, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runPaths, runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { Issue, IssueArea, IssueDetail, IssueSeverity, IssuesResponse, Release, RunView } from '../../../lib/learningProduction/runTypes';
import type { People } from '../../../lib/learningProduction/types';
import { useAuth } from '../../../lib/auth';
import { useToast } from '../../../components/ui';
import { usePeople } from '../../../components/learning-production/kit';
import {
  Busy,
  Choice,
  Drawer,
  EmptyNote,
  ErrorNote,
  IssueStatusPill,
  LoadingRows,
  Panel,
  PersonLine,
  Pill,
  ReasonPrompt,
  ReleaseStatusPill,
  SeverityPill,
  TaskStatusPill,
  useDay,
  usePick,
} from '../../../components/learning-production/studio';
import { useCourse } from '../CourseWorkspace';
import { Readiness } from './RunOverview';
import { IssueFields } from './TaskDrawer';
import { ImpactPanel } from './ImpactPanel';

export function QaRelease() {
  const { t } = useI18n();
  const { run } = useCourse();
  if (!run) return <LoadingRows rows={8} />;
  if (run.run.scenario === 'LEGACY') {
    return (
      <div className="space-y-4">
        <p className="lps-callout-info">{t('lp.qa.legacy')}</p>
        <ReleaseHistory view={run} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {run.run.scenario === 'REVAMP' && <ImpactPanel view={run} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <IssuesPanel view={run} />
          <ReleaseHistory view={run} />
        </div>
        <div className="min-w-0 space-y-4">
          <ReleasePanel view={run} />
          <SignoffStatus view={run} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign-offs along the way                                              */
/* ------------------------------------------------------------------ */

function SignoffStatus({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const keys = ['deploy.verify', 'redeploy.apply', 'uat.execute', 'uat.signoff'];
  const tasks = view.stages.flatMap((stage) => stage.tasks).filter((task) => keys.includes(task.key));
  if (tasks.length === 0) return null;
  return (
    <Panel title={t('lp.qa.signoffs')} bodyClassName="p-0">
      <ul>
        {tasks.map((task) => (
          <li key={task.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
            <Link to={`/learning-production/courses/${view.course.id}/plan?task=${task.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[color:var(--lps-sunken)]">
              <span className="min-w-0 truncate text-[13px] font-medium">{pick(task.label)}</span>
              <TaskStatusPill display={task.display} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Issues                                                               */
/* ------------------------------------------------------------------ */

type IssueFilter = 'open' | 'fixed' | 'closed' | 'all';

function IssuesPanel({ view }: { view: RunView }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useLpQuery<IssuesResponse>(runPaths.issues(view.run.id));
  const [filter, setFilter] = useState<IssueFilter>('open');
  const [stage, setStage] = useState('');
  const [reporting, setReporting] = useState(false);
  const issueId = params.get('issue');

  const issues = useMemo(
    () =>
      (data?.issues ?? []).filter(
        (issue) =>
          (!stage || issue.stageId === stage) &&
          (filter === 'all' ||
            (filter === 'open' && ['OPEN', 'IN_PROGRESS'].includes(issue.status)) ||
            (filter === 'fixed' && issue.status === 'FIXED') ||
            (filter === 'closed' && ['VERIFIED', 'WONT_FIX'].includes(issue.status)))
      ),
    [data, filter, stage]
  );
  const count = (predicate: (issue: Issue) => boolean) => (data?.issues ?? []).filter(predicate).length;

  const setIssue = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('issue', id);
    else next.delete('issue');
    setParams(next);
  };

  return (
    <Panel
      title={t('lp.qa.issues')}
      bodyClassName="p-0"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {data && data.stages.length > 1 && (
            <select className="lps-input !w-auto !py-1.5" value={stage} onChange={(event) => setStage(event.target.value)} aria-label={t('lp.qa.issueStage')}>
              <option value="">{t('lp.qa.allStages')}</option>
              {data.stages.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {pick(entry.label)}
                </option>
              ))}
            </select>
          )}
          {data?.canReport && (
            <button type="button" className="lps-btn" onClick={() => setReporting(true)}>
              <Plus size={14} aria-hidden="true" />
              {t('lp.issue.report')}
            </button>
          )}
        </div>
      }
    >
      <div className="px-4">
        <Choice<IssueFilter>
          label={t('lp.qa.issues')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: t('lp.qa.filter.open'), count: count((issue) => ['OPEN', 'IN_PROGRESS'].includes(issue.status)) },
            { value: 'fixed', label: t('lp.qa.filter.fixed'), count: count((issue) => issue.status === 'FIXED') },
            { value: 'closed', label: t('lp.qa.filter.closed'), count: count((issue) => ['VERIFIED', 'WONT_FIX'].includes(issue.status)) },
            { value: 'all', label: t('lp.qa.filter.all') },
          ]}
        />
      </div>
      {error ? (
        <div className="p-4">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <LoadingRows rows={4} />
      ) : issues.length === 0 ? (
        <EmptyNote icon={Bug} title={data?.issues.length ? t('lp.qa.noIssuesHere') : t('lp.qa.noIssues')} body={data?.issues.length ? undefined : t('lp.qa.noIssuesBody')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="lps-table min-w-[720px]">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>{t('lp.issue.title')}</th>
                <th>{t('lp.issue.severity')}</th>
                <th>{t('lp.col.status')}</th>
                <th>{t('lp.issue.owner')}</th>
                <th>{t('lp.col.stage')}</th>
                <th>{t('lp.issue.reported')}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className="lps-row-link" onClick={() => setIssue(issue.id)}>
                  <td className="font-semibold lps-muted">{issue.issueNumber}</td>
                  <td className="max-w-[320px]">
                    <button type="button" className="lps-bidi block truncate text-start font-medium hover:underline" onClick={(event) => { event.stopPropagation(); setIssue(issue.id); }}>
                      {issue.title}
                    </button>
                    <span className="text-[11.5px] lps-faint">{t(`lp.issueArea.${issue.area}` as StringKey)}</span>
                  </td>
                  <td>
                    <SeverityPill severity={issue.severity} />
                  </td>
                  <td>
                    <IssueStatusPill status={issue.status} />
                  </td>
                  <td>
                    <PersonLine userId={issue.ownerUserId} people={data?.people ?? {}} />
                  </td>
                  <td className="max-w-[160px] truncate text-[12.5px]">{pick(issue.stageLabel)}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{day(issue.reportedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reporting && data && <ReportIssue runId={view.run.id} stages={data.stages} onClose={() => setReporting(false)} />}
      {issueId && <IssueDrawer issueId={issueId} onClose={() => setIssue(null)} />}
    </Panel>
  );
}

function ReportIssue({ runId, stages, onClose }: { runId: string; stages: IssuesResponse['stages']; onClose: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const toast = useToast();
  const people = usePeople();
  const [stageId, setStageId] = useState(stages[stages.length - 1]?.id ?? '');
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IssueSeverity>('MEDIUM');
  const [area, setArea] = useState<IssueArea>('CONTENT');
  const [owner, setOwner] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await runsApi.createIssue(runId, { stageId, title: title.trim(), severity, area, ownerUserId: owner, description });
      invalidate();
      toast.push(t('lp.issue.logged'));
      onClose();
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={() => (title || description ? window.confirm(t('lp.unsaved.confirm')) && onClose() : onClose())}
      title={t('lp.issue.report')}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="lps-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="lps-btn-primary" disabled={busy || !title.trim() || !stageId} onClick={save}>
            {busy && <Busy />}
            {t('lp.issue.log')}
          </button>
        </div>
      }
    >
      <label className="mb-3 block">
        <span className="lps-label">{t('lp.qa.issueStage')} *</span>
        <select className="lps-input" value={stageId} onChange={(event) => setStageId(event.target.value)}>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {pick(stage.label)}
            </option>
          ))}
        </select>
      </label>
      <IssueFields title={title} setTitle={setTitle} severity={severity} setSeverity={setSeverity} area={area} setArea={setArea} owner={owner} setOwner={setOwner} description={description} setDescription={setDescription} people={people} />
    </Drawer>
  );
}

function IssueDrawer({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLpQuery<IssueDetail>(runPaths.issue(issueId));
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState<null | 'reopen' | 'wont-fix'>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const next = await runsApi.issueAction(issueId, action, body);
      setData(next);
      invalidate();
      setNote('');
      setPrompt(null);
      toast.push(t(`lp.issue.done.${action}` as StringKey));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  const issue = data?.issue;
  const actions = data?.actions;
  return (
    <Drawer
      open
      onClose={onClose}
      title={issue ? `#${issue.issueNumber} ${issue.title}` : t('lp.task.loading')}
      subtitle={
        issue ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <IssueStatusPill status={issue.status} />
            <SeverityPill severity={issue.severity} />
            <Pill tone="outline">{t(`lp.issueArea.${issue.area}` as StringKey)}</Pill>
            <span className="text-[12px] lps-muted">{pick(issue.stageLabel)}</span>
          </span>
        ) : null
      }
    >
      {error && !data ? <ErrorNote error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingRows rows={5} /> : null}
      {issue && actions && data && (
        <div className="space-y-4 text-[13px]">
          {issue.description && <p className="lps-bidi whitespace-pre-wrap">{issue.description}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="lps-muted">{t('lp.issue.owner')}</dt>
            <dd>
              <PersonLine userId={issue.ownerUserId} people={data.people} />
            </dd>
            <dt className="lps-muted">{t('lp.issue.reportedBy')}</dt>
            <dd>
              <PersonLine userId={issue.reportedBy} people={data.people} /> · {day(issue.reportedAt)}
            </dd>
            {issue.lessonName && (
              <>
                <dt className="lps-muted">{t('lp.col.lesson')}</dt>
                <dd>{issue.lessonName}</dd>
              </>
            )}
            {issue.fixedAt && (
              <>
                <dt className="lps-muted">{t('lp.issue.fixedBy')}</dt>
                <dd>
                  <PersonLine userId={issue.fixedBy} people={data.people} /> · {day(issue.fixedAt)}
                  {issue.fixNote && <span className="lps-bidi block lps-muted">“{issue.fixNote}”</span>}
                </dd>
              </>
            )}
            {issue.verifiedAt && (
              <>
                <dt className="lps-muted">{t('lp.issue.verifiedBy')}</dt>
                <dd>
                  <PersonLine userId={issue.verifiedBy} people={data.people} /> · {day(issue.verifiedAt)}
                </dd>
              </>
            )}
            {issue.wontFixReason && (
              <>
                <dt className="lps-muted">{t('lp.issueStatus.WONT_FIX')}</dt>
                <dd className="lps-bidi">“{issue.wontFixReason}”</dd>
              </>
            )}
          </dl>

          {(actions.FIX.allowed || actions.VERIFY.allowed) && (
            <div className="lps-panel space-y-2 p-3">
              <label className="block">
                <span className="lps-label">{actions.FIX.allowed ? `${t('lp.issue.fixNote')} *` : t('lp.issue.verifyNote')}</span>
                <textarea className="lps-input min-h-[64px]" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                {actions.START.allowed && (
                  <button type="button" className="lps-btn" disabled={Boolean(busy)} onClick={() => act('start')}>
                    {t('lp.issue.start')}
                  </button>
                )}
                {actions.FIX.allowed && (
                  <button type="button" className="lps-btn-primary" disabled={Boolean(busy) || !note.trim()} onClick={() => act('fix', { note })}>
                    {busy === 'fix' ? <Busy /> : <CheckCircle2 size={15} aria-hidden="true" />}
                    {t('lp.issue.markFixed')}
                  </button>
                )}
                {actions.VERIFY.allowed && (
                  <button type="button" className="lps-btn-primary" disabled={Boolean(busy)} onClick={() => act('verify', { note })}>
                    {busy === 'verify' ? <Busy /> : <ShieldCheck size={15} aria-hidden="true" />}
                    {t('lp.issue.verify')}
                  </button>
                )}
              </div>
            </div>
          )}
          {!actions.VERIFY.allowed && actions.VERIFY.reason === 'OWN_WORK' && <p className="text-[12.5px] lps-muted">{t('lp.issue.verifyOwn')}</p>}

          <div className="flex flex-wrap gap-2">
            {actions.REOPEN.allowed && (
              <button type="button" className="lps-btn" onClick={() => setPrompt('reopen')}>
                <Undo2 size={14} aria-hidden="true" />
                {t('lp.issue.reopen')}
              </button>
            )}
            {actions.WONT_FIX.allowed && (
              <button type="button" className="lps-btn" onClick={() => setPrompt('wont-fix')}>
                {t('lp.issue.wontFix')}
              </button>
            )}
          </div>
        </div>
      )}
      <ReasonPrompt
        open={prompt === 'reopen'}
        title={t('lp.issue.reopen')}
        label={t('lp.reason.label')}
        confirm={t('lp.issue.reopen')}
        busy={busy === 'reopen'}
        onCancel={() => setPrompt(null)}
        onConfirm={(reason) => act('reopen', { reason })}
      />
      <ReasonPrompt
        open={prompt === 'wont-fix'}
        title={t('lp.issue.wontFix')}
        body={t('lp.issue.wontFixBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.issue.wontFix')}
        busy={busy === 'wont-fix'}
        onCancel={() => setPrompt(null)}
        onConfirm={(reason) => act('wont-fix', { reason })}
      />
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* The release                                                          */
/* ------------------------------------------------------------------ */

function ReleasePanel({ view }: { view: RunView }) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const [deployNotes, setDeployNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [prompt, setPrompt] = useState<null | 'withdraw'>(null);
  const caps = view.capabilities;
  const live = view.releases.find((release) => release.runId === view.run.id && ['CANDIDATE', 'SIGNED_OFF'].includes(release.status)) ?? null;
  const published = view.releases.find((release) => release.runId === view.run.id && release.status === 'PUBLISHED') ?? null;
  const readiness = view.progress.readiness;
  const ownCandidate = live?.preparedBy === user?.id;

  async function act(key: string, call: () => Promise<unknown>, success: StringKey) {
    setBusy(key);
    try {
      await call();
      invalidate();
      toast.push(t(success));
      setPrompt(null);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t('lp.release.title')}>
      <p className="mb-2 text-[12.5px] font-semibold">{t('lp.progress.readiness')}</p>
      <Readiness view={view} />

      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--lps-line)' }}>
        {published ? (
          <div className="space-y-1 text-[13px]">
            <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--lps-ok)' }}>
              <Rocket size={15} aria-hidden="true" />
              {t('lp.release.publishedAs', { label: published.versionLabel })}
            </p>
            {published.platformUrl && (
              <a href={published.platformUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12.5px] underline" dir="ltr">
                {published.platformUrl}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>
        ) : !live ? (
          caps.manageRuns && view.runOpen ? (
            <div className="space-y-2">
              <p className="text-[12.5px] lps-muted">{readiness.readyForSignoff ? t('lp.release.readyToPrepare') : t('lp.release.notReady')}</p>
              {readiness.readyForSignoff && (
                <>
              <label className="block">
                <span className="lps-label">{t('lp.release.label')}</span>
                <input className="lps-input" dir="ltr" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('lp.release.labelAuto')} maxLength={40} />
              </label>
              <label className="block">
                <span className="lps-label">{t('lp.release.notes')}</span>
                <textarea className="lps-input min-h-[56px]" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <button
                type="button"
                className="lps-btn-primary w-full"
                disabled={!readiness.readyForSignoff || Boolean(busy)}
                onClick={() => act('prepare', () => runsApi.prepareRelease(view.run.id, { versionLabel: label.trim() || undefined, notes }), 'lp.release.prepared')}
              >
                {busy === 'prepare' ? <Busy /> : <Package size={15} aria-hidden="true" />}
                {t('lp.release.prepare')}
              </button>
                </>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] lps-muted">{t('lp.release.none')}</p>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{live.versionLabel}</span>
              <ReleaseStatusPill status={live.status} />
            </div>
            <p className="text-[12px] lps-muted">
              {t('lp.release.summary', { lessons: live.summary.lessons ?? 0, approved: live.summary.approvedAssets ?? 0, assets: live.summary.assets ?? 0 })}
            </p>
            {live.status === 'CANDIDATE' && (
              caps.signoffReleases ? (
                <div className="space-y-2">
                  {ownCandidate && !caps.isAdmin ? (
                    <p className="text-[12.5px]" style={{ color: 'var(--lps-attention)' }}>{t('lp.release.ownCandidate')}</p>
                  ) : (
                    <>
                      {ownCandidate && (
                        <label className="block">
                          <span className="lps-label">{t('lp.task.overrideReason')} *</span>
                          <input className="lps-input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} />
                        </label>
                      )}
                      <button
                        type="button"
                        className="lps-btn-primary w-full"
                        disabled={Boolean(busy) || (ownCandidate && !overrideReason.trim())}
                        onClick={() => act('signoff', () => runsApi.releaseAction(live.id, 'signoff', { overrideReason: overrideReason || undefined }), 'lp.release.signedOff')}
                      >
                        {busy === 'signoff' ? <Busy /> : <ShieldCheck size={15} aria-hidden="true" />}
                        {t('lp.release.signoff')}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-[12.5px] lps-muted">{t('lp.release.waitingSignoff')}</p>
              )
            )}
            {live.status === 'SIGNED_OFF' && caps.publishReleases && (
              <div className="space-y-2">
                <p className="text-[12.5px] lps-muted">{t('lp.release.publishHint')}</p>
                <label className="block">
                  <span className="lps-label">{t('lp.release.platformUrl')} *</span>
                  <input className="lps-input" dir="ltr" type="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
                </label>
                <label className="block">
                  <span className="lps-label">{t('lp.release.deploymentNotes')}</span>
                  <textarea className="lps-input min-h-[56px]" value={deployNotes} onChange={(event) => setDeployNotes(event.target.value)} />
                </label>
                <button
                  type="button"
                  className="lps-btn-primary w-full"
                  disabled={Boolean(busy) || !/^https:\/\//i.test(url.trim())}
                  onClick={() => act('publish', () => runsApi.releaseAction(live.id, 'publish', { platformUrl: url.trim(), deploymentNotes: deployNotes }), 'lp.release.published')}
                >
                  {busy === 'publish' ? <Busy /> : <Rocket size={15} aria-hidden="true" />}
                  {t('lp.release.publish')}
                </button>
              </div>
            )}
            {caps.manageRuns && (
              <button type="button" className="lps-btn-quiet w-full" onClick={() => setPrompt('withdraw')}>
                {t('lp.release.withdraw')}
              </button>
            )}
          </div>
        )}
      </div>
      <ReasonPrompt
        open={prompt === 'withdraw' && Boolean(live)}
        title={t('lp.release.withdraw')}
        body={t('lp.release.withdrawBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.release.withdraw')}
        danger
        busy={busy === 'withdraw'}
        onCancel={() => setPrompt(null)}
        onConfirm={(reason) => live && act('withdraw', () => runsApi.releaseAction(live.id, 'withdraw', { reason }), 'lp.release.withdrawn')}
      />
    </Panel>
  );
}

function ReleaseHistory({ view }: { view: RunView }) {
  const { t } = useI18n();
  const day = useDay();
  const [params, setParams] = useSearchParams();
  const releaseId = params.get('release');
  const setRelease = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('release', id);
    else next.delete('release');
    setParams(next);
  };
  return (
    <Panel title={t('lp.release.history')} bodyClassName="p-0">
      {view.releases.length === 0 ? (
        <EmptyNote icon={Package} title={t('lp.release.historyEmpty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="lps-table min-w-[620px]">
            <thead>
              <tr>
                <th>{t('lp.release.label')}</th>
                <th>{t('lp.col.status')}</th>
                <th>{t('lp.col.run')}</th>
                <th>{t('lp.release.prepared')}</th>
                <th>{t('lp.release.publishedCol')}</th>
              </tr>
            </thead>
            <tbody>
              {view.releases.map((release) => (
                <tr key={release.id} className="lps-row-link" onClick={() => setRelease(release.id)}>
                  <td className="font-semibold" dir="ltr">
                    {release.versionLabel}
                    {release.id === view.course.currentReleaseId && <Pill tone="ok" className="ms-2">{t('lp.release.current')}</Pill>}
                    {release.kind === 'LEGACY_BASELINE' && <Pill tone="outline" className="ms-2">{t('lp.releaseKind.LEGACY_BASELINE')}</Pill>}
                  </td>
                  <td>
                    <ReleaseStatusPill status={release.status} />
                  </td>
                  <td className="text-[12.5px]">{release.runNumber ? t('lp.run.number', { n: release.runNumber }) : '—'}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{day(release.preparedAt, { year: true })}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{day(release.publishedAt, { year: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {releaseId && <ReleaseDrawer releaseId={releaseId} view={view} onClose={() => setRelease(null)} />}
    </Panel>
  );
}

function ReleaseDrawer({ releaseId, view, onClose }: { releaseId: string; view: RunView; onClose: () => void }) {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const { data, error, loading, reload } = useLpQuery<{ release: Release; stale: string[]; people: People }>(runPaths.release(releaseId));
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const release = data?.release;
  const canRollback = view.capabilities.publishReleases && release?.status === 'PUBLISHED' && view.course.currentReleaseId === release.id;

  async function rollback(reason: string) {
    setBusy(true);
    try {
      await runsApi.releaseAction(releaseId, 'rollback', { reason });
      invalidate();
      toast.push(t('lp.release.rolledBack'));
      setPrompt(false);
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={release ? t('lp.release.drawerTitle', { label: release.versionLabel }) : t('lp.task.loading')} subtitle={release ? <ReleaseStatusPill status={release.status} /> : null}>
      {error && !data ? <ErrorNote error={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingRows rows={5} /> : null}
      {release && data && (
        <div className="space-y-4 text-[13px]">
          {data.stale.length > 0 && <p className="lps-callout">{t('lp.release.stale', { n: data.stale.length })}</p>}
          {release.kind === 'LEGACY_BASELINE' && <p className="lps-callout-info">{t('lp.release.baselineNote')}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="lps-muted">{t('lp.release.prepared')}</dt>
            <dd>
              <PersonLine userId={release.preparedBy} people={data.people} /> · {day(release.preparedAt, { year: true })}
            </dd>
            {release.signoffAt && (
              <>
                <dt className="lps-muted">{t('lp.release.signedOffBy')}</dt>
                <dd>
                  <PersonLine userId={release.signoffBy} people={data.people} /> · {day(release.signoffAt, { year: true })}
                  {release.signoffOverrideReason && <span className="block" style={{ color: 'var(--lps-attention)' }}>{t('lp.task.adminOverride', { reason: release.signoffOverrideReason })}</span>}
                </dd>
              </>
            )}
            {release.publishedAt && (
              <>
                <dt className="lps-muted">{t('lp.release.publishedCol')}</dt>
                <dd>
                  <PersonLine userId={release.publishedBy} people={data.people} /> · {day(release.publishedAt, { year: true })}
                  {release.platformUrl && (
                    <a href={release.platformUrl} target="_blank" rel="noreferrer noopener" className="block underline" dir="ltr">
                      {release.platformUrl}
                    </a>
                  )}
                  {release.deploymentNotes && <span className="lps-bidi block lps-muted">{release.deploymentNotes}</span>}
                </dd>
              </>
            )}
            {release.rollbackReason && (
              <>
                <dt className="lps-muted">{t('lp.releaseStatus.ROLLED_BACK')}</dt>
                <dd className="lps-bidi">“{release.rollbackReason}”</dd>
              </>
            )}
            {release.withdrawReason && (
              <>
                <dt className="lps-muted">{t('lp.releaseStatus.WITHDRAWN')}</dt>
                <dd className="lps-bidi">“{release.withdrawReason}”</dd>
              </>
            )}
          </dl>

          {release.snapshot && (
            <section>
              <h3 className="lps-eyebrow mb-2">{t('lp.release.contents', { n: release.snapshot.lessons.length })}</h3>
              <div className="overflow-x-auto">
                <table className="lps-table min-w-[460px]">
                  <thead>
                    <tr>
                      <th>{t('lp.col.lesson')}</th>
                      {view.run.lessonAssetTypes.map((type) => (
                        <th key={type} className="text-center">
                          {t(`lp.stage.${type}` as StringKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {release.snapshot.lessons.map((lesson) => (
                      <tr key={lesson.id}>
                        <td className="lps-bidi max-w-[200px] truncate">{lesson.name}</td>
                        {view.run.lessonAssetTypes.map((type) => {
                          const asset = lesson.assets.find((entry) => entry.type === type);
                          return (
                            <td key={type} className="text-center text-[12px]">
                              {!asset || !asset.applicable ? <span className="lps-faint">—</span> : asset.versionNumber ? `v${asset.versionNumber}` : <span style={{ color: 'var(--lps-attention)' }}>{t('lp.release.notApproved')}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {release.snapshot.deliverables.length > 0 && (
                <ul className="mt-3 space-y-1 text-[12.5px]">
                  {release.snapshot.deliverables.map((entry) => (
                    <li key={entry.taskKey} className="flex items-center gap-2">
                      <Flag size={12} aria-hidden="true" className="lps-faint" />
                      {pick(entry.label)} · {t('lp.task.submissionN', { n: entry.submissionNumber })}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {canRollback && (
            <button type="button" className="lps-btn-danger" onClick={() => setPrompt(true)}>
              <RotateCcw size={14} aria-hidden="true" />
              {t('lp.release.rollback')}
            </button>
          )}
        </div>
      )}
      <ReasonPrompt
        open={prompt}
        title={t('lp.release.rollback')}
        body={t('lp.release.rollbackBody')}
        label={t('lp.reason.label')}
        confirm={t('lp.release.rollback')}
        danger
        busy={busy}
        onCancel={() => setPrompt(false)}
        onConfirm={rollback}
      />
    </Drawer>
  );
}
