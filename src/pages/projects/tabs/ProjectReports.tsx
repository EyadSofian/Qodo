/**
 * Qodo Projects — the report builder.
 *
 * Three dropdowns and a chart: module, grouping, measure. The options come from
 * the server rather than being listed here, which is what keeps the builder
 * from offering a combination the engine would refuse — including money
 * measures, which are simply absent for anybody without `rate.view` rather than
 * present and rejected.
 *
 * The chart is drawn rather than imported. A horizontal bar chart of at most
 * twenty buckets is ninety lines of SVG, and a charting library is a hundred
 * kilobytes and its own opinion about colour.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Play, Save } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { reportsApi } from '../../../lib/projects/api';
import type { ReportResult } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Spinner, useToast } from '../../../components/ui';

const MODULES = ['task', 'issue', 'time_log'] as const;

export function ProjectReports() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [moduleKey, setModuleKey] = useState<(typeof MODULES)[number]>('task');
  const [groupings, setGroupings] = useState<string[]>([]);
  const [measures, setMeasures] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [measure, setMeasure] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The options are the server's, not this file's — so the builder can never
  // offer a combination the engine refuses.
  useEffect(() => {
    let alive = true;
    reportsApi
      .fields(moduleKey, projectId)
      .then(({ groupings: g, measures: m }) => {
        if (!alive) return;
        setGroupings(g);
        setMeasures(m);
        setGroupBy((current) => (g.includes(current) ? current : g[0] ?? ''));
        setMeasure((current) => (m.includes(current) ? current : m[0] ?? ''));
      })
      .catch(() => {
        if (alive) {
          setGroupings([]);
          setMeasures([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [moduleKey, projectId]);

  const run = useCallback(async () => {
    if (!groupBy || !measure) return;
    setLoading(true);
    setError(null);
    try {
      // The language goes with the request: a report grouped by status has to
      // come back labelled in the language the reader is reading, and only the
      // browser knows which that is.
      setResult(await reportsApi.run({ module: moduleKey, groupBy, measure, lang }, projectId));
    } catch (caught) {
      setError(errorMessage(caught, lang));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [moduleKey, groupBy, measure, projectId, lang]);

  useEffect(() => {
    if (groupBy && measure) void run();
  }, [groupBy, measure, run]);

  const save = async () => {
    try {
      await reportsApi.save({
        name: `${t(`reports.module.${moduleKey}` as Parameters<typeof t>[0])} · ${label('group', groupBy)}`,
        module: moduleKey,
        definition: { module: moduleKey, groupBy, measure },
      });
      toast.push(t('common.save'), 'ok');
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  /**
   * A translated label, falling back to the raw key.
   *
   * The server owns the vocabulary, so a grouping added there before a string
   * is added here renders as its key — visibly untranslated, which is how a
   * missing string gets noticed rather than rendering as blank.
   */
  const label = (kind: 'group' | 'measure', key: string) => {
    const translated = t(`reports.${kind}.${key}` as Parameters<typeof t>[0]);
    return translated === `reports.${kind}.${key}` ? key : translated;
  };

  const max = useMemo(
    () => Math.max(1, ...(result?.rows ?? []).map((row) => row.value)),
    [result]
  );

  return (
    <section className="grid gap-3">
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Field label={t('reports.module')}>
          <select
            className="field"
            value={moduleKey}
            onChange={(event) => setModuleKey(event.target.value as (typeof MODULES)[number])}
          >
            {MODULES.map((option) => (
              <option key={option} value={option}>
                {t(`reports.module.${option}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('reports.groupBy')}>
          <select className="field" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
            {groupings.map((option) => (
              <option key={option} value={option}>
                {label('group', option)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('reports.measure')}>
          <select className="field" value={measure} onChange={(event) => setMeasure(event.target.value)}>
            {measures.map((option) => (
              <option key={option} value={option}>
                {label('measure', option)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => void run()} disabled={loading}>
          {loading ? <Spinner size={15} /> : <Play size={15} />}
          {t('reports.run')}
        </button>
        {can('reports.manage') && result && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => void save()}>
            <Save size={15} />
            {t('reports.save')}
          </button>
        )}
        {result && (
          <span className="chip bg-surface-sunken text-ink-muted">
            {t('reports.total')}: <strong className="tabular-nums">{result.total.toLocaleString()}</strong>
          </span>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<BarChart3 size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : loading && !result ? (
        <div className="card grid place-items-center py-16">
          <Spinner size={22} className="text-brand-500" />
        </div>
      ) : !result || result.rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<BarChart3 size={32} />} title={t('reports.empty')} body={t('reports.emptyHint')} />
        </div>
      ) : (
        <div className="card p-4">
          {/* A list of bars rather than an SVG chart: it reflows, it reads in
              both directions without a transform, and a screen reader gets the
              numbers rather than a picture of them. */}
          <ol className="grid gap-2">
            {result.rows.map((row) => (
              <li key={row.bucket} className="grid grid-cols-[minmax(90px,160px)_1fr_auto] items-center gap-3">
                <span className="truncate text-[12.5px] font-semibold text-ink" title={row.bucket}>
                  {row.bucket}
                </span>
                <span className="h-4 overflow-hidden rounded bg-surface-sunken">
                  <span
                    className="block h-full rounded bg-brand-500 transition-[width]"
                    style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                  />
                </span>
                <span className="w-16 text-end text-[12.5px] font-bold tabular-nums text-ink">
                  {row.value.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
