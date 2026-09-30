/**
 * The top of an asset: what it is, where it stands, who owns it, and the one
 * thing to do next. The primary button changes with the state — approved work
 * never still says "Submit", and a maker whose work is with the reviewer sees
 * "Waiting for review" rather than a button that would be refused.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Check, Lock, MoreHorizontal, Pencil, Play, RotateCcw, Send, Unlock, Upload, UserCog, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp } from '../../../lib/learningProduction/api';
import { assetRoute, formatDay, lpErrorKey, priorityKey, stageKey, statusKey } from '../../../lib/learningProduction/format';
import { dueState, todayIn } from '@shared/learningProduction/workflow';
import { isTextAsset } from '@shared/learningProduction/constants';
import type { AssetAction, AssetDetail, Priority } from '../../../lib/learningProduction/types';
import { Modal, Spinner, useToast } from '../../ui';
import { ConfirmDialog, PersonSelect, PriorityChip, ProvenanceField, usePeople } from '../kit';
import { Dot, EDGE_CLASS, Menu, MenuItem, toneOfStatus } from '../studio';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
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

type Dialog = 'submit' | 'approve' | 'changes' | 'reopen' | 'override' | 'lock' | 'revision' | 'assign' | 'notApplicable' | null;

export function AssetHeader() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { assetId, detail, refresh, flushDraft, setUploadOpen } = useAsset();
  const { asset, evaluation, primary, people } = detail;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [lockOnApprove, setLockOnApprove] = useState(false);
  const [provenance, setProvenance] = useState<{ aiAssisted?: boolean; aiTool?: string }>({});
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

  const setApplicable = async (applicable: boolean, reason?: string) => {
    setBusy(true);
    try {
      await runsApi.setApplicability(assetId, applicable, reason);
      refresh(await lp.asset(assetId));
      invalidate();
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
        allowed('ASSIGN') && { key: 'assign', label: t('lp.action.editAssignment'), icon: UserCog },
        allowed('START_REVISION') && { key: 'revision', label: text ? t('lp.action.newRevision') : t('lp.action.newRevisionFile'), icon: Pencil },
        allowed('OVERRIDE_DEPENDENCY') && { key: 'override', label: t('lp.action.override'), icon: X },
        allowed('LOCK') && primary.action !== 'LOCK' && { key: 'lock', label: t('lp.action.lock'), icon: Lock },
        allowed('REOPEN') && { key: 'reopen', label: t('lp.action.reopen'), icon: Unlock },
        detail.canManageApplicability && asset.applicable && !['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'].includes(asset.status) && {
          key: 'notApplicable',
          label: t('lp.asset.markNotApplicable'),
          icon: Ban,
        },
      ].filter(Boolean) as Array<{ key: Dialog; label: string; icon: typeof Lock }>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail]
  );

  const name = (id: string | null) => (id ? people[id]?.name ?? t('common.removedUser') : null);
  const who = [
    { text: t('lp.assetBar.maker', { name: name(asset.assigneeUserId) ?? t('lp.people.unassigned') }), late: false },
    asset.reviewerUserId ? { text: t('lp.assetBar.reviewer', { name: name(asset.reviewerUserId)! }), late: false } : null,
    asset.dueDate ? { text: t(due === 'OVERDUE' ? 'lp.assetBar.late' : 'lp.assetBar.due', { day: formatDay(asset.dueDate, lang) }), late: due === 'OVERDUE' } : null,
  ].filter((part): part is { text: string; late: boolean } => Boolean(part));
  const tone = evaluation.blocked ? 'idle' : toneOfStatus(asset.status);

  return (
    <header className={cx('lps-panel mb-4 px-4 py-3.5 sm:px-5', EDGE_CLASS[due === 'OVERDUE' && tone !== 'ok' ? 'danger' : tone === 'danger' ? 'danger' : tone])}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[17px] font-bold">{t(stageKey(asset.assetType))}</span>
            {version && <span className="text-[13px] font-semibold lps-faint">v{version.versionNumber}</span>}
            <Dot tone={tone} className="text-[13px]">
              {evaluation.blocked ? t('lp.lessonPage.notYet') : t(statusKey(asset.status))}
            </Dot>
            {detail.openComments > 0 && <span className="text-[12.5px] font-semibold text-amber-700">{t('lp.work.openComments', { n: detail.openComments })}</span>}
            {(asset.priority === 'HIGH' || asset.priority === 'URGENT') && <PriorityChip priority={asset.priority} />}
          </h2>
          <p className="mt-1 text-[13px] lps-muted">
            {who.map((part, index) => (
              <span key={index} className={cx(index > 0 && "before:mx-1.5 before:content-['·']", part.late && 'font-semibold text-[color:var(--lps-danger)]')}>
                {part.text}
              </span>
            ))}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton detail={detail} busy={busy} onAction={(action) => {
            if (action === 'START') void run('START', {}, 'lp.toast.started');
            else if (action === 'SUBMIT') setDialog('submit');
            else if (action === 'UPLOAD_VERSION') setUploadOpen(true);
            else if (action === 'LOCK') setDialog('lock');
            else if (action === 'START_REVIEW') void run('START_REVIEW');
          }} onReview={(decision) => setDialog(decision)} />
          {secondary.length > 0 && (
            <Menu label={t('lp.action.more')} icon={MoreHorizontal} buttonClassName="lps-btn !px-2.5">
              {(close) =>
                secondary.map(({ key, label, icon }) => (
                  <MenuItem
                    key={key}
                    icon={icon}
                    label={label}
                    danger={key === 'override' || key === 'reopen'}
                    onClick={() => {
                      close();
                      setDialog(key);
                    }}
                  />
                ))
              }
            </Menu>
          )}
        </div>
      </div>

      {evaluation.blocked && (
        <p className="mt-3 border-t pt-3 text-[13.5px]" style={{ borderColor: 'var(--lps-line)' }}>
          <span className="lps-muted">{t('lp.assetBar.startsAfter')} </span>
          {evaluation.waitingFor.map((entry, index) => (
            <span key={entry.assetType}>
              {index > 0 && <span className="lps-muted">{t('lp.listSeparator')}</span>}
              <Link to={assetRoute(detail.course.id, detail.lesson.id, entry.assetType)} className="font-semibold text-[color:var(--lps-action)] hover:underline">
                {t(stageKey(entry.assetType))}
              </Link>
            </span>
          ))}
        </p>
      )}
      {!asset.applicable && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[13.5px]" style={{ borderColor: 'var(--lps-line)' }}>
          <span>
            <strong>{t('lp.asset.notApplicable')}</strong>
            {asset.notApplicableReason && <span className="lps-muted"> — “{asset.notApplicableReason}”</span>}
          </span>
          {detail.canManageApplicability && (
            <button type="button" className="lps-btn" disabled={busy} onClick={() => void setApplicable(true)}>
              {t('lp.asset.bringBack')}
            </button>
          )}
        </div>
      )}
      {asset.dependencyOverrideAt && (
        <p className="mt-3 text-[12.5px] lps-muted">
          {t('lp.overrideNote', { name: people[asset.dependencyOverrideBy ?? '']?.name ?? '' })} “{asset.dependencyOverrideReason}”
        </p>
      )}
      {asset.status === 'CHANGES_REQUESTED' && latestDecision?.decision === 'CHANGES_REQUESTED' && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13.5px]">
          <p className="flex items-center gap-2 font-semibold text-amber-800">
            <RotateCcw size={14} aria-hidden="true" />
            {t('lp.changesBanner', { n: detail.openComments, name: people[latestDecision.reviewedBy ?? '']?.name ?? '' })}
          </p>
          {latestDecision.notes && <p className="mt-1 whitespace-pre-line lps-muted">{latestDecision.notes}</p>}
        </div>
      )}
      {asset.status === 'LOCKED' && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-emerald-800">
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
        extra={text ? <ProvenanceField value={provenance} onChange={setProvenance} /> : undefined}
        confirmLabel={t('lp.action.submit')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(notes) => void run('SUBMIT', { notes, ...(text ? provenance : {}) }, asset.status === 'CHANGES_REQUESTED' ? 'lp.toast.resubmitted' : 'lp.toast.submitted')}
      />
      <ConfirmDialog
        open={dialog === 'notApplicable'}
        title={t('lp.asset.markNotApplicable')}
        body={t('lp.asset.notApplicableBody')}
        field={{ label: t('lp.reason.label'), required: true }}
        confirmLabel={t('lp.asset.markNotApplicable')}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void setApplicable(false, reason)}
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
          <button type="button" className="lps-btn" onClick={() => onReview('changes')} disabled={busy}>
            <RotateCcw size={14} />
            {t('lp.action.requestChanges')}
          </button>
        )}
        {evaluation.actions.APPROVE.allowed && (
          <button type="button" className="lps-btn !border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-700" onClick={() => onReview('approve')} disabled={busy}>
            <Check size={14} />
            {t('lp.action.approve')}
          </button>
        )}
      </>
    );
  }
  if (primary.kind === 'waiting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-[13px] font-semibold text-violet-700">
        <Send size={14} aria-hidden="true" />
        {t('lp.waitingForReview')}
      </span>
    );
  }
  if (primary.kind === 'done') {
    return primary.action === 'LOCK' ? (
      <button type="button" className="lps-btn" onClick={() => onAction('LOCK')} disabled={busy}>
        <Lock size={14} />
        {t('lp.action.lock')}
      </button>
    ) : null;
  }
  // Waiting for an earlier file: nothing to press here. The override, for
  // the few who may use it, is in the ⋯ menu.
  if (primary.kind === 'blocked') return null;
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
      <button type="button" className="lps-btn-primary" onClick={() => onAction(primary.action!)} disabled={busy || Boolean(primary.disabledReason)}>
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
