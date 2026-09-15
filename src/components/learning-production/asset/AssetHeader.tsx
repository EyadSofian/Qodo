/**
 * The top of an asset: what it is, where it stands, who owns it, and the one
 * thing to do next. The primary button changes with the state — approved work
 * never still says "Submit", and a maker whose work is with the reviewer sees
 * "Waiting for review" rather than a button that would be refused.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Check, Lock, MoreHorizontal, Pencil, Play, RotateCcw, Send, Unlock, Upload, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp } from '../../../lib/learningProduction/api';
import { assetRoute, lpErrorKey, priorityKey, stageKey, statusKey } from '../../../lib/learningProduction/format';
import { dueState, todayIn } from '@shared/learningProduction/workflow';
import { isTextAsset } from '@shared/learningProduction/constants';
import type { AssetAction, AssetDetail, Priority } from '../../../lib/learningProduction/types';
import { Modal, Spinner, useToast } from '../../ui';
import { Chip, CommentCount, ConfirmDialog, DueChip, PersonChip, PersonSelect, PriorityChip, StageLabel, StatusBadge, usePeople } from '../kit';
import { useAsset } from './AssetContext';

const SLUG: Partial<Record<AssetAction, string>> = {
  START: 'start',
  START_REVISION: 'start-revision',
  SUBMIT: 'submit',
  START_REVIEW: 'start-review',
  REQUEST_CHANGES: 'request-changes',
  APPROVE: 'approve',
  LOCK: 'lock',
  REOPEN: 'reopen',
  OVERRIDE_DEPENDENCY: 'override-dependency',
};

type Dialog = 'submit' | 'approve' | 'changes' | 'reopen' | 'override' | 'lock' | 'revision' | 'assign' | null;

export function AssetHeader() {
  const { t } = useI18n();
  const toast = useToast();
  const { assetId, detail, refresh, flushDraft, setUploadOpen } = useAsset();
  const { asset, evaluation, primary, people } = detail;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lockOnApprove, setLockOnApprove] = useState(false);
  const allowed = (action: AssetAction) => evaluation.actions[action]?.allowed;
  const text = isTextAsset(asset.assetType);
  const due = dueState(asset.dueDate, asset.status, todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const version = detail.currentVersion;

  const run = async (action: AssetAction, body: Record<string, unknown> = {}, toastKey?: string) => {
    setBusy(true);
    try {
      if (action === 'SUBMIT' && text) await flushDraft();
      const next = await lp.action(assetId, SLUG[action]!, body);
      refresh(next);
      if (toastKey) toast.push(t(toastKey as never));
      setDialog(null);
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const latestDecision = detail.approvals.find((approval) => approval.decision !== 'PENDING');
  const secondary = useMemo(
    () =>
      [
        allowed('START_REVISION') && { key: 'revision', label: text ? t('lp.action.newRevision') : t('lp.action.newRevisionFile'), icon: Pencil },
        allowed('LOCK') && primary.action !== 'LOCK' && { key: 'lock', label: t('lp.action.lock'), icon: Lock },
        allowed('REOPEN') && { key: 'reopen', label: t('lp.action.reopen'), icon: Unlock },
      ].filter(Boolean) as Array<{ key: Dialog; label: string; icon: typeof Lock }>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail]
  );

  return (
    <header className="mb-4 rounded-2xl border border-surface-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
            <StageLabel type={asset.assetType} />
            <StatusBadge status={asset.status} blocked={evaluation.blocked} />
            {version && <span className="text-[13px] font-semibold text-ink-faint">v{version.versionNumber}</span>}
            <CommentCount count={detail.openComments} />
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              {t('lp.assignee')}: <PersonChip userId={asset.assigneeUserId} people={people} size={20} />
            </span>
            <span className="flex items-center gap-1.5">
              {t('lp.reviewer')}: <PersonChip userId={asset.reviewerUserId} people={people} size={20} empty="—" />
            </span>
            <span className="flex items-center gap-1.5">
              {t('lp.dueDate')}: <DueChip dueDate={asset.dueDate} dueState={due} />
            </span>
            <PriorityChip priority={asset.priority} />
            {allowed('ASSIGN') && (
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline" onClick={() => setDialog('assign')}>
                <Pencil size={12} />
                {t('lp.action.editAssignment')}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton detail={detail} busy={busy} onAction={(action) => {
            if (action === 'START') void run('START', {}, 'lp.toast.started');
            else if (action === 'SUBMIT') setDialog('submit');
            else if (action === 'UPLOAD_VERSION') setUploadOpen(true);
            else if (action === 'LOCK') setDialog('lock');
            else if (action === 'OVERRIDE_DEPENDENCY') setDialog('override');
            else if (action === 'START_REVIEW') void run('START_REVIEW');
          }} onReview={(decision) => setDialog(decision)} />
          {secondary.length > 0 && (
            <div className="relative">
              <button type="button" className="btn-ghost btn-sm !px-2" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={t('lp.action.more')}>
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className="absolute end-0 top-[calc(100%+6px)] z-30 w-56 rounded-xl border border-surface-line bg-white p-1 shadow-panel" onMouseLeave={() => setMenuOpen(false)}>
                  {secondary.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-[13px] font-semibold text-ink hover:bg-surface-sunken"
                      onClick={() => {
                        setMenuOpen(false);
                        setDialog(key);
                      }}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {evaluation.blocked && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-[13px] text-ink">
          <Ban size={15} className="text-ink-muted" aria-hidden="true" />
          <span className="font-semibold">{t('lp.blocked')}</span>
          <span className="text-ink-muted">{t('lp.waitingFor')}:</span>
          {evaluation.waitingFor.map((entry) => (
            <Link key={entry.assetType} to={assetRoute(detail.course.id, detail.lesson.id, entry.assetType)} className="font-semibold text-brand-600 hover:underline">
              {t('lp.approvalOf', { stage: t(stageKey(entry.assetType)) })} ({t(statusKey(entry.status))})
            </Link>
          ))}
        </div>
      )}
      {asset.dependencyOverrideAt && (
        <p className="mt-3 text-[12.5px] text-ink-muted">
          {t('lp.overrideNote', { name: people[asset.dependencyOverrideBy ?? '']?.name ?? '' })} “{asset.dependencyOverrideReason}”
        </p>
      )}
      {asset.status === 'CHANGES_REQUESTED' && latestDecision?.decision === 'CHANGES_REQUESTED' && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-status-warnBg px-3 py-2.5 text-[13px] text-ink">
          <p className="flex items-center gap-2 font-semibold text-accent-700">
            <RotateCcw size={14} aria-hidden="true" />
            {t('lp.changesBanner', { n: detail.openComments, name: people[latestDecision.reviewedBy ?? '']?.name ?? '' })}
          </p>
          {latestDecision.notes && <p className="mt-1 whitespace-pre-line text-ink-muted">{latestDecision.notes}</p>}
        </div>
      )}
      {asset.status === 'LOCKED' && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-status-okBg px-3 py-2 text-[13px] text-green-800">
          <Lock size={14} aria-hidden="true" />
          {t('lp.lockedBanner')}
        </p>
      )}

      <ConfirmDialog
        open={dialog === 'submit'}
        title={asset.status === 'CHANGES_REQUESTED' ? t('lp.dialog.resubmitTitle') : t('lp.dialog.submitTitle')}
        body={
          <>
            {t('lp.dialog.submitBody', { name: people[asset.reviewerUserId ?? '']?.name ?? t('lp.dialog.theReviewer') })}
            {detail.openComments > 0 && (
              <p className="mt-2 flex items-center gap-1.5 font-semibold text-accent-700">
                <AlertTriangle size={14} />
                {t('lp.dialog.openCommentsWarning', { n: detail.openComments })}
              </p>
            )}
          </>
        }
        field={text ? { label: t('lp.upload.notes'), placeholder: t('lp.upload.notesPlaceholder') } : undefined}
        confirmLabel={t('lp.action.submit')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(notes) => void run('SUBMIT', { notes }, asset.status === 'CHANGES_REQUESTED' ? 'lp.toast.resubmitted' : 'lp.toast.submitted')}
      />
      <ConfirmDialog
        open={dialog === 'changes'}
        title={t('lp.dialog.changesTitle')}
        body={detail.openComments > 0 ? t('lp.dialog.changesBodyWithComments', { n: detail.openComments }) : t('lp.dialog.changesBody')}
        field={{ label: t('lp.dialog.summary'), placeholder: t('lp.dialog.summaryPlaceholder'), required: detail.openComments === 0 }}
        confirmLabel={t('lp.action.requestChanges')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(summary) => void run('REQUEST_CHANGES', { summary }, 'lp.toast.changesRequested')}
      />
      <ConfirmDialog
        open={dialog === 'approve'}
        title={t('lp.dialog.approveTitle', { version: version ? `v${version.versionNumber}` : '' })}
        body={
          <>
            {t('lp.dialog.approveBody')}
            {detail.openComments > 0 && <p className="mt-2 font-semibold text-accent-700">{t('lp.dialog.openCommentsWarning', { n: detail.openComments })}</p>}
          </>
        }
        field={{ label: t('lp.dialog.approveNotes') }}
        extra={
          allowed('APPROVE') && detail.asset.assetType ? (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={lockOnApprove} onChange={(event) => setLockOnApprove(event.target.checked)} />
              {t('lp.dialog.lockToo')}
            </label>
          ) : null
        }
        confirmLabel={t('lp.action.approveVersion')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(notes) => void run('APPROVE', { notes, lock: lockOnApprove }, 'lp.toast.approved')}
      />
      <ConfirmDialog
        open={dialog === 'lock'}
        title={t('lp.dialog.lockTitle')}
        body={t('lp.dialog.lockBody')}
        confirmLabel={t('lp.action.lock')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => void run('LOCK', {}, 'lp.toast.locked')}
      />
      <ConfirmDialog
        open={dialog === 'reopen'}
        title={t('lp.dialog.reopenTitle')}
        body={t('lp.dialog.reopenBody')}
        field={{ label: t('lp.dialog.reason'), required: true }}
        confirmLabel={t('lp.action.reopen')}
        tone="danger"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void run('REOPEN', { reason }, 'lp.toast.reopened')}
      />
      <ConfirmDialog
        open={dialog === 'override'}
        title={t('lp.dialog.overrideTitle')}
        body={t('lp.dialog.overrideBody', { stages: evaluation.waitingFor.map((entry) => t(stageKey(entry.assetType))).join('، ') })}
        field={{ label: t('lp.dialog.reason'), required: true }}
        confirmLabel={t('lp.action.override')}
        tone="danger"
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void run('OVERRIDE_DEPENDENCY', { reason }, 'lp.toast.overridden')}
      />
      <ConfirmDialog
        open={dialog === 'revision'}
        title={t('lp.dialog.revisionTitle')}
        body={t('lp.dialog.revisionBody', { version: version ? `v${version.versionNumber}` : '' })}
        confirmLabel={text ? t('lp.action.newRevision') : t('lp.action.newRevisionFile')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (text) void run('START_REVISION', {}, 'lp.toast.started');
          else {
            setDialog(null);
            setUploadOpen(true);
          }
        }}
      />
      {dialog === 'assign' && <AssignDialog detail={detail} onClose={() => setDialog(null)} />}
    </header>
  );
}

function PrimaryButton({
  detail,
  busy,
  onAction,
  onReview,
}: {
  detail: AssetDetail;
  busy: boolean;
  onAction: (action: AssetAction) => void;
  onReview: (decision: 'approve' | 'changes') => void;
}) {
  const { t } = useI18n();
  const { primary, evaluation } = detail;

  if (primary.kind === 'review') {
    return (
      <>
        {evaluation.actions.REQUEST_CHANGES.allowed && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onReview('changes')} disabled={busy}>
            <RotateCcw size={14} />
            {t('lp.action.requestChanges')}
          </button>
        )}
        {evaluation.actions.APPROVE.allowed && (
          <button type="button" className="btn-sm btn bg-status-ok text-white hover:bg-green-700" onClick={() => onReview('approve')} disabled={busy}>
            <Check size={14} />
            {t('lp.action.approve')}
          </button>
        )}
      </>
    );
  }
  if (primary.kind === 'waiting') {
    return (
      <Chip tone="review" className="!py-1.5 !text-[12.5px]">
        <Send size={13} />
        {t('lp.waitingForReview')}
      </Chip>
    );
  }
  if (primary.kind === 'done') {
    return primary.action === 'LOCK' ? (
      <button type="button" className="btn-ghost btn-sm" onClick={() => onAction('LOCK')} disabled={busy}>
        <Lock size={14} />
        {t('lp.action.lock')}
      </button>
    ) : null;
  }
  if (primary.kind === 'blocked') {
    return primary.action ? (
      <button type="button" className="btn-ghost btn-sm" onClick={() => onAction('OVERRIDE_DEPENDENCY')} disabled={busy}>
        <X size={14} />
        {t('lp.action.override')}
      </button>
    ) : null;
  }
  if (primary.kind !== 'action' || !primary.action) return null;

  const icon = { START: Play, SUBMIT: Send, UPLOAD_VERSION: Upload }[primary.action as 'START' | 'SUBMIT' | 'UPLOAD_VERSION'] ?? Play;
  const Icon = icon;
  const label = {
    START: t('lp.action.start'),
    SUBMIT: detail.asset.status === 'CHANGES_REQUESTED' ? t('lp.action.resubmit') : t('lp.action.submit'),
    UPLOAD_VERSION: detail.versions.length ? t('lp.action.uploadNew') : t('lp.action.uploadFirst'),
  }[primary.action as 'START' | 'SUBMIT' | 'UPLOAD_VERSION'];

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" className={cx('btn-primary btn-sm')} onClick={() => onAction(primary.action!)} disabled={busy || Boolean(primary.disabledReason)}>
        {busy ? <Spinner size={14} /> : <Icon size={14} />}
        {label}
      </button>
      {primary.disabledReason && <span className="max-w-[260px] text-end text-[11.5px] text-ink-faint">{t(`lp.error.${primary.disabledReason}` as never)}</span>}
    </span>
  );
}

function AssignDialog({ detail, onClose }: { detail: AssetDetail; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { assetId, refresh } = useAsset();
  const people = usePeople();
  const [assignee, setAssignee] = useState(detail.asset.assigneeUserId);
  const [reviewer, setReviewer] = useState(detail.asset.reviewerUserId);
  const [dueDate, setDueDate] = useState(detail.asset.dueDate ?? '');
  const [priority, setPriority] = useState<Priority>(detail.asset.priority);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      refresh(await lp.assign(assetId, { assigneeUserId: assignee, reviewerUserId: reviewer, dueDate: dueDate || null, priority }));
      toast.push(t('lp.toast.assigned'));
      onClose();
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      title={t('lp.action.editAssignment')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy && <Spinner size={14} />}
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">{t('lp.assignTo')}</span>
          <PersonSelect value={assignee} onChange={setAssignee} people={people} exclude={reviewer} />
        </label>
        <label className="block">
          <span className="label">{t('lp.reviewer')}</span>
          <PersonSelect value={reviewer} onChange={setReviewer} people={people} exclude={assignee} placeholder={t('lp.noReviewer')} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t('lp.dueDate')}</span>
            <input type="date" className="field" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t('lp.priority')}</span>
            <select className="field" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(priorityKey(value))}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
