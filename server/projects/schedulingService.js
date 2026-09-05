/**
 * Qodo Projects — scheduling.
 *
 * Working days, dependencies, the critical path and cascading reschedules. It
 * is deliberately pure: no database, no request, no dates that depend on when
 * the process happens to be running. That is what makes a Gantt drag testable
 * without a browser, and it is why the whole of §17, §18 and §19 rests on one
 * file that a test can call directly.
 *
 * Two decisions run through everything here:
 *
 * **Dates are working days, not calendar days.** A five-day task starting
 * Thursday does not finish on Monday. Engosoft's week is Sunday to Thursday,
 * which is why the default calendar in migration 001 is `{7,1,2,3,4}` rather
 * than the Monday-to-Friday assumption most scheduling code is born with — a
 * default that would have been quietly wrong for every project in the company.
 *
 * **Dates are strings, `YYYY-MM-DD`, and arithmetic happens on UTC.** A `Date`
 * built from a local timezone shifts by a day either side of midnight, and a
 * schedule that moves depending on who opened it is not a schedule.
 */

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC epoch milliseconds. Rejects anything else. */
export function parseDate(value) {
  if (value instanceof Date) return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatDate(ms) {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. What `work_calendars.workdays` holds. */
export function isoWeekday(ms) {
  const day = new Date(ms).getUTCDay();
  return day === 0 ? 7 : day;
}

/* ------------------------------------------------------------------ */
/* The calendar                                                         */
/* ------------------------------------------------------------------ */

/**
 * Engosoft's working week. Sunday through Thursday.
 *
 * Stated here as well as in the migration because a caller that forgets to pass
 * a calendar should get the company's actual week, not a Western one — a wrong
 * default that still produces plausible dates is the worst kind.
 */
export const DEFAULT_WORKDAYS = [7, 1, 2, 3, 4];

export function makeCalendar({ workdays = DEFAULT_WORKDAYS, holidays = [] } = {}) {
  const working = new Set(workdays.map(Number).filter((day) => day >= 1 && day <= 7));
  // A calendar with no working days would make every loop below run forever.
  // Falling back is better than hanging, and better than throwing at midnight
  // in a scheduler nobody is watching.
  if (working.size === 0) DEFAULT_WORKDAYS.forEach((day) => working.add(day));

  return {
    workdays: working,
    holidays: new Set(holidays.map((date) => (typeof date === 'string' ? date.slice(0, 10) : formatDate(parseDate(date))))),
  };
}

export function isWorkingDay(dateMs, calendar) {
  if (dateMs === null) return false;
  if (!calendar.workdays.has(isoWeekday(dateMs))) return false;
  return !calendar.holidays.has(formatDate(dateMs));
}

/**
 * The first working day on or after `dateMs`.
 *
 * Bounded at 400 iterations. A calendar whose entire next year is holidays is a
 * configuration error, and returning null lets the caller say so; spinning
 * forever inside a scheduler does not.
 */
export function nextWorkingDay(dateMs, calendar) {
  let cursor = dateMs;
  for (let guard = 0; guard < 400; guard += 1) {
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor += DAY_MS;
  }
  return null;
}

export function previousWorkingDay(dateMs, calendar) {
  let cursor = dateMs;
  for (let guard = 0; guard < 400; guard += 1) {
    if (isWorkingDay(cursor, calendar)) return cursor;
    cursor -= DAY_MS;
  }
  return null;
}

/**
 * Move `count` working days from `dateMs`.
 *
 * `count = 0` snaps to the next working day rather than staying put, because a
 * task that starts "today" when today is a Friday starts on Sunday. Negative
 * counts walk backwards, which is what the backward pass of the critical path
 * needs.
 */
export function addWorkingDays(dateMs, count, calendar) {
  let cursor = nextWorkingDay(dateMs, calendar);
  if (cursor === null) return null;
  if (count === 0) return cursor;

  const step = count > 0 ? DAY_MS : -DAY_MS;
  let remaining = Math.abs(count);

  for (let guard = 0; guard < 4000 && remaining > 0; guard += 1) {
    cursor += step;
    if (isWorkingDay(cursor, calendar)) remaining -= 1;
  }
  return remaining === 0 ? cursor : null;
}

/**
 * How many working days the span covers, counting both ends.
 *
 * Inclusive because that is how people describe work: a task from Sunday to
 * Sunday is one day, not zero. Every duration in this file uses the same
 * convention, and mixing the two is the classic off-by-one that makes a Gantt
 * bar a day short.
 */
export function workingDaysBetween(startMs, endMs, calendar) {
  if (startMs === null || endMs === null || endMs < startMs) return 0;
  let count = 0;
  for (let cursor = startMs; cursor <= endMs; cursor += DAY_MS) {
    if (isWorkingDay(cursor, calendar)) count += 1;
  }
  return count;
}

/** The finish date of a task that starts on `startMs` and lasts `days` working days. */
export function finishOf(startMs, days, calendar) {
  const duration = Math.max(1, Math.floor(Number(days) || 1));
  return addWorkingDays(startMs, duration - 1, calendar);
}

/* ------------------------------------------------------------------ */
/* Dependencies                                                         */
/* ------------------------------------------------------------------ */

export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'];

/**
 * Find a cycle, if there is one.
 *
 * Returns the offending path — `['a','b','c','a']` — rather than a boolean,
 * because "you cannot add that dependency" is not an error message anybody can
 * act on. Iterative depth-first search with an explicit stack: a recursive one
 * blows up on a long chain, and a project with a thousand sequential tasks is
 * an ordinary project.
 */
export function findCycle(dependencies) {
  const successors = new Map();
  for (const edge of dependencies) {
    if (!successors.has(edge.predecessorId)) successors.set(edge.predecessorId, []);
    successors.get(edge.predecessorId).push(edge.successorId);
  }

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Map();
  const parent = new Map();

  const nodes = new Set();
  for (const edge of dependencies) {
    nodes.add(edge.predecessorId);
    nodes.add(edge.successorId);
  }

  for (const root of nodes) {
    if (state.get(root) === DONE) continue;

    const stack = [{ node: root, index: 0 }];
    state.set(root, IN_PROGRESS);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = successors.get(frame.node) ?? [];

      if (frame.index >= children.length) {
        state.set(frame.node, DONE);
        stack.pop();
        continue;
      }

      const child = children[frame.index];
      frame.index += 1;

      if (state.get(child) === IN_PROGRESS) {
        // Walk the parent chain back to the node we just re-entered.
        const path = [child];
        let cursor = frame.node;
        while (cursor !== undefined && cursor !== child) {
          path.push(cursor);
          cursor = parent.get(cursor);
        }
        path.push(child);
        return path.reverse();
      }

      if (state.get(child) !== DONE) {
        parent.set(child, frame.node);
        state.set(child, IN_PROGRESS);
        stack.push({ node: child, index: 0 });
      }
    }
  }

  return null;
}

/**
 * Would adding this edge create a cycle?
 *
 * The question the API actually asks, and asking it *before* the insert is what
 * keeps an unschedulable graph out of the database rather than discovering it
 * on the next Gantt render.
 */
export function wouldCycle(dependencies, candidate) {
  if (candidate.predecessorId === candidate.successorId) {
    return [candidate.predecessorId, candidate.successorId];
  }
  return findCycle([...dependencies, candidate]);
}

/* ------------------------------------------------------------------ */
/* Critical path                                                        */
/* ------------------------------------------------------------------ */

/**
 * Topological order, or null when the graph has a cycle.
 *
 * Kahn's algorithm. Tasks with no dependencies come first, in the order they
 * were given, so a schedule with no constraints at all still comes back in a
 * stable order rather than a hash order that changes between runs.
 */
function topologicalOrder(taskIds, dependencies) {
  const indegree = new Map(taskIds.map((id) => [id, 0]));
  const successors = new Map(taskIds.map((id) => [id, []]));

  for (const edge of dependencies) {
    if (!indegree.has(edge.successorId) || !successors.has(edge.predecessorId)) continue;
    indegree.set(edge.successorId, indegree.get(edge.successorId) + 1);
    successors.get(edge.predecessorId).push(edge.successorId);
  }

  const queue = taskIds.filter((id) => indegree.get(id) === 0);
  const order = [];

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const remaining = indegree.get(next) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return order.length === taskIds.length ? order : null;
}

/**
 * Schedule the network and say which tasks cannot slip.
 *
 * A standard forward and backward pass, in working days:
 *
 *   • forward  — earliest start and finish, pushed later by each predecessor;
 *   • backward — latest start and finish, pulled earlier by each successor;
 *   • float    — how many working days a task may slip without moving the end;
 *   • critical — float of zero. Slip it and the project slips.
 *
 * `tasks` are `{ id, startDate, durationDays }`. A task with no start date
 * inherits the project start, because a network where half the tasks have no
 * date is the normal state of a plan somebody is still writing, and refusing to
 * schedule it is less useful than scheduling it from the only date we know.
 */
export function computeSchedule({ tasks, dependencies = [], projectStart, calendar }) {
  const cal = calendar ?? makeCalendar();
  const ids = tasks.map((task) => task.id);

  const order = topologicalOrder(ids, dependencies);
  if (!order) {
    return { ok: false, error: 'cycle', cycle: findCycle(dependencies), tasks: [] };
  }

  const start = nextWorkingDay(parseDate(projectStart) ?? parseDate(earliestGivenStart(tasks)) ?? todayUtc(), cal);
  const byId = new Map();
  for (const task of tasks) {
    const given = parseDate(task.startDate);
    byId.set(task.id, {
      id: task.id,
      duration: Math.max(1, Math.floor(Number(task.durationDays) || 1)),
      // A date the planner typed is a constraint — the task cannot start before
      // it — not merely a suggestion the network is free to ignore.
      constraint: given === null ? null : nextWorkingDay(given, cal),
      earlyStart: null,
      earlyFinish: null,
      lateStart: null,
      lateFinish: null,
    });
  }

  const predecessorsOf = new Map(ids.map((id) => [id, []]));
  const successorsOf = new Map(ids.map((id) => [id, []]));
  for (const edge of dependencies) {
    if (!predecessorsOf.has(edge.successorId) || !successorsOf.has(edge.predecessorId)) continue;
    predecessorsOf.get(edge.successorId).push(edge);
    successorsOf.get(edge.predecessorId).push(edge);
  }

  /* ── forward pass ───────────────────────────────────────────── */

  for (const id of order) {
    const node = byId.get(id);
    let earliest = node.constraint ?? start;

    for (const edge of predecessorsOf.get(id)) {
      const predecessor = byId.get(edge.predecessorId);
      if (!predecessor) continue;
      const lag = Math.floor(Number(edge.lagDays) || 0);

      // Each relationship constrains a different pair of endpoints. Written out
      // rather than collapsed, because the difference between "after it
      // finishes" and "when it finishes" is the whole meaning of the type.
      let bound;
      switch (edge.type) {
        case 'SS':
          bound = addWorkingDays(predecessor.earlyStart, lag, cal);
          break;
        case 'FF':
          // Constrains the finish; convert back to a start.
          bound = addWorkingDays(predecessor.earlyFinish, lag - (node.duration - 1), cal);
          break;
        case 'SF':
          bound = addWorkingDays(predecessor.earlyStart, lag - (node.duration - 1), cal);
          break;
        case 'FS':
        default:
          bound = addWorkingDays(predecessor.earlyFinish, lag + 1, cal);
          break;
      }
      if (bound !== null && bound > earliest) earliest = bound;
    }

    node.earlyStart = nextWorkingDay(earliest, cal);
    node.earlyFinish = finishOf(node.earlyStart, node.duration, cal);
  }

  /* ── backward pass ──────────────────────────────────────────── */

  const projectFinish = Math.max(...order.map((id) => byId.get(id).earlyFinish));

  for (const id of [...order].reverse()) {
    const node = byId.get(id);
    let latest = projectFinish;

    for (const edge of successorsOf.get(id)) {
      const successor = byId.get(edge.successorId);
      if (!successor || successor.lateStart === null) continue;
      const lag = Math.floor(Number(edge.lagDays) || 0);

      let bound;
      switch (edge.type) {
        case 'SS':
          bound = addWorkingDays(successor.lateStart, -lag + (node.duration - 1), cal);
          break;
        case 'FF':
          bound = addWorkingDays(successor.lateFinish, -lag, cal);
          break;
        case 'SF':
          bound = addWorkingDays(successor.lateFinish, -lag + (node.duration - 1), cal);
          break;
        case 'FS':
        default:
          bound = addWorkingDays(successor.lateStart, -(lag + 1), cal);
          break;
      }
      if (bound !== null && bound < latest) latest = bound;
    }

    node.lateFinish = previousWorkingDay(latest, cal);
    node.lateStart = addWorkingDays(node.lateFinish, -(node.duration - 1), cal);
  }

  /* ── float ──────────────────────────────────────────────────── */

  const scheduled = order.map((id) => {
    const node = byId.get(id);
    // Float is measured in working days between the two starts, and the
    // inclusive convention means an identical pair counts as one, not zero.
    const float = Math.max(0, workingDaysBetween(node.earlyStart, node.lateStart, cal) - 1);
    return {
      id: node.id,
      durationDays: node.duration,
      earlyStart: formatDate(node.earlyStart),
      earlyFinish: formatDate(node.earlyFinish),
      lateStart: formatDate(node.lateStart),
      lateFinish: formatDate(node.lateFinish),
      totalFloat: float,
      isCritical: float === 0,
    };
  });

  return {
    ok: true,
    projectStart: formatDate(start),
    projectFinish: formatDate(projectFinish),
    tasks: scheduled,
    criticalPath: scheduled.filter((task) => task.isCritical).map((task) => task.id),
  };
}

function earliestGivenStart(tasks) {
  const dates = tasks.map((task) => task.startDate).filter(Boolean).sort();
  return dates[0] ?? null;
}

function todayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/* ------------------------------------------------------------------ */
/* Baselines                                                            */
/* ------------------------------------------------------------------ */

/**
 * Current schedule against a captured baseline (§20).
 *
 * Positive variance is late. Stated because the sign convention is the only
 * thing anybody ever gets wrong about a variance column, and a Gantt that
 * paints slippage green is worse than one that paints nothing.
 */
export function baselineVariance({ current, baseline, calendar }) {
  const cal = calendar ?? makeCalendar();
  const baselineById = new Map(baseline.map((row) => [row.id, row]));

  return current.map((task) => {
    const base = baselineById.get(task.id);
    if (!base) {
      // A task added after the baseline was captured has no plan to be measured
      // against. Reporting it as "on time" would be a fabricated measurement.
      return { id: task.id, startVarianceDays: null, finishVarianceDays: null, isNew: true };
    }

    return {
      id: task.id,
      isNew: false,
      startVarianceDays: signedWorkingDays(base.startDate, task.startDate, cal),
      finishVarianceDays: signedWorkingDays(base.endDate, task.endDate, cal),
    };
  });
}

function signedWorkingDays(fromDate, toDate, calendar) {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (from === null || to === null) return null;
  if (from === to) return 0;
  const magnitude = workingDaysBetween(Math.min(from, to), Math.max(from, to), calendar) - 1;
  return to > from ? magnitude : -magnitude;
}

/* ------------------------------------------------------------------ */
/* Cascade                                                              */
/* ------------------------------------------------------------------ */

/**
 * What else has to move when one task moves.
 *
 * Returns only the tasks whose dates actually changed, so the caller writes the
 * minimum and the audit log records a reschedule rather than a rewrite of every
 * row in the project.
 *
 * Deliberately does not persist anything. Whether a drag cascades at all is a
 * project setting and a permission question, and a function that both decides
 * and writes leaves no place to ask either.
 */
export function cascadeFrom({ tasks, dependencies, movedTaskId, newStartDate, calendar, projectStart }) {
  const cal = calendar ?? makeCalendar();

  const before = computeSchedule({ tasks, dependencies, projectStart, calendar: cal });
  if (!before.ok) return before;

  const adjusted = tasks.map((task) =>
    task.id === movedTaskId ? { ...task, startDate: newStartDate } : task
  );

  const after = computeSchedule({ tasks: adjusted, dependencies, projectStart, calendar: cal });
  if (!after.ok) return after;

  const beforeById = new Map(before.tasks.map((task) => [task.id, task]));
  const changes = after.tasks
    .filter((task) => {
      const was = beforeById.get(task.id);
      return !was || was.earlyStart !== task.earlyStart || was.earlyFinish !== task.earlyFinish;
    })
    .map((task) => ({
      id: task.id,
      from: {
        startDate: beforeById.get(task.id)?.earlyStart ?? null,
        endDate: beforeById.get(task.id)?.earlyFinish ?? null,
      },
      to: { startDate: task.earlyStart, endDate: task.earlyFinish },
      isCritical: task.isCritical,
    }));

  return {
    ok: true,
    changes,
    projectFinish: after.projectFinish,
    // The number a warning dialog actually needs: "this pushes the project out
    // by six working days", not "twelve tasks changed".
    projectSlipDays: signedWorkingDays(before.projectFinish, after.projectFinish, cal),
  };
}
