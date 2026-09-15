/**
 * The right-hand panel of every asset: Comments, Versions (with the review
 * history), and Activity. Collapsible, so an editor can have the whole width.
 */

import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, Download, GitCompare, History, MessageSquare, PanelRightClose, Reply, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { useAuth } from '../../../lib/auth';
import { cx, timeAgo } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { useLpQuery } from '../../../lib/learningProduction/hooks';
import { formatSize, lpErrorKey } from '../../../lib/learningProduction/format';
import { formatTimecode } from '@shared/learningProduction/review';
import type { ActivityEntry, People, ReviewComment } from '../../../lib/learningProduction/types';
import { Avatar, useToast } from '../../ui';
import { ActivityFeed, Chip, ConfirmDialog, SkeletonRows } from '../kit';
import { useAsset } from './AssetContext';
import { CommentComposer } from './CommentComposer';
import { DiffView } from './DiffView';

type Tab = 'comments' | 'versions' | 'activity';

export function ReviewSidebar({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useI18n();
  const { detail } = useAsset();
  const [tab, setTab] = useState<Tab>('comments');

  return (
    // The module now scrolls inside its own pane (Layout.tsx), not the
    // document under the fixed topbar, so this sticks relative to that
    // pane's scrollport (padded `py-5`) rather than the viewport itself.
    <aside className="flex min-h-[420px] flex-col rounded-2xl border border-surface-line bg-white lg:sticky lg:top-3 lg:max-h-[calc(100dvh-var(--topbar-h)-56px)]">
      <div className="flex items-center gap-1 border-b border-surface-line px-2 pt-2">
        {(['comments', 'versions', 'activity'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold', tab === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-muted hover:text-ink')}
          >
            {t(`lp.sidebar.${key}` as never)}
            {key === 'comments' && detail.openComments > 0 && <span className="rounded-full bg-status-warnBg px-1.5 text-[11px] text-accent-700">{detail.openComments}</span>}
            {key === 'versions' && detail.versions.length > 0 && <span className="text-[11px] text-ink-faint">{detail.versions.length}</span>}
          </button>
        ))}
        <button type="button" className="btn-quiet ms-auto !min-h-8 rounded-lg px-1.5" onClick={onCollapse} aria-label={t('lp.sidebar.collapse')}>
          <PanelRightClose size={16} className="rtl:rotate-180" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'comments' && <CommentsPanel />}
        {tab === 'versions' && <VersionsPanel />}
        {tab === 'activity' && <ActivityPanel />}
      </div>
    </aside>
  );
}

/* ── comments ─────────────────────────────────────────────────────── */

export function commentPosition(comment: ReviewComment, t: ReturnType<typeof useI18n>['t']) {
  if (comment.annotation) return t('lp.comment.slide', { n: comment.annotation.pageNumber });
  if (comment.commentType === 'SLIDE' && comment.anchor?.pageNumber) return t('lp.comment.slide', { n: Number(comment.anchor.pageNumber) });
  const marker = comment.audioMarker ?? comment.videoMarker;
  if (marker) return marker.endSeconds !== null && marker.endSeconds !== undefined ? `${formatTimecode(marker.startSeconds)} → ${formatTimecode(marker.endSeconds)}` : formatTimecode(marker.startSeconds);
  if (comment.anchor?.section) return t(`lp.outline.${String(comment.anchor.section)}` as never);
  if (comment.anchor?.blockId) return t('lp.comment.block');
  return null;
}

function sortKey(comment: ReviewComment) {
  if (comment.annotation) return comment.annotation.pageNumber * 100000;
  if (comment.anchor?.pageNumber) return Number(comment.anchor.pageNumber) * 100000;
  const marker = comment.audioMarker ?? comment.videoMarker;
  if (marker) return marker.startSeconds;
  return Number.MAX_SAFE_INTEGER;
}

