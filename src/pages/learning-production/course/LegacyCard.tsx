/**
 * A course produced before production runs existed. Its lessons and files
 * are real, but there is no plan to follow — nothing is assumed. A manager
 * can adopt a workflow for it, or start a revamp from it.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { runsApi } from '../../../lib/learningProduction/runApi';
import { invalidate } from '../../../lib/learningProduction/hooks';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { RunView } from '../../../lib/learningProduction/runTypes';
import { useToast } from '../../../components/ui';
import { Busy, Panel } from '../../../components/learning-production/studio';

export function LegacyCard({ view }: { view: RunView }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = view.capabilities.manageRuns && (view.run.status === 'ACTIVE' || view.run.status === 'ON_HOLD');

  async function adopt(scenario: 'EXPERT_NEW' | 'AI_NEW') {
    setBusy(scenario);
    try {
      await runsApi.adopt(view.run.id, scenario);
      invalidate();
      toast.push(t('lp.legacy.adopted'));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t('lp.legacy.title')}>
      <div className="flex gap-3">
        <History size={20} aria-hidden="true" className="mt-0.5 shrink-0 lps-muted" />
        <div className="space-y-2 text-[14px]">
          <p>{t('lp.legacy.body')}</p>
          <p className="lps-muted">{t('lp.legacy.nothingAssumed')}</p>
        </div>
      </div>
      {canManage && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--lps-line)' }}>
          <p className="mb-2 text-[13.5px] font-semibold">{t('lp.legacy.adoptTitle')}</p>
          <p className="mb-3 text-[13px] lps-muted">{t('lp.legacy.adoptBody')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="lps-btn-primary" disabled={Boolean(busy)} onClick={() => adopt('EXPERT_NEW')}>
              {busy === 'EXPERT_NEW' && <Busy />}
              {t('lp.legacy.adoptExpert')}
            </button>
            <button type="button" className="lps-btn" disabled={Boolean(busy)} onClick={() => adopt('AI_NEW')}>
              {busy === 'AI_NEW' && <Busy />}
              {t('lp.legacy.adoptAi')}
            </button>
            <Link to={`/learning-production/runs/new?course=${view.course.id}&scenario=REVAMP`} className="lps-btn">
              {t('lp.legacy.revamp')}
            </Link>
          </div>
        </div>
      )}
    </Panel>
  );
}
