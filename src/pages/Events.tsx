/**
 * الإيفينتات — the training courses dashboard over Odoo.
 *
 * The courses section is the page: five numbers, department chips, filters,
 * course cards, and a details panel that docks beside them. Today, Analytics
 * and Archive are the module's other three questions, one underline tab away.
 *
 * Read-only on purpose. Courses are run in Odoo; this is the window onto them,
 * not a second steering wheel. Every course links back to its Odoo record.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { fetchStatus } from '../lib/events';
import { agoLabel, fetchSchedule, rangeFor, syncSchedule, type DateRange, type RangePreset, type ScheduleResponse } from '../lib/eventsSchedule';
import { ArchiveView } from '../components/events/ArchiveView';
import { OverlayCourseDetails } from '../components/events/CourseDetailsDrawer';
import { CourseWorkspace } from '../components/events/CourseWorkspace';
import { EventsAnalytics } from '../components/events/EventsAnalytics';
import { RangePicker } from '../components/events/EventsFilters';
import { EventsHeader, type EventsSection } from '../components/events/EventsHeader';
import { EventsKpis } from '../components/events/EventsKpis';
import { TodaySessions } from '../components/events/TodaySessions';
import { useToast } from '../components/ui';

const SECTIONS: EventsSection[] = ['schedule', 'today', 'analytics', 'archive'];

/** Wide enough to hold the cards and the details panel side by side. */
function useDockable() {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function Events() {
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  // Old links to ?tab=overview land on the courses dashboard, which replaced it.
  const section = (SECTIONS.includes(params.get('tab') as EventsSection) ? params.get('tab') : 'schedule') as EventsSection;

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
  const closeDetails = useCallback(() => setOpenId(null), []);
  const dockable = useDockable();

  const setSection = (next: EventsSection) => {
    setOpenId(null);
    setParams(next === 'schedule' ? {} : { tab: next }, { replace: true });
  };

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

  // The schedule also feeds the header's freshness badge, so it loads whichever
  // section is open — once per range, and cached on the server.
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
            : 'الكورسات اتحدّثت من أودو؛ Insights Hub حافظ على آخر نسخة مالية سليمة.',
          'ok'
        );
      }
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    } finally {
      setSyncing(false);
    }
  };

  const docksHere = dockable && (section === 'schedule' || section === 'archive');

  return (
    <div className="relative isolate mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">
      {/* The page's own backdrop: a cool base with soft colour behind the KPI
          and filter rows, so the glass surfaces have something to frost and
          white cards never sit on white. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-slate-200/80 via-slate-100 to-slate-100">
        <span className="absolute top-[12%] start-[4%] h-[560px] w-[560px] rounded-full bg-blue-400/35 blur-[110px]" />
        <span className="absolute top-[22%] end-[0%] h-[520px] w-[520px] rounded-full bg-violet-400/35 blur-[110px]" />
        <span className="absolute top-[34%] start-[40%] h-[380px] w-[380px] rounded-full bg-emerald-300/30 blur-[100px]" />
        <span className="absolute bottom-[-10%] end-[25%] h-[420px] w-[420px] rounded-full bg-amber-200/35 blur-[110px]" />
      </div>
      <EventsHeader
        section={section}
        onSection={setSection}
        schedule={schedule}
        loading={loading}
        ready={ready}
        syncing={syncing}
        onSync={sync}
      />

      {connection.checked && !ready && <ConnectionProblem missing={connection.missing} error={connection.error} />}
      {!connection.checked && <div className="skeleton h-[420px] rounded-2xl" aria-busy="true" />}

      {ready && section === 'schedule' && (
        <>
          {scheduleError && !schedule ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-[13px] font-semibold text-rose-700">
              <AlertCircle size={16} />
              {scheduleError}
              <button type="button" className="btn-ghost btn-sm ms-auto gap-1.5" onClick={loadSchedule}>
                <RefreshCw size={14} /> جرّب تاني
              </button>
            </div>
          ) : (
            <CourseWorkspace
              storageKey="qodo.events.courses.v2"
              rows={schedule?.rows ?? null}
              meta={schedule?.meta ?? null}
              loading={loading}
              stale={schedule?.stale}
              fetchedAt={schedule?.fetchedAt}
              selectedId={openId}
              onOpen={setOpenId}
              onClose={closeDetails}
              docked={dockable}
              version={version}
              kpis={<EventsKpis rows={schedule?.rows ?? null} now={new Date()} />}
              dateControl={
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
      {ready && section === 'today' && <TodaySessions version={version} onOpen={setOpenId} />}
      {ready && section === 'analytics' && <EventsAnalytics version={version} onOpen={setOpenId} />}
      {ready && section === 'archive' && (
        <ArchiveView version={version} selectedId={openId} onOpen={setOpenId} onClose={closeDetails} docked={dockable} />
      )}

      <OverlayCourseDetails id={docksHere ? null : openId} version={version} onClose={closeDetails} />
    </div>
  );
}

function ConnectionProblem({ missing, error }: { missing: string[]; error: string }) {
  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-50 p-5">
      <p className="flex items-center gap-2 text-[14px] font-bold text-amber-800">
        <AlertCircle size={18} />
        {error || 'الاتصال بأودو لسه مش متظبط.'}
      </p>
      {missing.length > 0 && (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">محتاج تضيف المتغيرات دي في إعدادات النشر وتعيد التشغيل:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((name) => (
              <li key={name} className="rounded-lg bg-white px-2.5 py-1 font-mono text-[12px] font-bold text-slate-900">
                {name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
