/**
 * My tasks — the module's front page.
 *
 * One list, no tabs: first what waits for the reader's decision, then the
 * work that is theirs to do, each line opening the exact task, lesson file,
 * issue or release with one button. What cannot start yet and what was
 * finished recently fold away underneath. People who run production also see
 * the few courses that need them, beside the list.
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Coffee } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths } from '../../lib/learningProduction/runApi';
import type { MyWork2Response, PortfolioResponse, Reviews2Response, WorkItem2 } from '../../lib/learningProduction/runTypes';
import type { People } from '../../lib/learningProduction/types';
import { cx } from '../../lib/utils';
import { BlockerList, Disclosure, Dot, ErrorNote, LoadingRows, toneOfStatus, useDay, usePick, type DotTone } from '../../components/learning-production/studio';
import { useLpMe } from './Layout';

export function Home() {
  const { t } = useI18n();
  const { user } = useAuth();
  const me = useLpMe();
  const { data, error, loading, reload } = useLpQuery<MyWork2Response>(runPaths.work);
  const managing = Boolean(me?.managesWork || me?.canViewReports);
  const firstName = user?.name?.split(' ')[0] ?? '';

  const review = data?.sections.review ?? [];
  const now = data?.sections.now ?? [];
  const late = data?.counts.overdue ?? 0;

  return (
    <div className="lps-stagger grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className={cx('min-w-0 space-y-6', !managing && 'lg:col-span-2 lg:mx-auto lg:w-full lg:max-w-3xl')}>
        <header>
          <h1 className="lps-title">{firstName ? t('lp.home.hello', { name: firstName }) : t('lp.nav.home')}</h1>
          {data && (
            <p className="mt-1.5 text-[14.5px] lps-muted">
              {review.length + now.length === 0
                ? t('lp.home.allClear')
                : t('lp.home.summary', { work: now.length, reviews: review.length })}
              {late > 0 && <strong className="ms-1.5 text-[color:var(--lps-danger)]">{t('lp.home.late', { n: late })}</strong>}
            </p>
          )}
        </header>

        {error ? <ErrorNote error={error} onRetry={reload} /> : null}

        {loading && !data ? (
          <div className="lps-panel">
            <LoadingRows rows={5} />
          </div>
        ) : data ? (
          <>
            {review.length > 0 && <WorkSection title={t('lp.home.decide')} items={review} people={data.people} />}
            {now.length > 0 && <WorkSection title={t('lp.home.do')} items={now} people={data.people} />}
            {review.length + now.length === 0 && (
              <div className="lps-panel flex flex-col items-center gap-2 px-6 py-12 text-center">
                <Coffee size={28} aria-hidden="true" className="lps-faint" />
                <p className="text-[15px] font-semibold">{t('lp.home.emptyTitle')}</p>
                <p className="max-w-md text-[13.5px] lps-muted">{t('lp.home.emptyBody')}</p>
              </div>
            )}

            <div className="space-y-2">
              {data.sections.blocked.length > 0 && (
                <Disclosure title={t('lp.home.waiting')} count={data.sections.blocked.length}>
                  <p className="mb-2 text-[13px] lps-muted">{t('lp.home.waitingHint')}</p>
                  <WorkList items={data.sections.blocked} people={data.people} showBlockers />
                </Disclosure>
              )}
              {data.sections.done.length > 0 && (
                <Disclosure title={t('lp.home.done')} count={data.sections.done.length}>
                  <WorkList items={data.sections.done} people={data.people} quiet />
                </Disclosure>
              )}
              {me?.managesWork && (
                <Disclosure title={t('lp.home.othersReviews')}>
                  <OthersReviews />
                </Disclosure>
              )}
            </div>
          </>
        ) : null}
      </div>

      {managing && <Attention />}
    </div>
  );
}

function WorkSection({ title, items, people }: { title: string; items: WorkItem2[]; people: People }) {
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-bold">
        {title}
        <span className="lps-count">{items.length}</span>
      </h2>
      <WorkList items={items} people={people} />
    </section>
  );
}

/** Reviews named to other people — a manager's look over the team's queue. */
function OthersReviews() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLpQuery<Reviews2Response>(runPaths.reviews('all'));
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingRows rows={3} />;
  const items = (data?.all ?? []).filter((item) => item.reviewerUserId && item.reviewerUserId !== user?.id);
  if (items.length === 0) return <p className="text-[13px] lps-muted">{t('lp.home.othersNone')}</p>;
  return <WorkList items={items} people={data?.people ?? {}} showReviewer />;
}

/* ------------------------------------------------------------------ */
/* One line of work                                                     */
/* ------------------------------------------------------------------ */

const STRONG_ACTIONS = new Set(['FIX', 'REVIEW', 'ASSIGN', 'VERIFY', 'SIGN_OFF', 'PUBLISH']);

export function WorkList({ items, people, showBlockers = false, quiet = false, showReviewer = false }: { items: WorkItem2[]; people: People; showBlockers?: boolean; quiet?: boolean; showReviewer?: boolean }) {
  return (
    <ul className="lps-panel lps-list">
      {items.map((item) => (
        <WorkLine key={`${item.kind}:${item.id}`} item={item} people={people} showBlockers={showBlockers} quiet={quiet} showReviewer={showReviewer} />
      ))}
    </ul>
  );
}

