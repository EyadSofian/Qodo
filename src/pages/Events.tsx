/**
 * الإيفينتات — the Training Schedule workspace over Odoo.
 *
 * Four questions, four tabs: what is scheduled (Schedule), what is on today
 * (Today), how demand went (Analytics), and what already happened (Archive).
 * The old "running" and "upcoming" lanes are quick filters inside Schedule
 * now, over the same rows as everything else.
 *
 * Read-only on purpose. Courses are run in Odoo; this is the window onto them
 * in the shape the operations sheet taught everybody to read, not a second
 * steering wheel. Every course links back to its Odoo record.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Archive, BarChart3, CalendarClock, CheckCircle2, LayoutDashboard, RefreshCw, Table2 } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { fetchStatus } from '../lib/events';
import {
  agoLabel,
  cairoTime,
  fetchSchedule,
  rangeFor,
  syncSchedule,
  type DateRange,
  type RangePreset,
  type ScheduleResponse,
} from '../lib/eventsSchedule';
import { ArchiveView } from '../components/events/ArchiveView';
import { OverviewTab } from '../components/events/OverviewTab';
import { EventDetailsDrawer } from '../components/events/EventDetailsDrawer';
import { EventsAnalytics } from '../components/events/EventsAnalytics';
import { ScheduleWorkspace } from '../components/events/ScheduleWorkspace';
import { RangePicker } from '../components/events/ScheduleToolbar';
import { TodaySessions } from '../components/events/TodaySessions';
import { Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type Tab = 'overview' | 'schedule' | 'today' | 'analytics' | 'archive';
const TABS: Tab[] = ['overview', 'schedule', 'today', 'analytics', 'archive'];

export function Events() {
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;
  const setTab = (next: Tab) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const [connection, setConnection] = useState<{ checked: boolean; missing: string[]; error: string }>({
    checked: false,
    missing: [],
    error: '',
  });
  const [rangePreset, setRangePreset] = useState<RangePreset>('next90');
  const [range, setRange] = useState<DateRange>(() => rangeFor('next90'));
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const closeDrawer = useCallback(() => setOpenId(null), []);

  useEffect(() => {
    fetchStatus()
      .then((status) => setConnection({ checked: true, missing: status.configured ? [] : status.missing, error: '' }))
      .catch((err) => setConnection({ checked: true, missing: [], error: errorMessage(err, 'ar') }));
  }, []);
  const ready = connection.checked && connection.missing.length === 0 && !connection.error;

  const loadSchedule = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setScheduleError('');
    fetchSchedule(range)
      .then((result) => !cancelled && setSchedule(result))
      .catch((err) => !cancelled && setScheduleError(errorMessage(err, 'ar')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  // The schedule is the source of the header's freshness badge, so it loads
  // whichever tab is open — once per range, and cached on the server.
  useEffect(() => {
    if (!ready) return;
    return loadSchedule();
  }, [ready, loadSchedule]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncSchedule(range);
      setSchedule(result.schedule);
      setScheduleError('');
      setVersion((value) => value + 1);
      if (result.schedule.stale) {
        push(`أودو مردّش — لسه بنعرض آخر مزامنة ناجحة ${agoLabel(result.schedule.fetchedAt)}.`, 'bad');
      } else {
        push(
          result.insightsSync?.directAccepted
            ? 'اتعملت مزامنة من أودو وInsights Hub.'
            : 'الجدول اتحدّث من أودو؛ Insights Hub حافظ على آخر نسخة مالية سليمة.',
          'ok'
        );
      }
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1700px] px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11.5px] font-bold text-brand-600">
            الإيفينتات <span className="text-ink-faint">/</span> جدول التدريب
          </p>
          <h1 className="mt-0.5 text-[24px] font-extrabold leading-tight text-ink">جدول التدريب</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">جدول تشغيلي لكل الكورسات — أونلاين وحضوري — مقروء مباشرة من أودو.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {ready && <Freshness schedule={schedule} loading={loading && !schedule} />}
          <button type="button" onClick={sync} disabled={!ready || syncing} className="btn-navy btn-sm gap-1.5">
            {syncing ? <Spinner size={15} /> : <RefreshCw size={15} />}
            {syncing ? 'بنزامن…' : 'زامن مع أودو'}
          </button>
        </div>
      </header>

      {connection.checked && !ready && <ConnectionProblem missing={connection.missing} error={connection.error} />}
      {!connection.checked && <div className="skeleton h-[420px] rounded-2xl" aria-busy="true" />}

      {ready && (
        <>
          <Segmented
            className="mb-4 w-fit max-w-full"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'نظرة عامة', icon: <LayoutDashboard size={14} /> },
              { value: 'schedule', label: 'الجدول', icon: <Table2 size={14} /> },
              { value: 'today', label: 'النهاردة', icon: <CalendarClock size={14} /> },
              { value: 'analytics', label: 'التحليل', icon: <BarChart3 size={14} /> },
              { value: 'archive', label: 'الأرشيف', icon: <Archive size={14} /> },
            ]}
          />

          {tab === 'schedule' && (
            <>
              {scheduleError && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-status-badBg px-3.5 py-2.5 text-[12.5px] font-semibold text-status-bad">
                  <AlertCircle size={15} />
                  {scheduleError}
                  <button type="button" className="btn-ghost btn-sm ms-auto gap-1.5" onClick={loadSchedule}>
                    <RefreshCw size={14} /> جرّب تاني
                  </button>
                </div>
              )}
              {(schedule || !scheduleError) && (
                <ScheduleWorkspace
                  storageKey="qodo.events.schedule.v1"
                  rows={schedule?.rows ?? null}
                  meta={schedule?.meta ?? null}
                  loading={loading}
                  stale={schedule?.stale}
                  fetchedAt={schedule?.fetchedAt}
                  onOpen={setOpenId}
                  rangeControl={
                    <RangePicker
                      preset={rangePreset}
                      range={range}
                      loading={loading}
                      onChange={(preset, next) => {
                        setRangePreset(preset);
                        setRange(next);
                      }}
                    />
                  }
                />
              )}
            </>
          )}
          {tab === 'overview' &&
            (schedule ? (
              <OverviewTab
                rows={schedule.rows}
                now={new Date()}
                onOpen={setOpenId}
                onGoToday={() => setTab('today')}
                onGoSchedule={() => setTab('schedule')}
              />
            ) : scheduleError ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-status-badBg px-3.5 py-2.5 text-[12.5px] font-semibold text-status-bad">
                <AlertCircle size={15} />
                {scheduleError}
                <button type="button" className="btn-ghost btn-sm ms-auto gap-1.5" onClick={loadSchedule}>
                  <RefreshCw size={14} /> جرّب تاني
                </button>
              </div>
            ) : (
              <OverviewSkeleton />
            ))}
          {tab === 'today' && <TodaySessions version={version} onOpen={setOpenId} />}
          {tab === 'analytics' && <EventsAnalytics version={version} onOpen={setOpenId} />}
          {tab === 'archive' && <ArchiveView version={version} onOpen={setOpenId} />}
        </>
      )}

      <EventDetailsDrawer id={openId} onClose={closeDrawer} />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-surface-line bg-white" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[232px] animate-pulse rounded-2xl border border-surface-line bg-white" />
        ))}
      </div>
    </div>
  );
}

/** "مباشر من أودو · آخر مزامنة ٤:١٨" — or, plainly, that it is not live. */
function Freshness({ schedule, loading }: { schedule: ScheduleResponse | null; loading: boolean }) {
  if (loading || !schedule) {
    return <span className="skeleton hidden h-8 w-40 rounded-full sm:block" aria-hidden />;
  }
  const stale = Boolean(schedule.stale);
  return (
    <span
      role="status"
      className={cx(
        'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold sm:inline-flex',
        stale ? 'border-accent-100 bg-status-warnBg text-accent-700' : 'border-surface-line bg-white/80 text-ink-muted'
      )}
      title={`Source: Odoo · ${new Date(schedule.fetchedAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })} Cairo`}
    >
      {stale ? <AlertCircle size={13} /> : <CheckCircle2 size={13} className="text-status-ok" />}
      <span>{stale ? 'بيانات قديمة من أودو' : 'مباشر من أودو'}</span>
      <span className="text-ink-faint">·</span>
      آخر مزامنة {stale ? agoLabel(schedule.fetchedAt) : cairoTime(schedule.fetchedAt)}
    </span>
  );
}

function ConnectionProblem({ missing, error }: { missing: string[]; error: string }) {
  return (
    <div className="rounded-2xl border border-status-warn/30 bg-status-warnBg p-5">
      <p className="flex items-center gap-2 text-[14px] font-bold text-accent-700">
        <AlertCircle size={18} />
        {error || 'الاتصال بأودو لسه مش متظبط.'}
      </p>
      {missing.length > 0 && (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">محتاج تضيف المتغيرات دي في إعدادات النشر وتعيد التشغيل:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((name) => (
              <li key={name} className="rounded-lg bg-white px-2.5 py-1 font-mono text-[12px] font-bold text-ink">
                {name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
