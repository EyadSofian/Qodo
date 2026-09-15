/**
 * One production asset. The same frame for all five stages — header, work in
 * the middle, review panel on the side — with only the middle changing, so
 * learning one stage is learning all of them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { lp, paths } from '../../lib/learningProduction/api';
import { invalidate, useLpQuery, useSessionState } from '../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../lib/learningProduction/format';
import type { AssetDetail, CommentsResponse, NewComment, ReviewComment } from '../../lib/learningProduction/types';
import { useToast } from '../../components/ui';
import { ErrorPanel, SkeletonRows } from '../../components/learning-production/kit';
import { AssetContext, type AssetWorkspaceValue } from '../../components/learning-production/asset/AssetContext';
import { AssetHeader } from '../../components/learning-production/asset/AssetHeader';
import { ReviewSidebar } from '../../components/learning-production/asset/ReviewSidebar';
import { UploadPanel } from '../../components/learning-production/asset/UploadPanel';
import { OutlineEditor } from '../../components/learning-production/asset/OutlineEditor';
import { ScriptEditor } from '../../components/learning-production/asset/ScriptEditor';
import { PPTReviewer } from '../../components/learning-production/asset/PPTReviewer';
import { AudioReviewer } from '../../components/learning-production/asset/AudioReviewer';
import { VideoReviewer } from '../../components/learning-production/asset/VideoReviewer';

export function AssetWorkspace({ assetId }: { assetId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLpQuery<AssetDetail>(paths.asset(assetId));
  const commentsQuery = useLpQuery<CommentsResponse>(paths.comments(assetId));
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ comment: ReviewComment; nonce: number } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useSessionState('asset.sidebar', true);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const reviewStarted = useRef(false);

  const refresh = useCallback(
    (next?: AssetDetail) => {
      if (next) setData(next);
      // Every list that shows this asset — the matrix, My Work, the queue —
      // hears about the change, and this asset refetches its comment count.
      invalidate('/learning-production');
    },
    [setData]
  );

  // The named reviewer opening a submission starts the review; nobody else
  // claims it just by looking.
  useEffect(() => {
    if (!data || reviewStarted.current) return;
    const { asset, evaluation } = data;
    if (evaluation.isReviewer && evaluation.actions.START_REVIEW.allowed && (asset.status === 'SUBMITTED' || asset.status === 'RESUBMITTED')) {
      reviewStarted.current = true;
      void lp.action(assetId, 'start-review').then(refresh).catch(() => undefined);
    }
  }, [data, assetId, refresh]);

  const value = useMemo<AssetWorkspaceValue | null>(() => {
    if (!data) return null;
    return {
      assetId,
      detail: data,
      comments: commentsQuery.data,
      reloadComments: commentsQuery.reload,
      refresh,
      viewVersionId,
      setViewVersionId,
      focus,
      focusComment: (comment) => {
        if (comment.versionId && comment.versionId !== (viewVersionId ?? data.asset.currentVersionId)) {
          setViewVersionId(comment.versionId === data.asset.currentVersionId ? null : comment.versionId);
        }
        setFocus({ comment, nonce: Date.now() });
      },
      addComment: async (input: NewComment) => {
        try {
          const { comment } = await lp.comment(assetId, { versionId: viewVersionId ?? data.asset.currentVersionId, ...input });
          await commentsQuery.reload();
          refresh();
          return comment;
        } catch (failure) {
          toast.push(t(lpErrorKey(failure)), 'bad');
          return null;
        }
      },
      registerFlush: (flush) => {
        flushRef.current = flush;
      },
      flushDraft: async () => {
        await flushRef.current?.();
      },
      uploadOpen,
      setUploadOpen,
    };
  }, [assetId, data, commentsQuery.data, commentsQuery.reload, refresh, viewVersionId, focus, uploadOpen, toast, t]);

  if (loading && !data) {
    return (
      <>
        <div className="skeleton mb-4 h-24 w-full rounded-2xl" />
        <SkeletonRows rows={6} height="h-14" />
      </>
    );
  }
  if (error && !data) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data || !value) return null;

  const type = data.asset.assetType;
  const canUpload = Boolean(data.upload) && data.evaluation.actions.UPLOAD_VERSION.allowed;
  const showUpload = canUpload && (uploadOpen || (!data.currentVersion && data.asset.status !== 'NOT_STARTED' && data.asset.status !== 'ASSIGNED'));

  return (
    <AssetContext.Provider value={value}>
      <AssetHeader />
      <div className={sidebarOpen ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]' : 'relative'}>
        <div className="min-w-0">
          {showUpload && <UploadPanel onClose={data.currentVersion ? () => setUploadOpen(false) : undefined} />}
          {viewVersionId && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-status-infoBg px-3 py-2 text-[13px] text-brand-700">
              {t('lp.versions.viewingOld', { n: data.versions.find((version) => version.id === viewVersionId)?.versionNumber ?? '' })}
              <button type="button" className="font-semibold hover:underline" onClick={() => setViewVersionId(null)}>
                {t('lp.versions.backToCurrent')}
              </button>
            </div>
          )}
          {type === 'OUTLINE' && <OutlineEditor key={assetId} />}
          {type === 'SCRIPT' && <ScriptEditor key={assetId} />}
          {/* Before the first upload the panel above says everything; the viewer's own empty state would repeat it. */}
          {type === 'PPT' && !(showUpload && !data.currentVersion) && <PPTReviewer key={assetId} />}
          {type === 'VOICE_OVER' && !(showUpload && !data.currentVersion) && <AudioReviewer key={assetId} />}
          {type === 'VIDEO' && !(showUpload && !data.currentVersion) && <VideoReviewer key={assetId} />}
        </div>
        {sidebarOpen ? (
          <ReviewSidebar onCollapse={() => setSidebarOpen(false)} />
        ) : (
          <button type="button" className="btn-navy btn-sm fixed bottom-24 end-4 z-30 shadow-lift md:bottom-6" onClick={() => setSidebarOpen(true)}>
            <MessageSquare size={15} />
            {t('lp.sidebar.open')}
            {data.openComments > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{data.openComments}</span>}
          </button>
        )}
      </div>
    </AssetContext.Provider>
  );
}