function WorkLine({ item, people, showBlockers, quiet, showReviewer }: { item: WorkItem2; people: People; showBlockers: boolean; quiet: boolean; showReviewer: boolean }) {
  const { t, dir } = useI18n();
  const pick = usePick();
  const day = useDay();
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;

  // A lesson file reads as its lesson first, then which file it is.
  const title =
    item.kind === 'ASSET'
      ? (item.count ? t('lp.work.lessonsCount', { n: item.count }) : item.lesson?.name) ?? t(`lp.stage.${item.assetType}` as StringKey)
      : item.kind === 'RELEASE'
        ? t('lp.work.release', { label: String(item.title ?? '') })
        : typeof item.title === 'string'
          ? item.title
          : pick(item.title as never);
  const where = [
    item.kind === 'ASSET' ? `${t(`lp.stage.${item.assetType}` as StringKey)}${item.versionNumber ? ` v${item.versionNumber}` : ''}` : null,
    item.course.name,
    item.kind === 'TASK' && item.stage ? pick(item.stage.label) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let tone: DotTone;
  let state: string;
  if (item.unowned) {
    tone = 'attention';
    state = t('lp.cell.unassigned');
  } else if (item.blocked) {
    tone = 'idle';
    state = t('lp.home.notYet');
  } else if (item.kind === 'TASK') {
    tone = toneOfStatus(item.display);
    state = t(`lp.taskStatus.${item.display}` as StringKey);
  } else if (item.kind === 'ASSET') {
    tone = toneOfStatus(item.status);
    state = t(`lp.status.${item.status}` as StringKey);
  } else {
    tone = toneOfStatus(item.status);
    state = t(`lp.${item.kind === 'ISSUE' ? 'issueStatus' : 'releaseStatus'}.${item.status}` as StringKey);
  }
  const late = item.dueState === 'OVERDUE';
  const reviewer = showReviewer && item.reviewerUserId ? people[item.reviewerUserId]?.name : null;

  return (
    <li className="lps-line group relative">
      <span className="min-w-0 flex-1">
        <Link to={item.link} className="lps-stretch lps-bidi block truncate text-[14.5px] font-semibold">
          {title}
        </Link>
        <span className="lps-bidi mt-0.5 block truncate text-[13px] lps-muted">{where}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <Dot tone={tone}>{state}</Dot>
          {item.isResubmission && <span className="lps-muted">{t('lp.work.resubmission')}</span>}
          {item.dueDate && !quiet && (
            <span className={late ? 'font-semibold text-[color:var(--lps-danger)]' : 'lps-muted'}>
              {late ? t('lp.home.lateSince', { day: day(item.dueDate) }) : t('lp.home.due', { day: day(item.dueDate) })}
            </span>
          )}
          {item.openComments ? <span className="lps-muted">{t('lp.work.openComments', { n: item.openComments })}</span> : null}
          {reviewer && <span className="lps-muted">{t('lp.home.reviewer', { name: reviewer })}</span>}
        </span>
        {showBlockers && item.blockers.length > 0 && (
          <span className="relative z-[1] mt-2 block">
            <BlockerList blockers={item.blockers} people={people} courseId={item.course.id} dense />
          </span>
        )}
      </span>
      {quiet ? (
        <CheckCircle2 size={18} aria-hidden="true" className="shrink-0 text-emerald-600" />
      ) : item.action ? (
        <span aria-hidden="true" className={cx('shrink-0', STRONG_ACTIONS.has(item.action) ? 'lps-btn-primary' : 'lps-btn')}>
          {t(`lp.work.action.${item.action}` as StringKey)}
        </span>
      ) : (
        <Arrow size={18} aria-hidden="true" className="shrink-0 lps-faint" />
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Courses that need someone                                            */
/* ------------------------------------------------------------------ */

function Attention() {
  const { t } = useI18n();
  const pick = usePick();
  const day = useDay();
  const { data } = useLpQuery<PortfolioResponse>(runPaths.portfolio);
  const runs = (data?.runs ?? [])
    .filter((run) => !run.isLegacy && (run.health === 'DELAYED' || run.health === 'AT_RISK' || run.blockingIssues > 0))
    .sort((a, b) => Number(b.health === 'DELAYED') - Number(a.health === 'DELAYED') || (a.targetDate ?? '').localeCompare(b.targetDate ?? ''))
    .slice(0, 6);
  return (
    <aside className="min-w-0 space-y-3 lg:pt-[72px]">
      <h2 className="text-[15px] font-bold">{t('lp.home.attention')}</h2>
      {!data ? (
        <div className="lps-panel">
          <LoadingRows rows={3} />
        </div>
      ) : runs.length === 0 ? (
        <p className="lps-panel px-4 py-5 text-[13.5px] lps-muted">{t('lp.home.attentionNone')}</p>
      ) : (
        <ul className="lps-panel lps-list">
          {runs.map((run) => (
            <li key={run.id}>
              <Link to={`/learning-production/courses/${run.course.id}`} className="lps-line !py-3">
                <span className="min-w-0 flex-1">
                  <span className="lps-bidi block truncate text-[14px] font-semibold">{run.course.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                    {run.health === 'DELAYED' || run.health === 'AT_RISK' ? (
                      <Dot tone={run.health === 'DELAYED' ? 'danger' : 'attention'}>{t(`lp.health.${run.health}` as StringKey)}</Dot>
                    ) : (
                      <Dot tone="danger">{t('lp.course.blockingIssues', { n: run.blockingIssues })}</Dot>
                    )}
                    {run.currentStage && <span className="lps-muted">{pick(run.currentStage.label)}</span>}
                    {run.targetDate && <span className="lps-muted">{day(run.targetDate)}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/learning-production/courses" className="lps-btn-quiet">
        {t('lp.home.allCourses')}
      </Link>
    </aside>
  );
}
