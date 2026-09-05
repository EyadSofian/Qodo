/**
 * Qodo Projects — the Gantt chart.
 *
 * Written rather than adopted, for the reasons in ADR-6: this chart has to
 * refuse a drag. Every Gantt library worth using owns its own data model and
 * treats a move as a fait accompli, which is the wrong shape for a product
 * where the server decides whether a task may move at all, whether the move
 * creates a cycle, and what else has to move with it.
 *
 * So the interaction is: drag → ask the server what would happen → show it →
 * commit or abandon. The chart never writes a date it has not been told.
 *
 * **Direction.** The time axis runs left-to-right in both languages. Gantt
 * convention and date order are left-to-right everywhere the chart is read, and
 * mirroring the axis for Arabic makes a chart that no engineer can compare with
 * the printed programme on the wall. The label column and every control around
 * the chart still mirror — it is the axis alone that is pinned, and that is
 * recorded in QODO_PROJECTS_UI_DIFFERENCES.md.
 */

import { useMemo, useRef, useState } from 'react';
import type {
  BaselineVariance,
  ProjectSchedule,
  ProjectTask,
  TaskDependency,
} from '../../lib/projects/types';
import { useI18n } from '../../lib/i18n';

/** How many pixels one day occupies, per zoom level. */
const ZOOM = {
  day: 34,
  week: 12,
  month: 4,
} as const;

export type GanttZoom = keyof typeof ZOOM;

const DAY_MS = 86_400_000;
const ROW_HEIGHT = 30;
const LABEL_WIDTH = 260;
const HEADER_HEIGHT = 38;

