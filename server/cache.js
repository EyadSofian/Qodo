/**
 * A cache that also remembers the last answer that worked.
 *
 * This Odoo is slow and, more to the point, *unpredictable*: the same four
 * aggregate queries measured 3.7 seconds one minute and timed out the next.
 * Failing the page for that would mean a tab that works four times out of five,
 * which reads as broken.
 *
 * So a failed refresh falls back to the last good value and says how old it is.
 * Stale numbers about last month's courses are worth incomparably more than an
 * error message, and the page shows the timestamp so nobody mistakes one for the
 * other. Only a cold cache — nothing good ever fetched — surfaces the error.
 */
export function makeCache(freshMs) {
  const store = new Map();
  const inflight = new Map();
  let generation = 0;
  return {
    async get(key, load) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < freshMs) return hit.value;
      // The catalogue and its analysis open together and ask for the same Odoo
      // rows. Share that request instead of making the slow ERP do identical
      // work twice at the same moment.
      if (inflight.has(key)) return inflight.get(key);
      const startedIn = generation;
      const request = (async () => {
        try {
          const value = await load();
          if (startedIn === generation) store.set(key, { at: Date.now(), value });
          return value;
        } catch (error) {
          if (!hit) throw error;
          return { ...hit.value, stale: true, fetchedAt: new Date(hit.at).toISOString() };
        } finally {
          if (inflight.get(key) === request) inflight.delete(key);
        }
      })();
      inflight.set(key, request);
      return request;
    },
    clear: () => {
      generation += 1;
      store.clear();
      inflight.clear();
    },
  };
}
