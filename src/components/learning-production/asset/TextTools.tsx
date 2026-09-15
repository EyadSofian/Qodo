/**
 * What the Outline and Script editors share: an autosaved draft that knows
 * when another window has changed it, and text fields where a reviewer selects
 * a passage to comment on or to suggest a replacement for.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CloudOff, Loader2, MessageSquarePlus, Wand2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp } from '../../../lib/learningProduction/api';
import { useAutosave, type SaveState } from '../../../lib/learningProduction/hooks';
import { locateQuote } from '@shared/learningProduction/review';
import type { ReviewComment } from '../../../lib/learningProduction/types';
import { useAsset } from './AssetContext';
import { CommentComposer } from './CommentComposer';

export function useTextDraft<T>(normalize: (content: unknown) => T) {
  const { assetId, detail, refresh, registerFlush, viewVersionId } = useAsset();
  const editable = !viewVersionId && detail.evaluation.actions.SAVE_DRAFT.allowed;
  const serverContent = editable ? detail.draft?.content : detail.currentVersion?.content ?? detail.draft?.content;

  const [content, setContent] = useState<T>(() => normalize(serverContent));
  const revision = useRef(detail.draft?.revision ?? 0);
  const status = useRef(detail.asset.status);
  const [oldContent, setOldContent] = useState<T | null>(null);

  const { state, flush, reset } = useAutosave<T>({
    value: content,
    enabled: editable,
    save: async (value) => {
      const saved = await lp.saveDraft(assetId, value, revision.current);
      revision.current = saved.revision;
      if (saved.status !== status.current) {
        status.current = saved.status;
        refresh();
      }
    },
  });

  // Take the server's copy when it moved on without us (a suggestion applied,
  // another tab) or when the text is not ours to edit right now.
  useEffect(() => {
    const serverRevision = detail.draft?.revision ?? 0;
    if (!editable || serverRevision > revision.current) {
      revision.current = serverRevision;
      const next = normalize(serverContent);
      setContent(next);
      reset(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, editable]);

  useEffect(() => {
    registerFlush(editable ? flush : null);
    return () => registerFlush(null);
  }, [editable, flush, registerFlush]);

  useEffect(() => {
    if (!viewVersionId) {
      setOldContent(null);
      return;
    }
    let alive = true;
    void lp.version(viewVersionId).then(({ version }) => alive && setOldContent(normalize(version.content)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewVersionId]);

  const reloadLatest = useCallback(() => {
    revision.current = -1;
    refresh();
  }, [refresh]);

  return {
    content: viewVersionId ? oldContent : content,
    setContent,
    editable,
    saveState: state,
    reloadLatest,
  };
}

export function SaveIndicator({ state, onReload }: { state: SaveState; onReload: () => void }) {
  const { t } = useI18n();
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-ink-faint" role="status">
        <Loader2 size={13} className="animate-spin" />
        {t('lp.save.saving')}
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-ink-faint" role="status">
        <Check size={13} />
        {t('lp.save.saved')}
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-status-bad" role="alert">
        <CloudOff size={13} />
        {t('lp.save.failed')}
      </span>
    );
  }
  if (state === 'conflict') {
    return (
      <span className="flex items-center gap-2 text-[12px] font-semibold text-accent-700" role="alert">
        <AlertTriangle size={13} />
        {t('lp.save.conflict')}
        <button type="button" className="underline" onClick={onReload}>
          {t('lp.save.reload')}
        </button>
      </span>
    );
  }
  return null;
}

type Anchor = { section: string } | { blockId: string; field: string };

function matches(comment: ReviewComment, anchor: Anchor) {
  const a = comment.anchor ?? {};
  if ('section' in anchor) return a.section === anchor.section;
  return a.blockId === anchor.blockId && a.field === anchor.field;
}

/**
 * A text field reviewers can comment on. Select words, then Comment or
 * Suggest; the open comments on this field are listed under it, and clicking
 * one in the sidebar selects its passage here.
 */
