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
  return {
    async get(key, load) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < freshMs) return hit.value;
      try {
        const value = await load();
        store.set(key, { at: Date.now(), value });
        return value;
      } catch (error) {
        if (!hit) throw error;
        return { ...hit.value, stale: true, fetchedAt: new Date(hit.at).toISOString() };
      }
    },
    clear: () => store.clear(),
  };
}
