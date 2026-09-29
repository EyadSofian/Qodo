/**
 * Reviews — everything waiting for this person's decision, in the five groups
 * reviewers asked for: first submissions, resubmissions, curriculum approvals,
 * media QA, and UAT and release sign-off (with fixed issues to verify).
 * Managers can widen the list to submissions named to other reviewers.
 */

import { useMemo, useState } from 'react';
import { ClipboardCheck, Stamp } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths } from '../../lib/learningProduction/runApi';
import type { ReviewGroup, Reviews2Response } from '../../lib/learningProduction/runTypes';
import { Choice, EmptyNote, ErrorNote, LoadingRows, PageHero, Panel } from '../../components/learning-production/studio';
import { WorkTable } from './MyWork';
import { useLpMe } from './Layout';

const GROUPS: ReviewGroup[] = ['firstSubmissions', 'resubmissions', 'curriculum', 'mediaQa', 'signoff'];

export function Reviews() {
  const { t } = useI18n();
  const me = useLpMe();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { data, error, loading, reload } = useLpQuery<Reviews2Response>(runPaths.reviews(scope));
  const firstNonEmpty = useMemo(() => GROUPS.find((group) => (data?.groups[group].length ?? 0) > 0) ?? 'firstSubmissions', [data]);
  const [picked, setPicked] = useState<ReviewGroup | null>(null);
  const group = picked ?? firstNonEmpty;
  const items = data?.groups[group] ?? [];

  return (
    <div className="lps-stagger space-y-4">
      <PageHero
        icon={Stamp}
        title={t('lp.reviews.title')}
        lede={t('lp.reviews.lede')}
        actions={
          me?.managesWork ? (
            <label className="lps-hero-stat flex cursor-pointer items-center gap-2 !py-2 text-[13px]">
              <input type="checkbox" checked={scope === 'all'} onChange={(event) => setScope(event.target.checked ? 'all' : 'mine')} />
              {t('lp.reviews.includeOthers')}
            </label>
          ) : undefined
        }
      />
      {error ? <ErrorNote error={error} onRetry={reload} /> : null}
      <Panel
        bodyClassName="p-0"
        title={
          <Choice<ReviewGroup>
            label={t('lp.reviews.title')}
            value={group}
            onChange={setPicked}
            options={GROUPS.map((value) => ({ value, label: t(`lp.reviews.group.${value}` as StringKey), count: data?.groups[value].length ?? 0 }))}
          />
        }
      >
        <p className="px-4 pt-3 text-[12.5px] lps-muted">{t(`lp.reviews.hint.${group}` as StringKey)}</p>
        {loading && !data ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyNote icon={ClipboardCheck} title={t('lp.reviews.empty')} />
        ) : (
          <WorkTable items={items} people={data?.people ?? {}} />
        )}
      </Panel>
    </div>
  );
}