function CommentsPanel() {
  const { t } = useI18n();
  const { detail, comments, addComment } = useAsset();
  const [filter, setFilter] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN');
  const positional = ['PPT', 'VOICE_OVER', 'VIDEO'].includes(detail.asset.assetType);

  const list = useMemo(() => {
    const all = comments?.comments ?? [];
    const filtered = filter === 'ALL' ? all : all.filter((comment) => comment.status === filter);
    return positional ? [...filtered].sort((a, b) => sortKey(a) - sortKey(b) || a.createdAt.localeCompare(b.createdAt)) : filtered;
  }, [comments, filter, positional]);

  if (!comments) return <div className="p-3"><SkeletonRows rows={3} height="h-16" /></div>;

  return (
    <div className="flex flex-col">
      <div className="flex gap-1 px-3 pt-3">
        {(['OPEN', 'RESOLVED', 'ALL'] as const).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cx('rounded-lg px-2.5 py-1 text-[12px] font-semibold', filter === key ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken')}>
            {t(`lp.comment.filter.${key}` as never)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-ink-faint">
          {filter === 'OPEN' ? t('lp.comment.noneOpen') : t('lp.comment.none')}
        </p>
      ) : (
        <ul className="space-y-2 p-3">
          {list.map((comment) => (
            <CommentThread key={comment.id} comment={comment} people={comments.people} />
          ))}
        </ul>
      )}
      {comments.canComment && (
        <div className="border-t border-surface-line p-3">
          <CommentComposer compact placeholder={positional ? t('lp.comment.generalPlaceholderPositional') : t('lp.comment.placeholder')} onSubmit={async (body) => Boolean(await addComment({ body, commentType: 'GENERAL' }))} />
        </div>
      )}
    </div>
  );
}

function CommentThread({ comment, people }: { comment: ReviewComment; people: People }) {
  const { t } = useI18n();
  const toast = useToast();
  const { detail, comments, reloadComments, refresh, addComment, focusComment, focus } = useAsset();
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const author = people[comment.userId];
  const position = commentPosition(comment, t);
  const onOldVersion = comment.versionId && comment.versionId !== detail.asset.currentVersionId;
  const focused = focus?.comment.id === comment.id;

  const act = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work();
      await reloadComments();
      refresh();
      if (success) toast.push(success);
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    }
  };

  return (
    <li className={cx('rounded-xl border p-3 transition-colors', focused ? 'border-brand-300 bg-brand-50/40' : 'border-surface-line', comment.status === 'RESOLVED' && 'opacity-75')}>
      <button type="button" className="block w-full text-start" onClick={() => focusComment(comment)}>
        <div className="flex items-center gap-2">
          <Avatar name={author?.name ?? '?'} color={author?.avatarColor ?? '#94A3B8'} size={22} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{author?.name ?? t('common.removedUser')}</span>
          <span className="shrink-0 text-[11px] text-ink-faint">{timeAgo(comment.createdAt, t)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {position && <Chip tone="info" className="!text-[11px]">{position}</Chip>}
          {onOldVersion && <Chip className="!text-[11px]">v{comment.versionNumber}</Chip>}
          {comment.commentType === 'SUGGESTION' && <Chip tone="review" className="!text-[11px]">{t('lp.comment.suggestion')}</Chip>}
          {comment.status === 'RESOLVED' && <Chip tone="ok" className="!text-[11px]"><Check size={10} />{t('lp.comment.resolved')}</Chip>}
        </div>
        {typeof comment.anchor?.quote === 'string' && (
          <blockquote className="mt-2 border-s-2 border-surface-line ps-2 text-[12px] italic text-ink-muted line-clamp-3">{comment.anchor.quote as string}</blockquote>
        )}
        <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-ink">{comment.body}</p>
        {comment.suggestionText !== null && comment.commentType === 'SUGGESTION' && (
          <p className="mt-1.5 rounded-lg bg-status-okBg px-2 py-1.5 text-[12.5px] text-green-800">
            → {comment.suggestionText || t('lp.comment.suggestDelete')}
          </p>
        )}
      </button>

      {comment.replies.length > 0 && (
        <ul className="mt-2 space-y-2 border-s border-surface-line ps-3">
          {comment.replies.map((reply) => (
            <li key={reply.id}>
              <p className="text-[12px] font-semibold text-ink">
                {people[reply.userId]?.name ?? t('common.removedUser')} <span className="font-normal text-ink-faint">· {timeAgo(reply.createdAt, t)}</span>
              </p>
              <p className="whitespace-pre-line text-[13px] text-ink">{reply.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {comments?.canComment && (
          <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" onClick={() => setReplying((value) => !value)}>
            <Reply size={12} />
            {t('lp.comment.reply')}
          </button>
        )}
        {comments?.canResolve && (
          <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" onClick={() => void act(() => lp.resolveComment(comment.id, comment.status === 'OPEN'), comment.status === 'OPEN' ? t('lp.toast.commentResolved') : undefined)}>
            {comment.status === 'OPEN' ? <Check size={12} /> : <RotateCcw size={12} />}
            {comment.status === 'OPEN' ? t('lp.comment.resolve') : t('lp.comment.reopen')}
          </button>
        )}
        {comment.commentType === 'SUGGESTION' && comment.status === 'OPEN' && detail.evaluation.actions.SAVE_DRAFT.allowed && (
          <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px] text-status-ok" onClick={() => void act(() => lp.applySuggestion(comment.id), t('lp.toast.suggestionApplied'))}>
            <Wand2 size={12} />
            {t('lp.comment.apply')}
          </button>
        )}
        {comment.annotation && comment.status === 'OPEN' && comment.annotation.createdBy === user?.id && detail.asset.status !== 'LOCKED' && (
          <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={12} />
            {t('lp.comment.deleteShape')}
          </button>
        )}
      </div>

      {replying && (
        <div className="mt-2">
          <CommentComposer
            compact
            autoFocus
            submitLabel={t('lp.comment.reply')}
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              const created = await addComment({ body, parentCommentId: comment.id });
              if (created) setReplying(false);
              return Boolean(created);
            }}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('lp.comment.deleteTitle')}
        body={t('lp.comment.deleteBody')}
        confirmLabel={t('common.delete')}
        tone="danger"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void act(() => lp.deleteAnnotation(comment.annotation!.id));
        }}
      />
    </li>
  );
}

/* ── versions ─────────────────────────────────────────────────────── */

function VersionsPanel() {
  const { t } = useI18n();
  const { detail, viewVersionId, setViewVersionId } = useAsset();
  const [comparing, setComparing] = useState<string | null>(null);
  const text = detail.asset.assetType === 'OUTLINE' || detail.asset.assetType === 'SCRIPT';
  const viewing = viewVersionId ?? detail.asset.currentVersionId;

  if (detail.versions.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-ink-faint">{text ? t('lp.versions.noneText') : t('lp.versions.none')}</p>;
  }

  return (
    <div className="p-3">
      <ul className="space-y-2">
        {detail.versions.map((version, index) => {
          const previous = detail.versions[index + 1];
          return (
            <li key={version.id} className={cx('rounded-xl border p-3', viewing === version.id ? 'border-brand-300 bg-brand-50/40' : 'border-surface-line')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[14px] font-bold text-ink">v{version.versionNumber}</span>
                {version.id === detail.asset.approvedVersionId && <Chip tone="ok">{t('lp.status.APPROVED')}</Chip>}
                {version.decision === 'CHANGES_REQUESTED' && <Chip tone="warn">{t('lp.decision.CHANGES_REQUESTED')}</Chip>}
                {version.decision === 'APPROVED' && version.id !== detail.asset.approvedVersionId && <Chip tone="ok">{t('lp.decision.APPROVED')}</Chip>}
                {version.decision === 'PENDING' && <Chip tone="review">{t('lp.decision.PENDING')}</Chip>}
                {version.id === detail.asset.currentVersionId && <Chip>{t('lp.files.current')}</Chip>}
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">
                {detail.people[version.createdBy]?.name ?? t('common.removedUser')} · {timeAgo(version.createdAt, t)}
              </p>
              {version.fileName && (
                <p className="mt-1 truncate text-[12px] text-ink-faint">
                  {version.fileName} · {formatSize(version.fileSize)}
                </p>
              )}
              {version.versionNotes && <p className="mt-1.5 whitespace-pre-line text-[12.5px] text-ink">{version.versionNotes}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {viewing !== version.id && (
                  <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" onClick={() => setViewVersionId(version.id === detail.asset.currentVersionId ? null : version.id)}>
                    <History size={12} />
                    {t('lp.versions.view')}
                  </button>
                )}
                {version.hasFile && (
                  <a className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" href={paths.file(version.id, { download: true })}>
                    <Download size={12} />
                    {t('lp.versions.download')}
                  </a>
                )}
                {version.externalUrl && (
                  <a className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" href={version.externalUrl} target="_blank" rel="noreferrer">
                    <ArrowUpRight size={12} />
                    {t('lp.versions.openLink')}
                  </a>
                )}
                {text && previous && (
                  <button type="button" className="btn-quiet !min-h-7 rounded-lg px-2 text-[12px]" onClick={() => setComparing(version.id)}>
                    <GitCompare size={12} />
                    {t('lp.versions.compare', { n: previous.versionNumber })}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {detail.approvals.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
            <MessageSquare size={13} />
            {t('lp.versions.reviewHistory')}
          </h3>
          <ol className="space-y-2">
            {detail.approvals.map((approval) => (
              <li key={approval.id} className="text-[12.5px]">
                <p className="text-ink">
                  <span className="font-bold">v{approval.versionNumber}</span> — {t(`lp.decision.${approval.decision}` as never)}
                  {approval.reviewedBy && <span className="text-ink-muted"> · {detail.people[approval.reviewedBy]?.name ?? ''}</span>}
                  <span className="text-ink-faint"> · {timeAgo(approval.reviewedAt ?? approval.submittedAt, t)}</span>
                </p>
                {approval.notes && <p className="mt-0.5 whitespace-pre-line text-ink-muted">“{approval.notes}”</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {comparing && <DiffView versionId={comparing} onClose={() => setComparing(null)} />}
    </div>
  );
}

function ActivityPanel() {
  const { assetId } = useAsset();
  const { data } = useLpQuery<{ entries: ActivityEntry[]; people: People }>(paths.assetActivity(assetId));
  if (!data) return <div className="p-3"><SkeletonRows rows={4} /></div>;
  return (
    <div className="p-3">
      <ActivityFeed entries={data.entries} people={data.people} showWhere={false} />
    </div>
  );
}
