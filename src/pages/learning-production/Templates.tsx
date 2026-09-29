/**
 * Workflow templates — and where they came from.
 *
 * Three tabs: the templates (each scenario's current published version, its
 * stages and tasks with their origin, the options an administrator may change
 * by publishing a new version, and the versions runs are pinned to); the
 * workbook trace (every populated row of the business's workbook and what
 * became of it); and the anomalies and decisions still open for the owner.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, HelpCircle, Workflow } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { invalidate, useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths, runsApi } from '../../lib/learningProduction/runApi';
import { lpErrorKey } from '../../lib/learningProduction/format';
import type { TemplatesResponse, TraceabilityResponse } from '../../lib/learningProduction/runTypes';
import { useToast } from '../../components/ui';
import { Busy, Choice, ErrorNote, LoadingRows, OriginBadge, PageHero, Panel, Pill, ScenarioBadge, useDay, usePick } from '../../components/learning-production/studio';

type Tab = 'templates' | 'trace' | 'decisions';

export function Templates() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('templates');
  return (
    <div className="lps-stagger space-y-4">
      <PageHero icon={Workflow} title={t('lp.templates.title')} lede={t('lp.templates.lede')} />
      <div className="lps-tabs-sheet w-fit max-w-full">
      <Choice<Tab>
        label={t('lp.templates.title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'templates', label: t('lp.templates.tab.templates') },
          { value: 'trace', label: t('lp.templates.tab.trace') },
          { value: 'decisions', label: t('lp.templates.tab.decisions') },
        ]}
      />
      </div>
      {tab === 'templates' ? <TemplateList /> : <Trace tab={tab} />}
    </div>
  );
}

function TemplateList() {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const toast = useToast();
  const { data, error, loading, reload } = useLpQuery<TemplatesResponse>(runPaths.templates);
  const [scenario, setScenario] = useState<string>('EXPERT_NEW');
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const entry = data?.templates.find((item) => item.scenario === scenario);
  const options = (data?.options ?? []).filter((option) => option.scenarios.includes(scenario));
  const current = entry?.current;
  const values = draft ?? current?.options ?? {};
  const changed = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(current?.options);

  async function publish() {
    setBusy(true);
    try {
      await runsApi.publishTemplate(scenario, values, notes);
      invalidate();
      setDraft(null);
      setNotes('');
      toast.push(t('lp.templates.published'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingRows />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <Choice
        label={t('lp.templates.scenario')}
        value={scenario}
        onChange={(value) => {
          setScenario(value);
          setDraft(null);
        }}
        options={data.templates.map((item) => ({ value: item.scenario, label: pick(item.label) }))}
      />
      {current && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Panel
            className="xl:col-span-2"
            title={t('lp.templates.version', { n: current.versionNumber })}
            action={
              <span className="flex flex-wrap gap-1.5">
                <Pill tone="neutral">{t('lp.newRun.countStages', { n: current.summary.counts.stages })}</Pill>
                <Pill tone="neutral">{t('lp.newRun.countRequired', { n: current.summary.counts.required })}</Pill>
                <Pill tone="attention">{t('lp.newRun.countProposed', { n: current.summary.counts.proposed })}</Pill>
                {current.summary.counts.hidden > 0 && <Pill tone="outline">{t('lp.templates.hiddenCount', { n: current.summary.counts.hidden })}</Pill>}
              </span>
            }
            bodyClassName="p-0"
          >
            <ol>
              {current.summary.stages.map((stage, index) => (
                <li key={stage.key} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-[12px] font-semibold lps-faint">{index + 1}</span>
                    <span className="font-semibold">{pick(stage.label)}</span>
                    <OriginBadge origin={stage.origin} source={stage.source} />
                    {stage.after.length > 0 && <span className="text-[11.5px] lps-faint">{t('lp.templates.after', { stages: stage.after.map((key) => t(`lp.stageKey.${key}` as StringKey)).join('، ') })}</span>}
                  </div>
                  <ul className="ms-8 mt-1.5 space-y-1">
                    {stage.tasks.map((task) => (
                      <li key={task.key} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                        <span>{pick(task.label)}</span>
                        {task.classification !== 'REQUIRED' && <Pill tone="outline">{t(`lp.classification.${task.classification}` as StringKey)}</Pill>}
                        {task.kind === 'AUTO' && <Pill tone="outline">{t('lp.task.automatic')}</Pill>}
                        {task.requiresApproval && <Pill tone="outline">{t('lp.templates.approvedBy', { role: t(`lp.role.${task.reviewerRole}` as StringKey) })}</Pill>}
                        {task.origin !== 'WORKBOOK' && <OriginBadge origin={task.origin} source={task.source} compact />}
                        {task.role && <span className="lps-faint">{t(`lp.role.${task.role}` as StringKey)}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Panel>
          <div className="min-w-0 space-y-4">
            <Panel title={t('lp.templates.options')}>
              <ul className="space-y-2.5">
                {options.map((option) => (
                  <li key={option.key}>
                    <label className="flex items-start gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={!data.canAdmin}
                        checked={Boolean(values[option.key])}
                        onChange={(event) => setDraft({ ...values, [option.key]: event.target.checked })}
                      />
                      <span>
                        {pick(option.label)}
                        <span className="block text-[11.5px] lps-faint">{t('lp.templates.default', { value: option.default ? t('lp.prefs.on') : t('lp.prefs.off') })}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {data.canAdmin ? (
                <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--lps-line)' }}>
                  <label className="block">
                    <span className="lps-label">{t('lp.templates.notes')}</span>
                    <textarea className="lps-input min-h-[56px]" value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                  <button type="button" className="lps-btn-primary w-full" disabled={!changed || busy} onClick={publish}>
                    {busy && <Busy />}
                    {t('lp.templates.publish')}
                  </button>
                  <p className="text-[11.5px] lps-faint">{t('lp.templates.publishHint')}</p>
                </div>
              ) : (
                <p className="mt-3 text-[12px] lps-faint">{t('lp.templates.adminOnly')}</p>
              )}
            </Panel>
            <Panel title={t('lp.templates.versions')} bodyClassName="p-0">
              <ul>
                {entry!.versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2 border-b px-4 py-2 text-[12.5px] last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                    <span>
                      <strong>v{version.versionNumber}</strong> · {day(version.createdAt, { year: true })}
                      {version.notes && <span className="block lps-muted">{version.notes}</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {version.isCurrent && <Pill tone="ok">{t('lp.templates.current')}</Pill>}
                      <span className="lps-muted">{t('lp.templates.runs', { n: version.runs ?? 0 })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <p className="flex items-center gap-2 text-[11.5px] lps-faint">
              <ScenarioBadge scenario={scenario as never} short />
              <span dir="ltr">sha256 {data.workbookChecksum.slice(0, 12)}…</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Trace({ tab }: { tab: 'trace' | 'decisions' }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<TraceabilityResponse>(runPaths.traceability);
  const [status, setStatus] = useState('');
  const [sheet, setSheet] = useState('');
  const rows = useMemo(() => (data?.detail ?? []).filter((row) => (!status || row.status === status) && (!sheet || row.sheet === sheet)), [data, status, sheet]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingRows />;
  if (!data) return null;

  if (tab === 'decisions') {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={t('lp.templates.openDecisions')} bodyClassName="p-0">
          <ul>
            {data.openDecisions.map((decision) => (
              <li key={decision.id} className="border-b px-4 py-3 text-[13px] last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                <p className="flex items-start gap-2 font-medium">
                  <HelpCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0 lps-muted" />
                  <span dir="ltr" className="lps-bidi">{decision.question}</span>
                </p>
                <p className="ms-6 mt-1 text-[12.5px] lps-muted" dir="ltr">
                  <span className="lps-bidi">{decision.default}</span>
                </p>
                {decision.affectsRelease && <Pill tone="attention" className="ms-6 mt-1.5">{t('lp.templates.affectsRelease')}</Pill>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t('lp.templates.anomalies')} bodyClassName="p-0">
          <ul>
            {data.anomalies.map((anomaly) => (
              <li key={anomaly.id} className="border-b px-4 py-3 text-[12.5px] last:border-b-0" style={{ borderColor: 'var(--lps-line)' }} dir="ltr">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'var(--lps-attention)' }} />
                  {anomaly.where}
                </p>
                <p className="ms-6 mt-0.5">{anomaly.finding}</p>
                <p className="ms-6 mt-0.5 lps-muted">→ {anomaly.resolution}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <p className="text-[12px] lps-faint xl:col-span-2">{t('lp.templates.englishSource')}</p>
      </div>
    );
  }

  const sheets = [...new Set(data.detail.map((row) => row.sheet))];
  const statuses = [...new Set(data.detail.map((row) => row.status))];
  const untraced = data.detail.filter((row) => row.status === 'UNTRACED').length + data.master.filter((row) => row.status === 'UNTRACED').length;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet size={16} aria-hidden="true" />
          {t('lp.templates.traceTitle', { rows: data.detail.length, hidden: data.detail.filter((row) => row.hidden).length })}
        </span>
      }
      action={
        <span className="flex flex-wrap items-center gap-2">
          {untraced === 0 ? (
            <Pill tone="ok" icon={CheckCircle2}>
              {t('lp.templates.allTraced')}
            </Pill>
          ) : (
            <Pill tone="danger">{t('lp.templates.untraced', { n: untraced })}</Pill>
          )}
          <select className="lps-input !w-auto !py-1.5" value={sheet} onChange={(event) => setSheet(event.target.value)} aria-label={t('lp.templates.sheet')}>
            <option value="">{t('lp.templates.allSheets')}</option>
            {sheets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select className="lps-input !w-auto !py-1.5" value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t('lp.col.status')}>
            <option value="">{t('lp.templates.allStatuses')}</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {t(`lp.trace.${value}` as StringKey)}
              </option>
            ))}
          </select>
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="max-h-[70vh] overflow-auto">
        <table className="lps-table min-w-[860px]" dir="ltr">
          <thead>
            <tr>
              <th>{t('lp.templates.sheet')}</th>
              <th className="w-14">{t('lp.templates.row')}</th>
              <th>{t('lp.templates.text')}</th>
              <th>{t('lp.col.status')}</th>
              <th>{t('lp.templates.usedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sheet}#${row.row}`}>
                <td className="whitespace-nowrap text-[12px]">{row.sheet}</td>
                <td className="text-[12px]">
                  {row.row}
                  {row.hidden && <span className="ms-1 lps-faint">(H)</span>}
                </td>
                <td className="max-w-[360px] text-[12.5px]">{row.text ?? <span className="lps-faint">—</span>}</td>
                <td>
                  <Pill tone={row.status === 'USED' ? 'ok' : row.status === 'UNTRACED' ? 'danger' : 'outline'}>{t(`lp.trace.${row.status}` as StringKey)}</Pill>
                </td>
                <td className="max-w-[280px] truncate text-[11.5px] lps-muted" title={row.usedBy.join('\n') || row.note || ''}>
                  {row.usedBy.length ? row.usedBy.slice(0, 2).join(', ') + (row.usedBy.length > 2 ? ` +${row.usedBy.length - 2}` : '') : row.note ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