export function ReviewableText({
  label,
  value,
  onChange,
  readOnly,
  anchor,
  placeholder,
  rows = 3,
  hint,
  size = 'md',
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  anchor: Anchor;
  placeholder?: string;
  rows?: number;
  hint?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const { t } = useI18n();
  const { comments, addComment, focus, focusComment } = useAsset();
  const area = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [composer, setComposer] = useState<{ kind: 'comment' | 'suggest'; start: number; end: number; quote: string } | null>(null);
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, rows * 24)}px`;
  }, [value, rows]);

  const fieldComments = (comments?.comments ?? []).filter((comment) => comment.status === 'OPEN' && comment.anchor && matches(comment, anchor));

  useEffect(() => {
    if (!focus || !focus.comment.anchor || !matches(focus.comment, anchor)) return;
    const element = area.current;
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const location = locateQuote(value, focus.comment.anchor);
    if (location) {
      element.focus();
      element.setSelectionRange(location.start, location.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const track = () => {
    const element = area.current;
    if (!element) return;
    const { selectionStart, selectionEnd } = element;
    setSelection(selectionEnd > selectionStart ? { start: selectionStart, end: selectionEnd } : null);
  };

  const open = (kind: 'comment' | 'suggest') => {
    if (!selection) return;
    const quote = value.slice(selection.start, selection.end).slice(0, 1000);
    setComposer({ kind, start: selection.start, end: selection.start + quote.length, quote });
    setSuggestion(quote);
  };

  const canComment = Boolean(comments?.canComment);

  return (
    <div className="group/field">
      <div className="mb-1 flex min-h-[28px] items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink-muted">{label}</span>
        {canComment && selection && !composer && (
          <span className="flex items-center gap-1 animate-pop-in">
            <button type="button" className="btn-ghost !min-h-7 rounded-lg px-2 text-[12px]" onMouseDown={(event) => event.preventDefault()} onClick={() => open('comment')}>
              <MessageSquarePlus size={13} />
              {t('lp.text.comment')}
            </button>
            <button type="button" className="btn-ghost !min-h-7 rounded-lg px-2 text-[12px]" onMouseDown={(event) => event.preventDefault()} onClick={() => open('suggest')}>
              <Wand2 size={13} />
              {t('lp.text.suggest')}
            </button>
          </span>
        )}
      </div>
      <textarea
        ref={area}
        className={cx('field resize-none leading-relaxed', size === 'lg' ? 'text-[15px]' : 'text-[14px]', readOnly && '!bg-surface-bg')}
        value={value}
        readOnly={readOnly}
        rows={rows}
        placeholder={readOnly ? '' : placeholder}
        onChange={(event) => onChange(event.target.value)}
        onSelect={track}
        onKeyUp={track}
        onMouseUp={track}
      />
      {hint && <div className="mt-1 text-[11.5px] text-ink-faint">{hint}</div>}

      {composer && (
        <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <blockquote className="mb-2 border-s-2 border-brand-300 ps-2 text-[12.5px] italic text-ink-muted line-clamp-3">{composer.quote}</blockquote>
          {composer.kind === 'suggest' && (
            <label className="mb-2 block">
              <span className="label !mb-1">{t('lp.text.replaceWith')}</span>
              <textarea className="field min-h-[56px] text-[13px]" value={suggestion} onChange={(event) => setSuggestion(event.target.value)} />
            </label>
          )}
          <CommentComposer
            compact
            autoFocus={composer.kind === 'comment'}
            placeholder={composer.kind === 'suggest' ? t('lp.text.suggestWhy') : t('lp.comment.placeholder')}
            onCancel={() => setComposer(null)}
            onSubmit={async (body) => {
              const created = await addComment({
                body,
                commentType: composer.kind === 'suggest' ? 'SUGGESTION' : 'TEXT_SELECTION',
                anchor: { ...anchor, start: composer.start, end: composer.end, quote: composer.quote },
                ...(composer.kind === 'suggest' ? { suggestionText: suggestion } : {}),
              });
              if (created) setComposer(null);
              return Boolean(created);
            }}
          />
        </div>
      )}

      {fieldComments.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {fieldComments.map((comment) => (
            <li key={comment.id}>
              <button type="button" onClick={() => focusComment(comment)} className="flex w-full items-start gap-2 rounded-lg bg-status-warnBg/60 px-2 py-1.5 text-start text-[12px] hover:bg-status-warnBg">
                <MessageSquarePlus size={12} className="mt-0.5 shrink-0 text-accent-700" />
                <span className="min-w-0 flex-1">
                  {typeof comment.anchor?.quote === 'string' && <span className="me-1 italic text-ink-muted">“{String(comment.anchor.quote).slice(0, 60)}”</span>}
                  <span className="text-ink">{comment.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
