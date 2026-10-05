/**
 * A revamp's change impact.
 *
 * Against the source release, line by line: keep the lesson (its approvals
 * are referenced, not copied), change it — the whole lesson or only some of
 * its assets, which will reopen and need new approvals — or remove it.
 * Decisions are signed off through the "Record the change impact" task and
 * applied as a separate, explicit step. Once applied they are history.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCompare } from 'lucide-react';
import { useI18n, type StringKey } from '../../../lib/i18n';
import { runPaths, runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { ImpactDecision, ImpactResponse, RunView } from '../../../lib/learningProduction/runTypes';
import type { AssetType } from '../../../lib/learningProduction/types';
import { useToast } from '../../../components/ui';
import { Busy, ErrorNote, LoadingRows, Panel, Pill, TaskStatusPill, useDay } from '../../../components/learning-production/studio';

type Row = { decision: ImpactDecision; note: string; assets: AssetType[] };

export function ImpactPanel({ view }: { view: RunView }) {
  const { t } = useI18n();
  const day = useDay();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLpQuery<ImpactResponse>(runPaths.impact(view.run.id));
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.snapshot) return;
    const next: Record<string, Row> = {};
    for (const lesson of data.snapshot.lessons) {
      const own = data.items.find((item) => item.lessonId === lesson.id && !item.assetType);
      const assets = data.items.filter((item) => item.lessonId === lesson.id && item.assetType && item.decision === 'CHANGE').map((item) => item.assetType as AssetType);
      next[lesson.id] = { decision: assets.length ? 'CHANGE' : own?.decision ?? 'KEEP', note: own?.note ?? '', assets };
    }
    setRows(next);
  }, [data]);

  const dirty = useMemo(() => Boolean(data) && data!.items.length === 0 && Object.keys(rows).length > 0, [data, rows]);
  const impactTask = view.stages.flatMap((stage) => stage.tasks).find((task) => task.key === 'impact.review');

  async function save() {
    setBusy('save');
    const items: Array<Record<string, unknown>> = [];
    for (const [lessonId, row] of Object.entries(rows)) {
      if (row.decision === 'CHANGE' && row.assets.length) {
        // Only the chosen assets change; with none chosen, the whole lesson does.
        for (const assetType of row.assets) items.push({ lessonId, assetType, decision: 'CHANGE', note: row.note });
      } else {
        items.push({ lessonId, decision: row.decision, note: row.note });
      }
    }
    try {
      setData(await runsApi.saveImpact(view.run.id, items));
      invalidate();
      toast.push(t('lp.impact.saved'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('apply');
    try {
      setData(await runsApi.applyImpact(view.run.id));
      invalidate();
      toast.push(t('lp.impact.applied'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <GitCompare size={16} aria-hidden="true" />
          {t('lp.impact.title')}
        </span>
      }
      action={
        data?.sourceRelease ? (
          <span className="text-[12.5px] lps-muted">
            {t('lp.impact.source', { label: data.sourceRelease.versionLabel })}
            {data.sourceRelease.kind === 'LEGACY_BASELINE' && <Pill tone="outline" className="ms-2">{t('lp.releaseKind.LEGACY_BASELINE')}</Pill>}
          </span>
        ) : null
      }
      bodyClassName="p-0"
    >
      {error && !data ? (
        <div className="p-4">
          <ErrorNote error={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <LoadingRows rows={3} />
      ) : data?.snapshot ? (
        <>
          <p className="px-4 pt-3 text-[12.5px] lps-muted">{t('lp.impact.lede')}</p>
          <div className="overflow-x-auto">
            <table className="lps-table mt-2 min-w-[720px]">
              <thead>
                <tr>
                  <th>{t('lp.col.lesson')}</th>
                  <th>{t('lp.impact.decision')}</th>
                  <th>{t('lp.impact.assets')}</th>
                  <th>{t('lp.impact.note')}</th>
                </tr>
              </thead>
              <tbody>
                {data.snapshot.lessons.map((lesson) => {
                  const row = rows[lesson.id] ?? { decision: 'KEEP' as ImpactDecision, note: '', assets: [] };
                  const update = (patch: Partial<Row>) => setRows((current) => ({ ...current, [lesson.id]: { ...row, ...patch } }));
                  return (
                    <tr key={lesson.id}>
                      <td className="max-w-[240px]">
                        <span className="lps-bidi block truncate font-medium">{lesson.name}</span>
                        {lesson.moduleName && <span className="text-[11.5px] lps-faint">{lesson.moduleName}</span>}
                      </td>
                      <td>
                        {data.canEdit ? (
                          <select className="lps-input !w-auto !py-1" value={row.decision} onChange={(event) => update({ decision: event.target.value as ImpactDecision, assets: event.target.value === 'CHANGE' ? row.assets : [] })}>
                            {(['KEEP', 'CHANGE', 'REMOVE'] as ImpactDecision[]).map((value) => (
                              <option key={value} value={value}>
                                {t(`lp.impact.${value}` as StringKey)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Pill tone={row.decision === 'CHANGE' ? 'accent' : row.decision === 'REMOVE' ? 'attention' : 'neutral'}>{t(`lp.impact.${row.decision}` as StringKey)}</Pill>
                        )}
                      </td>
                      <td>
                        {row.decision === 'CHANGE' ? (
                          <span className="flex flex-wrap gap-2">
                            {lesson.assets
                              .filter((asset) => asset.applicable)
                              .map((asset) => (
                                <label key={asset.type} className="flex items-center gap-1 text-[12px]">
                                  <input
                                    type="checkbox"
                                    disabled={!data.canEdit}
                                    checked={row.assets.includes(asset.type)}
                                    onChange={(event) => update({ assets: event.target.checked ? [...row.assets, asset.type] : row.assets.filter((type) => type !== asset.type) })}
                                  />
                                  {t(`lp.stage.${asset.type}` as StringKey)}
                                  {asset.versionNumber ? <span className="lps-faint">v{asset.versionNumber}</span> : null}
                                </label>
                              ))}
                          </span>
                        ) : (
                          <span className="text-[12px] lps-faint">{row.decision === 'KEEP' ? t('lp.impact.keepHint') : t('lp.impact.removeHint')}</span>
                        )}
                      </td>
                      <td>
                        {data.canEdit ? (
                          <input className="lps-input !py-1" value={row.note} onChange={(event) => update({ note: event.target.value })} maxLength={1000} />
                        ) : (
                          <span className="lps-bidi text-[12.5px] lps-muted">{row.note}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--lps-line)' }}>
            <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
              {impactTask && (
                <Link to={`/learning-production/courses/${view.course.id}?task=${impactTask.id}`} className="flex items-center gap-2 hover:underline">
                  {t('lp.impact.signoffTask')} <TaskStatusPill display={impactTask.display} />
                </Link>
              )}
              {data.applied && <Pill tone="ok">{t('lp.impact.appliedOn', { day: day(data.items.find((item) => item.appliedAt)?.appliedAt) })}</Pill>}
            </span>
            <span className="flex gap-2">
              {data.canEdit && (
                <button type="button" className="lps-btn" onClick={save} disabled={Boolean(busy)}>
                  {busy === 'save' && <Busy />}
                  {dirty ? t('lp.impact.saveFirst') : t('lp.impact.save')}
                </button>
              )}
              {data.canApply && (
                <button type="button" className="lps-btn-primary" onClick={apply} disabled={Boolean(busy)}>
                  {busy === 'apply' && <Busy />}
                  {t('lp.impact.apply')}
                </button>
              )}
            </span>
          </div>
        </>
      ) : (
        <p className="p-4 text-[13px] lps-muted">{t('lp.impact.noSource')}</p>
      )}
    </Panel>
  );
}