const toMs = (date: string | null | undefined) =>
  date ? Date.parse(`${date.slice(0, 10)}T00:00:00Z`) : null;
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function Gantt({
  tasks,
  schedule,
  dependencies,
  variance,
  zoom,
  canEdit,
  onMove,
}: {
  tasks: ProjectTask[];
  schedule: ProjectSchedule | null;
  dependencies: TaskDependency[];
  variance: BaselineVariance[] | null;
  zoom: GanttZoom;
  canEdit: boolean;
  /** Given a task and a new start date, ask the server what would happen. */
  onMove: (taskId: string, startDate: string) => void;
}) {
  const { t, lang } = useI18n();
  const pxPerDay = ZOOM[zoom];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ taskId: string; offsetDays: number } | null>(null);

  /**
   * The dates each bar is drawn at.
   *
   * The stored dates win when a task has them, and the computed schedule fills
   * in the ones that do not — a plan half-written is the normal state of a plan
   * somebody is still writing, and refusing to draw it is less useful than
   * drawing what the network implies.
   */
  const bars = useMemo(() => {
    const computed = new Map(
      schedule?.ok ? schedule.tasks.map((task) => [task.id, task]) : []
    );

    return tasks
      .map((task) => {
        const planned = computed.get(task.id);
        const start = toMs(task.startDate) ?? toMs(planned?.earlyStart);
        const end = toMs(task.endDate) ?? toMs(planned?.earlyFinish);
        if (start === null || end === null) return null;
        return {
          task,
          start,
          // A bar covers its finish day, so it is drawn one day wider than the
          // difference between the two dates. Getting this wrong makes every
          // one-day task invisible.
          end: end + DAY_MS,
          isCritical: planned?.isCritical ?? false,
          totalFloat: planned?.totalFloat ?? null,
        };
      })
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null);
  }, [tasks, schedule]);

  const window = useMemo(() => {
    if (bars.length === 0) {
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      return { from: today - 7 * DAY_MS, to: today + 30 * DAY_MS };
    }
    // A week of air on each side, so the first bar does not start against the
    // frame and a dragged bar has somewhere to go.
    return {
      from: Math.min(...bars.map((bar) => bar.start)) - 7 * DAY_MS,
      to: Math.max(...bars.map((bar) => bar.end)) + 7 * DAY_MS,
    };
  }, [bars]);

  const totalDays = Math.max(1, Math.round((window.to - window.from) / DAY_MS));
  const chartWidth = totalDays * pxPerDay;
  const chartHeight = Math.max(bars.length, 1) * ROW_HEIGHT;

  const x = (ms: number) => ((ms - window.from) / DAY_MS) * pxPerDay;
  const rowOf = (taskId: string) => bars.findIndex((bar) => bar.task.id === taskId);

  const varianceById = useMemo(
    () => new Map((variance ?? []).map((row) => [row.id, row])),
    [variance]
  );

  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  /* ── ticks ──────────────────────────────────────────────────────── */

  const ticks = useMemo(() => {
    const out: Array<{ ms: number; label: string; major: boolean }> = [];
    const step = zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30;
    for (let cursor = window.from; cursor <= window.to; cursor += step * DAY_MS) {
      const date = new Date(cursor);
      out.push({
        ms: cursor,
        label:
          zoom === 'month'
            ? date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', year: '2-digit' })
            : zoom === 'week'
              ? `${date.getUTCDate()}/${date.getUTCMonth() + 1}`
              : String(date.getUTCDate()),
        major: date.getUTCDate() === 1,
      });
    }
    return out;
  }, [window, zoom, lang]);

  if (bars.length === 0) {
    return (
      <p className="card px-4 py-10 text-center text-sm text-ink-muted">
        {t('gantt.noDates')}
      </p>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex">
        {/* The label column mirrors with the document; only the chart is pinned. */}
        <div
          className="shrink-0 border-e border-surface-line bg-surface-sunken/40"
          style={{ width: LABEL_WIDTH }}
        >
          <div
            className="border-b border-surface-line px-3 text-[11px] font-bold uppercase tracking-wide text-ink-faint"
            style={{ lineHeight: `${HEADER_HEIGHT}px` }}
          >
            {t('projectTasks.title')}
          </div>
          {bars.map((bar) => (
            <div
              key={bar.task.id}
              className="flex items-center gap-1.5 truncate border-b border-surface-line/60 px-3 text-[12.5px] text-ink"
              style={{ height: ROW_HEIGHT, paddingInlineStart: `${0.75 + bar.task.depth * 0.75}rem` }}
              title={bar.task.title}
            >
              {bar.isCritical && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-bad"
                  title={t('gantt.critical')}
                />
              )}
              <span className="truncate">{bar.task.title}</span>
            </div>
          ))}
        </div>

        {/* The chart. `dir="ltr"` pins the time axis; see the header comment. */}
        <div ref={scrollRef} dir="ltr" className="min-w-0 flex-1 overflow-x-auto">
          <svg
            width={chartWidth}
            height={chartHeight + HEADER_HEIGHT}
            role="img"
            aria-label={t('gantt.title')}
            className="block"
          >
            {/* grid + header */}
            <g>
              {ticks.map((tick) => (
                <g key={tick.ms}>
                  <line
                    x1={x(tick.ms)}
                    y1={0}
                    x2={x(tick.ms)}
                    y2={chartHeight + HEADER_HEIGHT}
                    stroke={tick.major ? '#CBD5E1' : '#E6ECF3'}
                    strokeWidth={1}
                  />
                  {(zoom !== 'day' || pxPerDay > 20) && (
                    <text
                      x={x(tick.ms) + 3}
                      y={HEADER_HEIGHT - 13}
                      fontSize={10}
                      fill="#94A3B8"
                      className="select-none"
                    >
                      {tick.label}
                    </text>
                  )}
                </g>
              ))}
              <line
                x1={0}
                y1={HEADER_HEIGHT}
                x2={chartWidth}
                y2={HEADER_HEIGHT}
                stroke="#E6ECF3"
                strokeWidth={1}
              />
            </g>

            {/* today */}
            {today >= window.from && today <= window.to && (
              <line
                x1={x(today)}
                y1={HEADER_HEIGHT}
                x2={x(today)}
                y2={chartHeight + HEADER_HEIGHT}
                stroke="#F5821F"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
            )}

            {/* dependency connectors, drawn under the bars */}
            <g>
              {dependencies.map((edge) => {
                const fromRow = rowOf(edge.predecessorId);
                const toRow = rowOf(edge.successorId);
                if (fromRow === -1 || toRow === -1) return null;
                const from = bars[fromRow];
                const to = bars[toRow];

                const x1 = x(edge.type === 'SS' || edge.type === 'SF' ? from.start : from.end);
                const y1 = HEADER_HEIGHT + fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                const x2 = x(edge.type === 'FF' || edge.type === 'SF' ? to.end : to.start);
                const y2 = HEADER_HEIGHT + toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

                // An elbow rather than a straight line: a diagonal across ten
                // rows is unreadable the moment two of them cross.
                const mid = x1 + Math.max(8, (x2 - x1) / 2);
                return (
                  <g key={edge.id}>
                    <path
                      d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`}
                      fill="none"
                      stroke="#94A3B8"
                      strokeWidth={1}
                    />
                    <circle cx={x2} cy={y2} r={2.5} fill="#94A3B8" />
                  </g>
                );
              })}
            </g>

            {/* bars */}
            <g>
              {bars.map((bar, index) => {
                const y = HEADER_HEIGHT + index * ROW_HEIGHT + 6;
                const left = x(bar.start);
                const width = Math.max(4, x(bar.end) - left);
                const slip = varianceById.get(bar.task.id)?.finishVarianceDays ?? null;

                return (
                  <g key={bar.task.id}>
                    {/* Baseline slippage, drawn as a thin rail under the bar so
                        the comparison is visible without a second chart. */}
                    {slip !== null && slip !== 0 && (
                      <rect
                        x={slip > 0 ? left : left + width}
                        y={y + ROW_HEIGHT - 14}
                        width={Math.max(2, Math.abs(slip) * pxPerDay)}
                        height={3}
                        rx={1.5}
                        fill={slip > 0 ? '#DC2626' : '#16A34A'}
                        opacity={0.7}
                      />
                    )}

                    <rect
                      x={left}
                      y={y}
                      width={width}
                      height={ROW_HEIGHT - 12}
                      rx={4}
                      fill={bar.isCritical ? '#DC2626' : bar.task.color ?? '#1D6FB8'}
                      opacity={drag?.taskId === bar.task.id ? 0.5 : 0.9}
                      className={canEdit ? 'cursor-grab' : ''}
                      onPointerDown={(event) => {
                        if (!canEdit) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setDrag({
                          taskId: bar.task.id,
                          offsetDays: (event.clientX - bounds.left) / pxPerDay,
                        });
                      }}
                      onPointerUp={(event) => {
                        if (!drag || drag.taskId !== bar.task.id) return;
                        const chart = scrollRef.current;
                        if (!chart) return setDrag(null);
                        const chartBounds = chart.getBoundingClientRect();
                        const pointerX = event.clientX - chartBounds.left + chart.scrollLeft;
                        const days = Math.round(pointerX / pxPerDay - drag.offsetDays);
                        const nextStart = toDate(window.from + days * DAY_MS);
                        setDrag(null);
                        if (nextStart !== bar.task.startDate) onMove(bar.task.id, nextStart);
                      }}
                    >
                      <title>
                        {bar.task.title} · {toDate(bar.start)} → {toDate(bar.end - DAY_MS)}
                        {bar.totalFloat !== null && ` · ${t('gantt.float')}: ${bar.totalFloat}`}
                      </title>
                    </rect>

                    {/* Progress fill inside the bar. */}
                    {bar.task.progress > 0 && (
                      <rect
                        x={left}
                        y={y}
                        width={(width * Math.min(100, bar.task.progress)) / 100}
                        height={ROW_HEIGHT - 12}
                        rx={4}
                        fill="#0B2545"
                        opacity={0.35}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
