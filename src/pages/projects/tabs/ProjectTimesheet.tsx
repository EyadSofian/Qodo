/**
 * Qodo Projects — the week.
 *
 * A timesheet is a claim, not a log: the entries are facts, and submitting the
 * week is the moment somebody asserts them and somebody else has to answer. So
 * this screen is built around the week rather than around individual rows, and
 * the submit button is the only thing on it that changes anybody else's day.
 *
 * Approved rows are read-only and say so. The approval was a decision about
 * those exact numbers, and letting them be edited afterwards would make the
 * decision describe something that no longer exists.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Plus, RotateCcw, Send, XCircle } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { projectTasksApi, timeApi } from '../../../lib/projects/api';
import type { ProjectTask, TimeEntry, Timesheet } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Field, Modal, Spinner, useToast } from '../../../components/ui';

/** The Sunday that starts the week containing `date`. Mirrors the server. */
function weekStart(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return parsed.toISOString().slice(0, 10);
}

function shiftWeek(start: string, weeks: number): string {
  const parsed = new Date(`${start}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + weeks * 7);
  return parsed.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<Timesheet['status'], string> = {
  draft: 'bg-surface-sunken text-ink-muted',
  submitted: 'bg-status-infoBg text-status-info',
  approved: 'bg-status-okBg text-status-ok',
  rejected: 'bg-status-badBg text-status-bad',
};

export function ProjectTimesheet() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [week, setWeek] = useState(() => weekStart(new Date().toISOString().slice(0, 10)));
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [totals, setTotals] = useState({ totalHours: 0, billableHours: 0 });
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [pending, setPending] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [reviewing, setReviewing] = useState<Timesheet | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sheetResult, taskResult] = await Promise.all([
        timeApi.timesheet(projectId, week),
        projectTasksApi.list(projectId, { limit: 200 }),
      ]);
      setSheet(sheetResult.timesheet);
      setEntries(sheetResult.entries);
      setTotals({ totalHours: sheetResult.totalHours, billableHours: sheetResult.billableHours });
      setTasks(taskResult.tasks);

      if (can('timesheet.approve')) {
        const { timesheets } = await timeApi.pendingTimesheets(projectId);
        setPending(timesheets);
      }
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, week, lang, can]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>, successKey?: Parameters<typeof t>[0]) => {
    try {
      await action();
      if (successKey) toast.push(t(successKey), 'ok');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const taskName = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task.title]));
    return (id: string | null) => (id ? byId.get(id) ?? id : '—');
  }, [tasks]);

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  const locked = sheet?.status === 'approved' || Boolean(sheet?.lockedAt);

  return (
    <section className="grid gap-3">
      {/* Week picker and the sheet's own state. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-surface-line bg-white p-1">
          <button
            type="button"
            className="btn-quiet !min-h-8 rounded-lg px-2.5 text-[13px]"
            onClick={() => setWeek((current) => shiftWeek(current, -1))}
          >
            ‹
          </button>
          <span className="px-2 text-[12.5px] font-semibold tabular-nums text-ink">
            {sheet?.periodStart} → {sheet?.periodEnd}
          </span>
          <button
            type="button"
            className="btn-quiet !min-h-8 rounded-lg px-2.5 text-[13px]"
            onClick={() => setWeek((current) => shiftWeek(current, 1))}
          >
            ›
          </button>
        </div>

        {sheet && (
          <span className={`chip ${STATUS_TONE[sheet.status]}`}>
            {t(`time.${sheet.status}` as Parameters<typeof t>[0])}
          </span>
        )}

        <span className="chip bg-surface-sunken text-ink-muted">
          {t('time.totalHours')}: <strong className="tabular-nums">{totals.totalHours}</strong>
        </span>
        {totals.billableHours > 0 && (
          <span className="chip bg-status-okBg text-status-ok">
            {t('time.billableHours')}: <strong className="tabular-nums">{totals.billableHours}</strong>
          </span>
        )}

        <div className="flex flex-1 justify-end gap-2">
          {can('time.log') && !locked && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setLogging(true)}>
              <Plus size={15} />
              {t('time.log')}
            </button>
          )}
          {can('timesheet.submit') && sheet?.status === 'draft' && entries.length > 0 && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void act(() => timeApi.submitTimesheet(projectId, week), 'time.submitted')}
            >
              <Send size={15} />
              {t('time.submit')}
            </button>
          )}
          {can('timesheet.submit') && sheet?.status === 'submitted' && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => void act(() => timeApi.recallTimesheet(projectId, sheet.id))}
            >
              <RotateCcw size={15} />
              {t('time.recall')}
            </button>
          )}
        </div>
      </div>

      {sheet?.status === 'rejected' && sheet.rejectionReason && (
        <p role="alert" className="card border-status-bad/30 bg-status-badBg/40 px-4 py-3 text-[13px] text-status-bad">
          <strong>{t('time.rejected')}:</strong> {sheet.rejectionReason}
        </p>
      )}

      {locked && (
        <p className="card bg-surface-sunken/50 px-4 py-2.5 text-[12.5px] text-ink-muted">
          {t('time.approvedLocked')}
        </p>
      )}

      {error ? (
        <div className="card">
          <EmptyState icon={<Clock size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Clock size={32} />}
            title={t('time.empty')}
            body={t('time.emptyHint')}
            action={
              can('time.log') ? (
                <button type="button" className="btn-primary btn-sm" onClick={() => setLogging(true)}>
                  <Plus size={15} />
                  {t('time.log')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-start text-sm">
            <thead>
              <tr className="border-b border-surface-line text-[11.5px] uppercase tracking-wide text-ink-faint">
                <th scope="col" className="px-3 py-2.5 text-start font-semibold">{t('time.date')}</th>
                <th scope="col" className="px-3 py-2.5 text-start font-semibold">{t('time.task')}</th>
                <th scope="col" className="px-3 py-2.5 text-start font-semibold">{t('time.notes')}</th>
                <th scope="col" className="px-3 py-2.5 text-end font-semibold">{t('time.hours')}</th>
                <th scope="col" className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-surface-line last:border-0">
                  <td className="px-3 py-2.5 tabular-nums text-ink-muted">{entry.logDate}</td>
                  <td className="px-3 py-2.5 text-ink">{taskName(entry.taskId)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {entry.notes || '—'}
                    {entry.isBillable && (
                      <span className="ms-2 chip bg-status-okBg text-[10.5px] text-status-ok">
                        {t('time.billable')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-end font-semibold tabular-nums text-ink">{entry.hours}</td>
                  <td className="px-3 py-2.5">
                    {can('time.log') && entry.approvalStatus !== 'approved' && !entry.invoicedAt && (
                      <button
                        type="button"
                        aria-label={`${t('common.delete')} — ${entry.logDate}`}
                        className="btn-quiet !min-h-7 rounded-md p-1 text-status-bad"
                        onClick={() => void act(() => timeApi.deleteEntry(projectId, entry.id))}
                      >
                        <XCircle size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* An approver's queue, shown only to somebody who is one. */}
      {can('timesheet.approve') && pending.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
            <CheckCircle2 size={16} className="text-ink-muted" />
            {t('time.pending')}
            <span className="chip bg-surface-sunken text-ink-muted">{pending.length}</span>
          </h2>
          <ul className="divide-y divide-surface-line">
            {pending.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="flex-1 text-[13px] text-ink">
                  {row.userId} · {row.periodStart} → {row.periodEnd}
                </span>
                <span className="chip bg-surface-sunken tabular-nums text-ink-muted">
                  {row.hours ?? 0} {t('time.hours')}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    void act(() => timeApi.reviewTimesheet(projectId, row.id, 'approved'))
                  }
                >
                  {t('time.approve')}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setReviewing(row)}>
                  {t('time.reject')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LogTimeDialog
        open={logging}
        projectId={projectId}
        tasks={tasks}
        defaultDate={sheet?.periodStart}
        onClose={() => setLogging(false)}
        onLogged={() => {
          setLogging(false);
          void load();
        }}
      />

      <RejectDialog
        sheet={reviewing}
        projectId={projectId}
        onClose={() => setReviewing(null)}
        onRejected={() => {
          setReviewing(null);
          void load();
        }}
      />
    </section>
  );
}

function LogTimeDialog({
  open,
  projectId,
  tasks,
  defaultDate,
  onClose,
  onLogged,
}: {
  open: boolean;
  projectId: string;
  tasks: ProjectTask[];
  defaultDate?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { t, lang } = useI18n();
  const [taskId, setTaskId] = useState('');
  const [hours, setHours] = useState('');
  const [logDate, setLogDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [isBillable, setIsBillable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLogDate(defaultDate ?? new Date().toISOString().slice(0, 10));
      return;
    }
    setTaskId('');
    setHours('');
    setNotes('');
    setIsBillable(false);
    setError(null);
  }, [open, defaultDate]);

  const numeric = Number(hours);
  const valid = Number.isFinite(numeric) && numeric > 0 && numeric <= 24;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await timeApi.log(projectId, {
        taskId: taskId || undefined,
        hours: numeric,
        logDate,
        notes: notes.trim(),
        isBillable,
      });
      onLogged();
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
      title={t('time.log')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="time-log" className="btn-primary btn-sm" disabled={!valid || saving}>
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="time-log" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <Field label={t('time.task')}>
          <select className="field" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">—</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('time.date')} required>
            <input type="date" className="field" value={logDate} onChange={(e) => setLogDate(e.target.value)} required />
          </Field>
          <Field
            label={t('time.hours')}
            required
            error={hours && !valid ? t('time.hours') : undefined}
          >
            <input
              type="number"
              min={0.25}
              max={24}
              step="0.25"
              className="field"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label={t('time.notes')}>
          <textarea
            className="field min-h-[64px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </Field>

        <label className="flex items-center gap-2.5 text-[13px] font-semibold text-ink">
          <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
          {t('time.billable')}
        </label>
      </form>
    </Modal>
  );
}

/**
 * Rejecting a week.
 *
 * Its own dialog because the reason is required, and a prompt that can be
 * dismissed with an empty string would just produce a server error the reviewer
 * has to decode.
 */
function RejectDialog({
  sheet,
  projectId,
  onClose,
  onRejected,
}: {
  sheet: Timesheet | null;
  projectId: string;
  onClose: () => void;
  onRejected: () => void;
}) {
  const { t, lang } = useI18n();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sheet) {
      setReason('');
      setError(null);
    }
  }, [sheet]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sheet || !reason.trim() || saving) return;
    setSaving(true);
    try {
      await timeApi.reviewTimesheet(projectId, sheet.id, 'rejected', reason.trim());
      onRejected();
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={sheet !== null}
      onClose={onClose}
      title={t('time.reject')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="time-reject" className="btn-danger btn-sm" disabled={!reason.trim() || saving}>
            {saving && <Spinner size={15} />}
            {t('time.reject')}
          </button>
        </>
      }
    >
      <form id="time-reject" onSubmit={submit} className="grid gap-3">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
        <Field label={t('time.rejectReason')} hint={t('time.rejectReasonHint')} required>
          <textarea
            className="field min-h-[90px] resize-y"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            required
            maxLength={1000}
          />
        </Field>
      </form>
    </Modal>
  );
}
