/**
 * The outline — a focused educational editor, not a general document tool.
 * Fixed sections in the order a lesson is designed, each a plain text field
 * that reviewers can comment on passage by passage.
 */

import { useMemo } from 'react';
import { useI18n } from '../../../lib/i18n';
import { OUTLINE_SECTIONS } from '@shared/learningProduction/constants';
import { normalizeContent, outlineWords } from '@shared/learningProduction/review';
import type { OutlineContent } from '../../../lib/learningProduction/types';
import { EmptyPanel, SkeletonRows } from '../kit';
import { useAsset } from './AssetContext';
import { ReviewableText, SaveIndicator, useTextDraft } from './TextTools';

const normalize = (content: unknown) => normalizeContent('OUTLINE', content) as OutlineContent;
const LARGE = new Set(['learningObjectives', 'keyTopics']);

export function OutlineEditor() {
  const { t } = useI18n();
  const { detail } = useAsset();
  const { content, setContent, editable, saveState, reloadLatest } = useTextDraft(normalize);
  const words = useMemo(() => (content ? outlineWords(content) : 0), [content]);

  if (!content) return <SkeletonRows rows={6} height="h-24" />;

  const empty = !editable && Object.values(content.sections).every((value) => !value.trim());
  if (empty) {
    return (
      <EmptyPanel
        title={t('lp.outline.emptyTitle')}
        body={detail.evaluation.actions.START.allowed ? t('lp.outline.emptyStart') : detail.evaluation.blocked ? t('lp.outline.emptyBlocked') : t('lp.outline.emptyBody')}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-surface-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-line px-4 py-2.5">
        <span className="text-[12.5px] text-ink-muted">{t('lp.text.words', { n: words })}</span>
        {editable ? <SaveIndicator state={saveState} onReload={reloadLatest} /> : <span className="text-[12px] text-ink-faint">{t('lp.text.readOnly')}</span>}
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        {OUTLINE_SECTIONS.map((section) => (
          <ReviewableText
            key={section}
            label={t(`lp.outline.${section}` as never)}
            value={content.sections[section] ?? ''}
            readOnly={!editable}
            anchor={{ section }}
            rows={LARGE.has(section) ? 4 : section === 'lessonTitle' || section === 'estimatedDuration' ? 1 : 2}
            size={section === 'lessonTitle' ? 'lg' : 'md'}
            placeholder={t(`lp.outline.${section}Placeholder` as never)}
            onChange={(value) => setContent({ sections: { ...content.sections, [section]: value } })}
          />
        ))}
      </div>
    </div>
  );
}
