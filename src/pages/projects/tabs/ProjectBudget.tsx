/**
 * Qodo Projects — budget and earned value.
 *
 * The rule this screen exists to honour: **never show a number nobody measured.**
 *
 * A project with no budget has no variance. A project where nobody has logged
 * time has no actual cost. Both render as "not measured" rather than as zero,
 * because a manager reading "0% over budget" on a project with no budget has
 * been told something false — and will act on it.
 *
 * The earned-value panel goes further: when its inputs are missing it names
 * them instead of computing around the gap. An SPI derived from a guessed
 * budget is worse than no SPI, for the same reason.
 */

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Gauge, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { budgetApi } from '../../../lib/projects/api';
import type { Budget, BudgetState, BudgetType, Consumption, EarnedValue } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Modal, Spinner, useToast } from '../../../components/ui';

const BUDGET_TYPES: BudgetType[] = [
  'project_hours',
  'staff_hours',
  'project_amount',
  'fixed_cost',
  'task_hours',
  'issue_hours',
];

const STATE_TONE: Record<BudgetState, string> = {
  healthy: 'bg-status-okBg text-status-ok',
  at_risk: 'bg-status-warnBg text-accent-700',
  overrun: 'bg-status-badBg text-status-bad',
  surplus: 'bg-status-infoBg text-status-info',
  unset: 'bg-surface-sunken text-ink-muted',
};

