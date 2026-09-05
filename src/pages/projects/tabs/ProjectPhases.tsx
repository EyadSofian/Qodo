/**
 * Qodo Projects — the phases of one project.
 *
 * A phase is the largest piece of a project and the one most likely to be shown
 * to a customer, so its visibility switch is not tucked into a settings panel —
 * it is on the create form, worded as what it grants, with the consequence
 * spelled out. Getting that wrong is a data leak, and a checkbox labelled
 * "internal" with no explanation is how it happens.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Layers, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { phasesApi } from '../../../lib/projects/api';
import type { Phase } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Modal, Spinner, useToast } from '../../../components/ui';

export function ProjectPhases() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { phases: loaded } = await phasesApi.list(projectId);
      setPhases(loaded);
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

  const remove = async (phase: Phase) => {
    try {
      await phasesApi.remove(projectId, phase.id);
      await load();
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

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-ink">{t('phases.title')}</h2>
        {can('phase.create') && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={15} />
            {t('phases.new')}
          </button>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<Layers size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : phases.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Layers size={32} />}
            title={t('phases.empty')}
            body={t('phases.emptyHint')}
            action={
              can('phase.create') ? (
                <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
                  <Plus size={15} />
                  {t('phases.new')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol className="grid gap-2">
          {phases.map((phase) => (
            <li key={phase.id}>
              <article className="card group flex flex-wrap items-center gap-3 p-3.5">
                <span
                  aria-hidden="true"
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: phase.color }}
                />

                <div className="min-w-0 flex-1">
                  <h3 className="flex flex-wrap items-center gap-2 truncate text-sm font-bold text-ink">
                    {phase.name}
                    {/* Visibility is stated on every row, not only in the form.
                        Somebody scanning a list needs to know which of these a
                        customer can read without opening each one. */}
                    <span
                      className={`chip ${
                        phase.isExternal
                          ? 'bg-status-infoBg text-status-info'
                          : 'bg-surface-sunken text-ink-muted'
                      }`}
                    >
                      {phase.isExternal ? <Eye size={11} /> : <EyeOff size={11} />}
                      {phase.isExternal ? t('phases.visibility.external') : t('phases.visibility.internal')}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {t('phases.progress', { done: phase.doneCount, total: phase.taskCount })}
                    {(phase.startDate || phase.endDate) &&
                      ` · ${phase.startDate ?? '—'} → ${phase.endDate ?? '—'}`}
                  </p>
                </div>

                <ProgressBar value={phase.progress} />

                {can('phase.delete') && (
                  <button
                    type="button"
                    onClick={() => void remove(phase)}
                    aria-label={`${t('common.delete')} — ${phase.name}`}
                    className="btn-danger !min-h-8 rounded-lg px-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}

      <PhaseDialog
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

/**
 * A percentage that is also readable without colour.
 *
 * §74 forbids status by colour alone, so the number is always beside the bar
 * rather than being its tooltip.
 */
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex w-32 shrink-0 items-center gap-2">
      <span
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="block h-full rounded-full bg-brand-500 transition-[width]"
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="w-8 text-end text-[12px] font-semibold tabular-nums text-ink-muted">
        {value}%
      </span>
    </div>
  );
}

function PhaseDialog({
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
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExternal, setIsExternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setName('');
    setStartDate('');
    setEndDate('');
    setIsExternal(false);
    setError(null);
  }, [open]);

  const datesInverted = Boolean(startDate && endDate && endDate < startDate);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || datesInverted || saving) return;
    setSaving(true);
    setError(null);
    try {
      await phasesApi.create(projectId, {
        name: name.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
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
      title={t('phases.new')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="phase-create"
            className="btn-primary btn-sm"
            disabled={!name.trim() || datesInverted || saving}
          >
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="phase-create" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <Field label={t('phases.field.name')} required>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={160} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('projects.field.startDate')}>
            <input type="date" className="field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field
            label={t('projects.field.endDate')}
            error={datesInverted ? t('projects.error.endBeforeStart') : undefined}
          >
            <input
              type="date"
              className="field"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="label">{t('phases.field.visibility')}</legend>
          {([false, true] as const).map((option) => (
            <label
              key={String(option)}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                isExternal === option ? 'border-brand-400 bg-brand-50' : 'border-surface-line hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                name="phase-visibility"
                className="mt-1"
                checked={isExternal === option}
                onChange={() => setIsExternal(option)}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-ink">
                  {option ? t('phases.visibility.external') : t('phases.visibility.internal')}
                </span>
                <span className="block text-[12px] leading-relaxed text-ink-muted">
                  {option ? t('phases.visibility.externalHint') : t('phases.visibility.internalHint')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}
