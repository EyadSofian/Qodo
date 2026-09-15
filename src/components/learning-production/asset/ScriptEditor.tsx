/**
 * The script — narration broken into slides or scenes, each with its visual
 * direction and delivery notes, and a running estimate of how long it will
 * take to say at the course's own reading speed.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { countWords, formatTimecode, normalizeContent, scriptBlockSeconds, scriptTotals } from '@shared/learningProduction/review';
import type { ScriptBlock, ScriptContent } from '../../../lib/learningProduction/types';
import { ConfirmDialog, EmptyPanel, SkeletonRows } from '../kit';
import { useAsset } from './AssetContext';
import { CommentComposer } from './CommentComposer';
import { ReviewableText, SaveIndicator, useTextDraft } from './TextTools';

const normalize = (content: unknown) => normalizeContent('SCRIPT', content) as ScriptContent;

const emptyBlock = (): ScriptBlock => ({
  id: globalThis.crypto?.randomUUID?.() ?? `block-${Date.now()}`,
  title: '',
  narration: '',
  visual: '',
  pronunciation: '',
  pauses: '',
  emphasis: '',
  notes: '',
  manualDurationSeconds: null,
});

export function ScriptEditor() {
  const { t } = useI18n();
  const { detail } = useAsset();
  const { content, setContent, editable, saveState, reloadLatest } = useTextDraft(normalize);
  const [removing, setRemoving] = useState<string | null>(null);
  const wpm = detail.settings.wordsPerMinute;
  const totals = useMemo(() => (content ? scriptTotals(content, wpm) : { blocks: 0, words: 0, seconds: 0 }), [content, wpm]);

  if (!content) return <SkeletonRows rows={4} height="h-40" />;

  const update = (id: string, patch: Partial<ScriptBlock>) =>
    setContent({ ...content, blocks: content.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)) });
  const move = (index: number, delta: number) => {
    const blocks = [...content.blocks];
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setContent({ ...content, blocks });
  };
  const add = (index?: number) => {
    const blocks = [...content.blocks];
    blocks.splice(index === undefined ? blocks.length : index + 1, 0, emptyBlock());
    setContent({ ...content, blocks });
  };

  if (!editable && content.blocks.length === 0) {
    return (
      <EmptyPanel
        title={t('lp.script.emptyTitle')}
        body={detail.evaluation.actions.START.allowed ? t('lp.outline.emptyStart') : detail.evaluation.blocked ? t('lp.script.emptyBlocked') : t('lp.script.emptyBody')}
      />
    );
  }

  const unit = content.mode === 'SCENE' ? 'lp.script.scene' : 'lp.script.slide';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-surface-line bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink-muted">
          {editable ? (
            <div className="flex rounded-lg border border-surface-line p-0.5">
              {(['SLIDE', 'SCENE'] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={content.mode === mode} onClick={() => setContent({ ...content, mode })} className={cx('rounded-md px-2 py-0.5 text-[12px] font-semibold', content.mode === mode ? 'bg-navy text-white' : 'text-ink-muted')}>
                  {t(`lp.script.mode.${mode}` as never)}
                </button>
              ))}
            </div>
          ) : null}
          <span>{t('lp.script.blocks', { n: totals.blocks })}</span>
          <span>{t('lp.text.words', { n: totals.words })}</span>
          <span title={t('lp.script.durationHint', { wpm })}>
            {t('lp.script.duration')}: <span className="ltr font-semibold text-ink">{formatTimecode(totals.seconds)}</span>
          </span>
        </div>
        {editable ? <SaveIndicator state={saveState} onReload={reloadLatest} /> : <span className="text-[12px] text-ink-faint">{t('lp.text.readOnly')}</span>}
      </div>

      {content.blocks.length === 0 && editable && (
        <EmptyPanel
          title={t('lp.script.startTitle')}
          body={t('lp.script.startBody')}
          action={
            <button type="button" className="btn-primary btn-sm" onClick={() => add()}>
              <Plus size={14} />
              {t('lp.script.addBlock')}
            </button>
          }
        />
      )}

      {content.blocks.map((block, index) => (
        <BlockCard
          key={block.id}
          block={block}
          number={index + 1}
          unit={unit}
          wpm={wpm}
          editable={editable}
          isFirst={index === 0}
          isLast={index === content.blocks.length - 1}
          onChange={(patch) => update(block.id, patch)}
          onMove={(delta) => move(index, delta)}
          onAddAfter={() => add(index)}
          onRemove={() => {
            const hasText = [block.title, block.narration, block.visual, block.notes].some((value) => value.trim());
            if (hasText) setRemoving(block.id);
            else setContent({ ...content, blocks: content.blocks.filter((entry) => entry.id !== block.id) });
          }}
        />
      ))}

      {editable && content.blocks.length > 0 && (
        <button type="button" className="btn-ghost btn-sm w-full" onClick={() => add()}>
          <Plus size={14} />
          {t('lp.script.addBlock')}
        </button>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title={t('lp.script.removeTitle')}
        body={t('lp.script.removeBody')}
        confirmLabel={t('common.delete')}
        tone="danger"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          setContent({ ...content, blocks: content.blocks.filter((entry) => entry.id !== removing) });
          setRemoving(null);
        }}
      />
    </div>
  );
}

function BlockCard({
  block,
  number,
  unit,
  wpm,
  editable,
  isFirst,
  isLast,
  onChange,
  onMove,
  onAddAfter,
  onRemove,
}: {
  block: ScriptBlock;
  number: number;
  unit: string;
  wpm: number;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<ScriptBlock>) => void;
  onMove: (delta: number) => void;
  onAddAfter: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { comments, addComment } = useAsset();
  const hasNotes = Boolean(block.pronunciation || block.pauses || block.emphasis || block.notes || block.manualDurationSeconds);
  const [notesOpen, setNotesOpen] = useState(hasNotes);
  const [commenting, setCommenting] = useState(false);
  const seconds = scriptBlockSeconds(block, wpm);
  const blockComments = (comments?.comments ?? []).filter((comment) => comment.status === 'OPEN' && comment.anchor?.blockId === block.id).length;
  const field = (name: keyof ScriptBlock) => ({ blockId: block.id, field: name as string });

  return (
    <section className="rounded-2xl border border-surface-line bg-white" style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}>
      <header className="flex flex-wrap items-center gap-2 border-b border-surface-line px-4 py-2">
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[12px] font-bold text-brand-700">{t(unit as never, { n: number })}</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink outline-none placeholder:text-ink-faint read-only:cursor-default"
          value={block.title}
          readOnly={!editable}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={editable ? t('lp.script.titlePlaceholder') : ''}
          aria-label={t('lp.script.title')}
        />
        <span className="ltr text-[12px] text-ink-faint" title={t('lp.script.durationHint', { wpm })}>
          ≈ {formatTimecode(seconds)} · {countWords(block.narration)}w
        </span>
        {comments?.canComment && (
          <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1.5 text-[12px]" onClick={() => setCommenting((value) => !value)} aria-label={t('lp.script.commentBlock')}>
            <MessageSquare size={13} />
            {blockComments > 0 && <span className="font-semibold text-accent-700">{blockComments}</span>}
          </button>
        )}
        {editable && (
          <span className="flex items-center">
            <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1" onClick={() => onMove(-1)} disabled={isFirst} aria-label={t('lp.lessons.moveUp')}>
              <ArrowUp size={13} />
            </button>
            <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1" onClick={() => onMove(1)} disabled={isLast} aria-label={t('lp.lessons.moveDown')}>
              <ArrowDown size={13} />
            </button>
            <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1" onClick={onAddAfter} aria-label={t('lp.script.addAfter')}>
              <Plus size={13} />
            </button>
            <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1" onClick={onRemove} aria-label={t('common.delete')}>
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ReviewableText label={t('lp.script.narration')} value={block.narration} readOnly={!editable} anchor={field('narration')} rows={4} size="lg" placeholder={t('lp.script.narrationPlaceholder')} onChange={(value) => onChange({ narration: value })} />
        <ReviewableText label={t('lp.script.visual')} value={block.visual} readOnly={!editable} anchor={field('visual')} rows={3} placeholder={t('lp.script.visualPlaceholder')} onChange={(value) => onChange({ visual: value })} />
      </div>

      {commenting && (
        <div className="border-t border-surface-line p-4">
          <CommentComposer
            compact
            autoFocus
            context={t('lp.script.commentOn', { label: t(unit as never, { n: number }) })}
            onCancel={() => setCommenting(false)}
            onSubmit={async (body) => {
              const created = await addComment({ body, commentType: 'SCRIPT_BLOCK', anchor: { blockId: block.id } });
              if (created) setCommenting(false);
              return Boolean(created);
            }}
          />
        </div>
      )}

      <div className="border-t border-surface-line">
        <button type="button" className="flex w-full items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold text-ink-muted hover:text-ink" onClick={() => setNotesOpen((value) => !value)} aria-expanded={notesOpen}>
          <ChevronDown size={14} className={cx('transition-transform', !notesOpen && '-rotate-90 rtl:rotate-90')} />
          {t('lp.script.delivery')}
          {hasNotes && !notesOpen && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
        </button>
        {notesOpen && (
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
            <ReviewableText label={t('lp.script.pronunciation')} value={block.pronunciation} readOnly={!editable} anchor={field('pronunciation')} rows={1} onChange={(value) => onChange({ pronunciation: value })} />
            <ReviewableText label={t('lp.script.pauses')} value={block.pauses} readOnly={!editable} anchor={field('pauses')} rows={1} hint={t('lp.script.pausesHint')} onChange={(value) => onChange({ pauses: value })} />
            <ReviewableText label={t('lp.script.emphasis')} value={block.emphasis} readOnly={!editable} anchor={field('emphasis')} rows={1} onChange={(value) => onChange({ emphasis: value })} />
            <ReviewableText label={t('lp.script.notes')} value={block.notes} readOnly={!editable} anchor={field('notes')} rows={1} onChange={(value) => onChange({ notes: value })} />
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-ink-muted">{t('lp.script.manualDuration')}</span>
              <input
                type="number"
                min={0}
                className="field"
                value={block.manualDurationSeconds ?? ''}
                readOnly={!editable}
                placeholder={String(scriptBlockSeconds({ ...block, manualDurationSeconds: null }, wpm))}
                onChange={(event) => onChange({ manualDurationSeconds: event.target.value ? Number(event.target.value) : null })}
              />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
