/**
 * What every part of one asset workspace shares: the asset as the server last
 * described it, its comments, which version is on screen, and which comment
 * was just clicked — so the sidebar can say "go to slide 4" and the slide
 * reviewer goes there.
 */

import { createContext, useContext } from 'react';
import type { AssetDetail, CommentsResponse, NewComment, ReviewComment } from '../../../lib/learningProduction/types';

export interface AssetWorkspaceValue {
  assetId: string;
  detail: AssetDetail;
  comments: CommentsResponse | null;
  reloadComments: () => Promise<void>;
  /** Take the server's new description of the asset and refresh every list that shows it. */
  refresh: (next?: AssetDetail) => void;
  /** The version on screen. `null` means the current one (or the live draft). */
  viewVersionId: string | null;
  setViewVersionId: (versionId: string | null) => void;
  focus: { comment: ReviewComment; nonce: number } | null;
  focusComment: (comment: ReviewComment) => void;
  addComment: (input: NewComment) => Promise<ReviewComment | null>;
  /** A written editor registers its save so Submit never sends a stale draft. */
  registerFlush: (flush: (() => Promise<void>) | null) => void;
  flushDraft: () => Promise<void>;
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
}

export const AssetContext = createContext<AssetWorkspaceValue | null>(null);

export function useAsset() {
  const value = useContext(AssetContext);
  if (!value) throw new Error('useAsset must be used inside an asset workspace');
  return value;
}

/** The version a reviewer is looking at: the chosen one, or the current one. */
export function useViewedVersion() {
  const { detail, viewVersionId } = useAsset();
  const id = viewVersionId ?? detail.asset.currentVersionId;
  return detail.versions.find((version) => version.id === id) ?? null;
}
