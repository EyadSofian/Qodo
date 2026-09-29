/**
 * The plan of a legacy run: there is none, and it says so plainly.
 *
 * A course migrated from before production runs keeps its lesson assets and
 * their history, but no workflow was tracked for it — so this tab does not
 * draw an imaginary one. It points at adopting a workflow, which the overview
 * offers to whoever manages the run.
 */

import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import type { RunView } from '../../../lib/learningProduction/runTypes';
import { EmptyNote } from '../../../components/learning-production/studio';

export function LegacyPlan({ view }: { view: RunView }) {
  const { t } = useI18n();
  return (
    <div className="lps-panel">
      <EmptyNote
        icon={History}
        title={t('lp.legacy.noPlan')}
        body={t('lp.legacy.nothingAssumed')}
        action={
          <Link to={`/learning-production/courses/${view.course.id}`} className="lps-btn">
            {t('lp.legacy.toOverview')}
          </Link>
        }
      />
    </div>
  );
}
