/**
 * What changed between two versions of an outline or a script.
 */

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp } from '../../../lib/learningProduction/api';
import { OUTLINE_SECTIONS } from '@shared/learningProduction/constants';
import { SCRIPT_BLOCK_FIELDS, diffScriptBlocks, diffText, normalizeContent } from '@shared/learningProduction/review';
import type { Version } from '../../../lib/learningProduction/types';
import { Modal } from '../../ui';
import { SkeletonRows } from '../kit';
import { useAsset } from './AssetContext';

export function DiffSegments({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => diffText(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cx(
            segment.type === 'insert' && 'rounded bg-green-100 text-green-900',
            segment.type === 'delete' && 'rounded bg-red-100 text-red-800 line-through'
          )}
        >
          {segment.text}
        </span>
      ))}
    </p>
  );
}

export function DiffView({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { detail } = useAsset();
  const versions = detail.versions;
  const index = versions.findIndex((version) => version.id === versionId);
  const [afterId, setAfterId] = useState(versionId);
  const [beforeId, setBeforeId] = useState(versions[index + 1]?.id ?? versionId);
  const [loaded, setLoaded] = useState<Record<string, Version>>({});

  useEffect(() => {
    for (const id of [beforeId, afterId]) {
      if (loaded[id]) continue;
      void lp.version(id).then(({ version }) => setLoaded((current) => ({ ...current, [id]: version })));
    }
  }, [beforeId, afterId, loaded]);

  const before = loaded[beforeId];
  const after = loaded[afterId];
  const type = detail.asset.assetType;

  return (
    <Modal open onClose={onClose} width="xl" title={t('lp.versions.compareTitle')}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <select className="field !w-auto" value={beforeId} onChange={(event) => setBeforeId(event.target.value)} aria-label={t('lp.versions.before')}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.versionNumber}
            </option>
          ))}
        </select>
        <span className="text-ink-faint">→</span>
        <select className="field !w-auto" value={afterId} onChange={(event) => setAfterId(event.target.value)} aria-label={t('lp.versions.after')}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.versionNumber}
            </option>
          ))}
        </select>
        <span className="ms-auto flex items-center gap-2 text-[12px]">
          <span className="rounded bg-green-100 px-1.5 text-green-900">{t('lp.versions.added')}</span>
          <span className="rounded bg-red-100 px-1.5 text-red-800 line-through">{t('lp.versions.removed')}</span>
        </span>
      </div>
      {!before || !after ? (
        <SkeletonRows rows={4} />
      ) : type === 'OUTLINE' ? (
        <div className="space-y-4">
          {OUTLINE_SECTIONS.map((section) => {
            const beforeSections = normalizeContent('OUTLINE', before.content).sections as Record<string, string>;
            const afterSections = normalizeContent('OUTLINE', after.content).sections as Record<string, string>;
            const a = beforeSections[section] ?? '';
            const b = afterSections[section] ?? '';
            if (!a && !b) return null;
            return (
              <section key={section}>
                <h4 className="mb-1 text-[12.5px] font-bold text-ink-muted">{t(`lp.outline.${section}` as never)}</h4>
                <DiffSegments before={a} after={b} />
              </section>
            );
          })}
        </div>
      ) : (
        <ol className="space-y-3">
          {diffScriptBlocks(before.content, after.content).map((entry, position) => (
            <li
              key={entry.id}
              className={cx(
                'rounded-xl border p-3',
                entry.status === 'added' && 'border-green-200 bg-green-50/60',
                entry.status === 'removed' && 'border-red-200 bg-red-50/60',
                entry.status === 'same' && 'border-surface-line opacity-70'
              )}
            >
              <p className="mb-1 text-[12px] font-bold text-ink-muted">
                {t('lp.script.block', { n: position + 1 })} · {t(`lp.versions.block.${entry.status}` as never)}
              </p>
              {SCRIPT_BLOCK_FIELDS.map((field) => {
                const a = entry.before?.[field] ?? '';
                const b = entry.after?.[field] ?? '';
                if (!a && !b) return null;
                return (
                  <div key={field} className="mt-1">
                    <span className="text-[11.5px] font-semibold text-ink-faint">{t(`lp.script.${field}` as never)}</span>
                    <DiffSegments before={a} after={b} />
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
