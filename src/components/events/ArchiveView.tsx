/**
 * The Archive — one place for what the workbook split across "All Finished",
 * "Finished Engineering", "Finished English" and the rest.
 *
 * Same cards, same filters, same details panel as the schedule; only the loading
 * differs. History is fetched a year (or a custom range of up to a year) at a
 * time and paged, never all at once, and a search also goes to Odoo so it can
 * find a course beyond the first page.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { fetchArchive, ksaTodayIso, type ScheduleResponse } from '../../lib/eventsSchedule';
import { Spinner } from '../ui';
import { CourseWorkspace } from './CourseWorkspace';

type Scope = { kind: 'year'; year: number } | { kind: 'range'; from: string; to: string };

export function ArchiveView({
  version,
  selectedId,
  onOpen,
  onClose,
  docked,
}: {
  version: number;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onClose: () => void;
  docked: boolean;
}) {
  const thisYear = Number(ksaTodayIso().slice(0, 4));
  const [scope, setScope] = useState<Scope>({ kind: 'year', year: thisYear });
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState<ScheduleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ from: `${thisYear}-01-01`, to: ksaTodayIso() });

  const params = useCallback(
    (page: number) =>
      scope.kind === 'year'
        ? { year: scope.year, page, q: search }
        : { from: scope.from, to: scope.to, page, q: search },
    [scope, search]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchArchive(params(0))
      .then((result) => !cancelled && setPages([result]))
      .catch((err) => !cancelled && setError(errorMessage(err, 'ar')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, version]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const next = await fetchArchive(params(pages.length));
      setPages([...pages, next]);
    } catch (err) {
      setError(errorMessage(err, 'ar'));
    } finally {
      setLoading(false);
    }
  };

  const last = pages.at(-1);
  const rows = pages.length ? pages.flatMap((page) => page.rows) : null;
  const years = Array.from({ length: thisYear - 2019 + 1 }, (_, index) => thisYear - index);

  const rangeControl = (
    <div className="flex flex-wrap items-center gap-2">
      <label>
        <span className="sr-only">السنة</span>
        <select
          className="h-10 cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-900 hover:border-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-100"
          value={scope.kind === 'year' ? String(scope.year) : 'custom'}
          onChange={(event) =>
            setScope(event.target.value === 'custom' ? { kind: 'range', ...draft } : { kind: 'year', year: Number(event.target.value) })
          }
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year === thisYear ? `السنة دي (${year})` : year === thisYear - 1 ? `السنة اللي فاتت (${year})` : year}
            </option>
          ))}
          <option value="custom">فترة مخصّصة…</option>
        </select>
      </label>
      {scope.kind === 'range' && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.from && draft.to && draft.from <= draft.to) setScope({ kind: 'range', ...draft });
          }}
        >
          <input type="date" aria-label="من" className="field !w-auto !py-1.5 text-[12.5px]" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="text-slate-500">←</span>
          <input type="date" aria-label="إلى" className="field !w-auto !py-1.5 text-[12.5px]" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <button type="submit" className="btn-navy btn-sm">
            عرض
          </button>
        </form>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      {error && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-700">
          <AlertCircle size={15} />
          {error}
          {!rows && (
            <button type="button" className="btn-ghost btn-sm ms-auto gap-1.5" onClick={() => setScope({ ...scope })}>
              <RefreshCw size={14} /> جرّب تاني
            </button>
          )}
        </p>
      )}
      {(rows || !error) && (
        <CourseWorkspace
          storageKey="qodo.events.archive.v2"
          rows={rows}
          meta={last?.meta ?? null}
          loading={loading}
          stale={pages.some((page) => page.stale)}
          fetchedAt={last?.fetchedAt}
          selectedId={selectedId}
          onOpen={onOpen}
          onClose={onClose}
          docked={docked}
          version={version}
          dateControl={rangeControl}
          archive
          onSearch={setSearch}
          footer={
            last?.meta.hasMore ? (
              <button type="button" className="btn-ghost btn-sm justify-self-center gap-1.5" onClick={loadMore} disabled={loading}>
                {loading && <Spinner size={14} />}
                حمّل {last.meta.pageSize} كورس كمان
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
