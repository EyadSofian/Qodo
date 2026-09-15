/**
 * Progress by stage — as bars on the dashboard, as a pipeline on a course.
 *
 * The pipeline is a picture of progress, not a place to work: the matrix is
 * where work happens.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { STAGE_COLOR, STAGE_HEX, STAGE_ICON, stageKey } from '../../lib/learningProduction/format';
import type { StageStat } from '../../lib/learningProduction/types';
import { ProgressBar } from './kit';

export function StageBars({ stages, overall }: { stages: StageStat[]; overall?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const Icon = STAGE_ICON[stage.assetType];
        return (
          <div key={stage.assetType}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <Icon size={14} className={STAGE_COLOR[stage.assetType]} aria-hidden="true" />
                {t(stageKey(stage.assetType))}
              </span>
              <span className="tabular-nums text-ink-muted">
                <span className="font-bold text-ink">{stage.percent}%</span>
                <span className="ms-1.5 text-[11.5px]">
                  {stage.complete}/{stage.total}
                </span>
              </span>
            </div>
            <ProgressBar value={stage.percent} label={t(stageKey(stage.assetType))} className="!h-2" color={STAGE_HEX[stage.assetType]} />
          </div>
        );
      })}
      {overall !== undefined && (
        <div className="border-t border-surface-line pt-3">
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="font-bold text-ink">{t('lp.overallCompletion')}</span>
            <span className="font-bold tabular-nums text-ink">{overall}%</span>
          </div>
          <ProgressBar value={overall} tone="ok" label={t('lp.overallCompletion')} className="!h-2.5" />
        </div>
      )}
    </div>
  );
}

export function Pipeline({ stages }: { stages: StageStat[] }) {
  const { t, dir } = useI18n();
  const Arrow = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <ol className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch sm:gap-0">
      {stages.map((stage, index) => {
        const Icon = STAGE_ICON[stage.assetType];
        return (
          <li key={stage.assetType} className="flex flex-1 items-center">
            <div
              className={cx(
                'flex w-full flex-col items-center rounded-xl border px-2 py-3 text-center',
                stage.percent === 100 ? 'border-green-200 bg-status-okBg' : 'border-surface-line bg-white'
              )}
            >
              <Icon size={18} className={stage.percent === 100 ? 'text-status-ok' : STAGE_COLOR[stage.assetType]} aria-hidden="true" />
              <span className="mt-1 text-[12.5px] font-semibold text-ink">{t(stageKey(stage.assetType))}</span>
              <span className="text-lg font-bold tabular-nums text-ink">{stage.percent}%</span>
            </div>
            {index < stages.length - 1 && <Arrow size={16} className="mx-1 hidden shrink-0 text-ink-faint sm:block" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
