/**
 * My Work — what is mine, what is next, what is blocked, and where I act.
 *
 * Four answers, each a list of rows that open the exact task, lesson asset,
 * issue or release: what I can act on now (sent-back work and anything late
 * first), what waits for my decision, my work that cannot start yet — with
 * what it waits for and who holds that — and what I finished recently.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2, ClipboardCheck, Inbox, ListTodo, Lock } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths, runsApi } from '../../lib/learningProduction/runApi';
import { lpErrorKey } from '../../lib/learningProduction/format';
import type { MyWork2Response, NotificationPreferences, WorkItem2 } from '../../lib/learningProduction/runTypes';
import type { People } from '../../lib/learningProduction/types';
import { useToast } from '../../components/ui';
import {
  PageHero,
  BlockerList,
  Busy,
  Choice,
  Drawer,
  DueTag,
  EmptyNote,
  ErrorNote,
  LoadingRows,
  Panel,
  Pill,
  SeverityPill,
  TaskStatusPill,
  usePick,
} from '../../components/learning-production/studio';
import { StatusBadge } from '../../components/learning-production/kit';

type Section = 'now' | 'review' | 'blocked' | 'done';

export function MyWork() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLpQuery<MyWork2Response>(runPaths.work);
  const [section, setSection] = useState<Section>('now');
  const [prefs, setPrefs] = useState(false);
  const items = data?.sections[section] ?? [];

  return (
    <div className="lps-stagger space-y-4">
      <PageHero
        icon={ListTodo}
        title={t('lp.myWork.title')}
        lede={t('lp.myWork.lede')}
        actions={
          <button type="button" className="lps-btn" onClick={() => setPrefs(true)}>
            <Bell size={15} aria-hidden="true" />
            {t('lp.prefs.title')}
          </button>
        }
      >
        {data && (
          <div className="flex flex-wrap gap-2">
            {(['now', 'review', 'blocked'] as const).map((key) => (
              <button key={key} type="button" className="lps-hero-stat min-w-[110px] text-start transition-colors hover:bg-white" onClick={() => setSection(key)}>
                <span className="font-display block text-[22px] font-bold leading-none" style={key === 'blocked' && data.sections[key].length ? { color: 'var(--lps-attention)' } : undefined}>
                  {data.sections[key].length}
                </span>
                <span className="mt-1 block text-[12px] lps-muted">{t(`lp.myWork.${key}` as StringKey)}</span>
              </button>
            ))}
          </div>
        )}
      </PageHero>

      {error ? <ErrorNote error={error} onRetry={reload} /> : null}

      <Panel
        bodyClassName="p-0"
        title={
          <Choice<Section>
            label={t('lp.myWork.title')}
            value={section}
            onChange={setSection}
            options={[
              { value: 'now', label: t('lp.myWork.now'), count: data?.counts.now },
              { value: 'review', label: t('lp.myWork.review'), count: data?.counts.review },
              { value: 'blocked', label: t('lp.myWork.blocked'), count: data?.counts.blocked },
              { value: 'done', label: t('lp.myWork.done') },
            ]}
          />
        }
      >
        {loading && !data ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyNote
            icon={section === 'review' ? ClipboardCheck : section === 'done' ? CheckCircle2 : Inbox}
            title={t(`lp.myWork.empty.${section}` as StringKey)}
            body={section === 'now' ? t('lp.myWork.emptyNowBody') : undefined}
          />
        ) : (
          <WorkTable items={items} people={data?.people ?? {}} showBlockers={section === 'blocked'} />
        )}
      </Panel>

      {prefs && <Preferences onClose={() => setPrefs(false)} />}
    </div>
  );
}

/** One table for tasks, assets, issues and releases — the same columns for all four. */
export function WorkTable({ items, people, showBlockers = false }: { items: WorkItem2[]; people: People; showBlockers?: boolean }) {
  const { t } = useI18n();
  const pick = usePick();
  return (
    <div className="overflow-x-auto">
      <table className="lps-table min-w-[820px]">
        <thead>
          <tr>
            <th>{t('lp.col.what')}</th>
            <th>{t('lp.col.where')}</th>
            <th className="w-[170px]">{t('lp.col.status')}</th>
            <th>{t('lp.col.due')}</th>
            <th className="text-end">{t('lp.col.action')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const title =
              item.kind === 'ASSET'
                ? `${t(`lp.stage.${item.assetType}` as StringKey)}${item.versionNumber ? ` v${item.versionNumber}` : ''}`
                : item.kind === 'RELEASE'
                  ? t('lp.work.release', { label: String(item.title ?? '') })
                  : pick(item.title as never);
            const where = [
              item.course.name,
              item.count ? t('lp.work.lessonsCount', { n: item.count }) : item.kind === 'ASSET' ? item.lesson?.name : item.stage ? pick(item.stage.label) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <tr key={`${item.kind}:${item.id}`}>
                <td className="max-w-[340px]">
                  <Link to={item.link} className="block font-medium hover:underline">
                    <span className="lps-bidi">{title}</span>
                  </Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] lps-faint">
                    <Pill tone="outline">{t(`lp.work.kind.${item.kind}` as StringKey)}</Pill>
                    {item.isResubmission && <Pill tone="attention">{t('lp.work.resubmission')}</Pill>}
                    {item.severity && <SeverityPill severity={item.severity} />}
                    {item.openComments ? <span>{t('lp.work.openComments', { n: item.openComments })}</span> : null}
                    {item.sensitive && <Lock size={11} aria-label={t('lp.task.sensitive')} />}
                  </span>
                  {showBlockers && item.blockers.length > 0 && (
                    <div className="mt-1.5">
                      <BlockerList blockers={item.blockers} people={people} courseId={item.course.id} dense />
                    </div>
                  )}
                </td>
                <td className="lps-bidi max-w-[260px] truncate text-[12.5px] lps-muted">{where}</td>
                <td>
                  {item.unowned ? (
                    <Pill tone="attention">{t('lp.cell.unassigned')}</Pill>
                  ) : item.kind === 'TASK' ? (
                    <TaskStatusPill display={item.display} />
                  ) : item.kind === 'ASSET' ? (
                    <StatusBadge status={item.status as never} blocked={item.blocked} size="sm" />
                  ) : (
                    <Pill tone="neutral">{t(`lp.${item.kind === 'ISSUE' ? 'issueStatus' : 'releaseStatus'}.${item.status}` as StringKey)}</Pill>
                  )}
                </td>
                <td>
                  <DueTag dueDate={item.dueDate} dueState={item.dueState} />
                </td>
                <td className="text-end">
                  {item.action ? (
                    <Link to={item.link} className={item.action === 'FIX' || item.action === 'REVIEW' || item.action === 'ASSIGN' ? 'lps-btn-primary' : 'lps-btn'}>
                      {t(`lp.work.action.${item.action}` as StringKey)}
                    </Link>
                  ) : (
                    <Link to={item.link} className="lps-btn-quiet">
                      {t('lp.work.open')}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Preferences({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, setData } = useLpQuery<NotificationPreferences>(runPaths.preferences);
  const [busy, setBusy] = useState(false);
  const prefs = data?.preferences;

  async function save(patch: Partial<NotificationPreferences['preferences']>) {
    setBusy(true);
    try {
      setData(await runsApi.savePreferences(patch));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={t('lp.prefs.title')} subtitle={<span className="text-[12.5px] lps-muted">{t('lp.prefs.lede')}</span>}>
      {!prefs || !data ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="space-y-5">
          <fieldset>
            <legend className="lps-eyebrow mb-2">{t('lp.prefs.kinds')}</legend>
            <ul className="lps-panel divide-y" style={{ borderColor: 'var(--lps-line)' }}>
              {data.events.map((event) => {
                const muted = prefs.mutedEvents.includes(event);
                return (
                  <li key={event} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ borderColor: 'var(--lps-line)' }}>
                    <span className="text-[13px]">
                      {t(`lp.prefs.event.${event}` as StringKey)}
                      <span className="block text-[12px] lps-muted">{t(`lp.prefs.eventHint.${event}` as StringKey)}</span>
                    </span>
                    <label className="flex shrink-0 items-center gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        checked={!muted}
                        disabled={busy}
                        onChange={() => save({ mutedEvents: muted ? prefs.mutedEvents.filter((entry) => entry !== event) : [...prefs.mutedEvents, event] })}
                      />
                      {muted ? t('lp.prefs.off') : t('lp.prefs.on')}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="lps-label">{t('lp.prefs.dueSoon')}</span>
              <select className="lps-input" value={prefs.dueSoonDays} disabled={busy} onChange={(event) => save({ dueSoonDays: Number(event.target.value) })}>
                {[0, 1, 2, 3, 5, 7].map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? t('lp.prefs.never') : t('lp.prefs.days', { n: days })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="lps-label">{t('lp.prefs.overdueRepeat')}</span>
              <select className="lps-input" value={prefs.overdueRepeatDays} disabled={busy} onChange={(event) => save({ overdueRepeatDays: Number(event.target.value) })}>
                {[0, 1, 3, 7].map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? t('lp.prefs.once') : t('lp.prefs.everyDays', { n: days })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {busy && <Busy />}
        </div>
      )}
    </Drawer>
  );
}