export function ProjectBudget() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [consumption, setConsumption] = useState<Consumption | null>(null);
  const [evm, setEvm] = useState<EarnedValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const status = await budgetApi.status(projectId);
      setBudgets(status.budgets);
      setConsumption(status.consumption);

      // Earned value needs `reports.finance`, which is a narrower key than
      // `budget.view`. A refusal here is not an error on this page.
      if (can('reports.finance')) {
        setEvm(await budgetApi.earnedValue(projectId).catch(() => null));
      }
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, lang, can]);

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
        <EmptyState icon={<Banknote size={32} />} title={t('projects.error.load')} body={error} />
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Measure label={t('budget.plannedHours')} value={consumption?.plannedHours ?? null} />
        <Measure label={t('budget.actualHours')} value={consumption?.actualHours ?? null} />
        <Measure label={t('time.billableHours')} value={consumption?.billableHours ?? null} />
        <Measure
          label={t('budget.actualCost')}
          value={consumption?.actualCost ?? null}
          suffix={detail.project.currency}
        />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-ink">{t('budget.title')}</h2>
          {can('budget.manage') && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSetting(true)}>
              <Plus size={15} />
              {t('budget.set')}
            </button>
          )}
        </div>

        {budgets.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Banknote size={32} />}
              title={t('budget.none')}
              body={t('budget.noneHint')}
              action={
                can('budget.manage') ? (
                  <button type="button" className="btn-primary btn-sm" onClick={() => setSetting(true)}>
                    <Plus size={15} />
                    {t('budget.set')}
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="grid gap-2">
            {budgets.map((budget) => (
              <li key={budget.id}>
                <article className="card flex flex-wrap items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13.5px] font-bold text-ink">
                      {t(`budget.type.${budget.type}` as Parameters<typeof t>[0])}
                      {budget.phaseName && (
                        <span className="ms-2 text-[12px] font-normal text-ink-muted">{budget.phaseName}</span>
                      )}
                    </h3>
                    <p className="mt-0.5 text-[12px] tabular-nums text-ink-muted">
                      {budget.consumed === null ? t('budget.notMeasured') : budget.consumed}
                      {' / '}
                      {budget.hours ?? budget.amount}
                      {budget.amount !== null && ` ${budget.currency}`}
                    </p>
                  </div>

                  {/* The bar is never the only signal — §74. The state is a word
                      and the percentage is a number beside it. */}
                  <div className="flex w-40 shrink-0 items-center gap-2">
                    <span
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                      role="progressbar"
                      aria-valuenow={budget.percent ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span
                        className={`block h-full rounded-full ${
                          budget.state === 'overrun'
                            ? 'bg-status-bad'
                            : budget.state === 'at_risk'
                              ? 'bg-status-warn'
                              : 'bg-status-ok'
                        }`}
                        style={{ width: `${Math.min(100, budget.percent ?? 0)}%` }}
                      />
                    </span>
                    <span className="w-11 text-end text-[12px] font-semibold tabular-nums text-ink-muted">
                      {budget.percent === null ? '—' : `${budget.percent}%`}
                    </span>
                  </div>

                  <span className={`chip shrink-0 ${STATE_TONE[budget.state]}`}>
                    {t(`budget.state.${budget.state}` as Parameters<typeof t>[0])}
                  </span>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can('reports.finance') && evm && <EarnedValuePanel evm={evm} />}

      <BudgetDialog
        open={setting}
        projectId={projectId}
        currency={detail.project.currency}
        onClose={() => setSetting(false)}
        onSaved={() => {
          setSetting(false);
          toast.push(t('common.save'), 'ok');
          void load();
        }}
      />
    </section>
  );
}

/**
 * One number, or an honest statement that there is none.
 *
 * `null` renders as "not measured" rather than as 0 — the distinction this
 * whole screen turns on.
 */
function Measure({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  const { t } = useI18n();
  return (
    <article className="card p-3.5">
      <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
      {value === null ? (
        <p className="mt-1 text-[15px] font-semibold text-ink-faint">{t('budget.notMeasured')}</p>
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
          {value.toLocaleString()}
          {suffix && <span className="ms-1 text-[13px] font-semibold text-ink-muted">{suffix}</span>}
        </p>
      )}
    </article>
  );
}

function EarnedValuePanel({ evm }: { evm: EarnedValue }) {
  const { t } = useI18n();

  if (!evm.available) {
    return (
      <section className="card p-4">
        <h2 className="mb-1.5 flex items-center gap-2 text-sm font-bold text-ink">
          <Gauge size={16} className="text-ink-muted" />
          {t('evm.title')}
        </h2>
        <p className="text-[13px] font-semibold text-ink">{t('evm.unavailable')}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          {t('evm.unavailableHint', {
            missing: evm.missing
              .map((key) => t(`evm.missing.${key}` as Parameters<typeof t>[0]))
              .join('، '),
          })}
        </p>
      </section>
    );
  }

  const behind = evm.schedulePerformanceIndex !== null && evm.schedulePerformanceIndex < 1;
  const overCost = evm.costPerformanceIndex !== null && evm.costPerformanceIndex < 1;

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
        <Gauge size={16} className="text-ink-muted" />
        {t('evm.title')}
        <span className={`chip ${behind ? 'bg-status-badBg text-status-bad' : 'bg-status-okBg text-status-ok'}`}>
          {behind ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
          {behind ? t('evm.behind') : t('evm.ahead')}
        </span>
        <span className={`chip ${overCost ? 'bg-status-badBg text-status-bad' : 'bg-status-okBg text-status-ok'}`}>
          {overCost ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
          {overCost ? t('evm.overCost') : t('evm.underCost')}
        </span>
      </h2>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        <Figure label={t('evm.bac')} value={evm.budgetAtCompletion} currency={evm.currency} />
        <Figure label={t('evm.pv')} value={evm.plannedValue} currency={evm.currency} />
        <Figure label={t('evm.ev')} value={evm.earnedValue} currency={evm.currency} />
        <Figure label={t('evm.ac')} value={evm.actualCost} currency={evm.currency} />
        <Figure label={t('evm.sv')} value={evm.scheduleVariance} currency={evm.currency} signed />
        <Figure label={t('evm.cv')} value={evm.costVariance} currency={evm.currency} signed />
        <Figure label={t('evm.spi')} value={evm.schedulePerformanceIndex} />
        <Figure label={t('evm.cpi')} value={evm.costPerformanceIndex} />
        <Figure label={t('evm.eac')} value={evm.estimateAtCompletion} currency={evm.currency} />
        <Figure label={t('evm.etc')} value={evm.estimateToComplete} currency={evm.currency} />
      </dl>

      <p className="mt-3 border-t border-surface-line pt-2 text-[11.5px] leading-relaxed text-ink-faint">
        {t('evm.basis')}
      </p>
    </section>
  );
}

function Figure({
  label,
  value,
  currency,
  signed,
}: {
  label: string;
  value: number | null;
  currency?: string;
  signed?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-surface-line/60 pb-1.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd
        className={`text-[13.5px] font-bold tabular-nums ${
          signed && value !== null ? (value < 0 ? 'text-status-bad' : 'text-status-ok') : 'text-ink'
        }`}
      >
        {value === null ? (
          <span className="font-normal text-ink-faint">{t('budget.notMeasured')}</span>
        ) : (
          <>
            {signed && value > 0 ? '+' : ''}
            {value.toLocaleString()}
            {currency && <span className="ms-1 text-[11px] font-semibold text-ink-muted">{currency}</span>}
          </>
        )}
      </dd>
    </div>
  );
}

function BudgetDialog({
  open,
  projectId,
  currency,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [type, setType] = useState<BudgetType>('project_amount');
  const [value, setValue] = useState('');
  const [threshold, setThreshold] = useState('80');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setType('project_amount');
    setValue('');
    setThreshold('80');
    setError(null);
  }, [open]);

  const isHours = type.endsWith('_hours');
  const numeric = Number(value);
  const valid = Number.isFinite(numeric) && numeric > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await budgetApi.set(projectId, {
        type,
        amount: isHours ? null : numeric,
        hours: isHours ? numeric : null,
        thresholdPercent: Number(threshold) || 80,
      });
      onSaved();
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
      title={t('budget.set')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="budget-set" className="btn-primary btn-sm" disabled={!valid || saving}>
            {saving && <Spinner size={15} />}
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="budget-set" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <Field label={t('budget.title')} required>
          <select className="field" value={type} onChange={(e) => setType(e.target.value as BudgetType)}>
            {BUDGET_TYPES.map((option) => (
              <option key={option} value={option}>
                {t(`budget.type.${option}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isHours ? t('time.hours') : `${t('budget.title')} (${currency})`} required>
            <input
              type="number"
              min={1}
              step={isHours ? '0.5' : '1'}
              className="field"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={t('budget.threshold')}>
            <input
              type="number"
              min={1}
              max={200}
              className="field"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
