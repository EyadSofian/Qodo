/**
 * The Odoo connection.
 *
 * Engosoft's courses live in Odoo 17 as `event.event`, extended by an in-house
 * module (`lms_event_integration`) that adds the things a training company
 * actually needs: a course code, an instructor, how many lectures and on which
 * weekdays, and one `event.track` per lecture generated from those. This module
 * is the only place that knows how to talk to it.
 *
 * Read-only by design. Nothing here writes to Odoo, and nothing should: Odoo is
 * where the courses are *run*, and a second system quietly editing them is how
 * two sources of truth start disagreeing. The workspace shows them, no more.
 *
 * Entirely optional. With no credentials configured every call reports
 * `configured: false` and the page says so plainly instead of erroring — the
 * same contract push notifications use, so a deployment without Odoo is a
 * deployment with one fewer tile rather than a broken one.
 */

const CONFIG = () => ({
  url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db: process.env.ODOO_DB || '',
  login: process.env.ODOO_LOGIN || '',
  apiKey: process.env.ODOO_API_KEY || '',
  // Optional: Odoo's uid for that login. Supplying it skips an authentication
  // round trip on the first call after a restart; without it we ask.
  uid: Number(process.env.ODOO_UID) || null,
});

export function odooConfigured() {
  const { url, db, login, apiKey } = CONFIG();
  return Boolean(url && db && login && apiKey);
}

/** What is missing, so the UI can say which variable to set rather than "error". */
export function odooMissingConfig() {
  const config = CONFIG();
  return ['url', 'db', 'login', 'apiKey']
    .filter((key) => !config[key])
    .map((key) => `ODOO_${key === 'apiKey' ? 'API_KEY' : key.toUpperCase()}`);
}

class OdooError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * The user id Odoo gives back for our API key.
 *
 * Cached because every request would otherwise cost two round trips, and
 * dropped on any authentication failure so a rotated key recovers on the next
 * call rather than at the next deploy.
 */
let cachedUid = null;
let cachedFor = '';

/**
 * One retry, and only on a timeout.
 *
 * This Odoo's latency is wildly unstable — a bare `version` call, which touches
 * no data at all, was measured at 4 seconds, then 4 again, then 30. Retrying a
 * request that timed out is therefore the difference between a page that works
 * and one that works most of the time. Nothing else is retried: a rejected key
 * or a bad field will fail again the same way, and asking twice would only be
 * twice the load on somebody's production ERP.
 */
async function rpc(service, method, args) {
  try {
    return await rpcOnce(service, method, args);
  } catch (error) {
    if (error?.message !== 'odoo_timeout') throw error;
    return rpcOnce(service, method, args);
  }
}

async function rpcOnce(service, method, args) {
  const { url } = CONFIG();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: Math.floor(Math.random() * 1e9),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new OdooError(`odoo_http_${response.status}`);
    const payload = await response.json();
    if (payload.error) {
      // Odoo buries the useful sentence a few levels down; the outer message is
      // always the same "Odoo Server Error".
      const detail =
        payload.error?.data?.message || payload.error?.message || 'odoo_rpc_error';
      throw new OdooError(detail);
    }
    // A body carrying neither `result` nor `error` is a broken response, not an
    // empty one. Returning `undefined` here is how a truncated reply turned into
    // "running is not iterable" three call frames away, which says nothing about
    // what actually went wrong.
    if (!Object.hasOwn(payload, 'result')) throw new OdooError('odoo_bad_response');
    return payload.result;
  } catch (error) {
    if (error instanceof OdooError) throw error;
    throw new OdooError(error.name === 'AbortError' ? 'odoo_timeout' : 'odoo_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

async function uid() {
  const config = CONFIG();
  const signature = `${config.db}|${config.login}|${config.apiKey.slice(-6)}`;
  if (cachedUid && cachedFor === signature) return cachedUid;
  if (config.uid) {
    cachedUid = config.uid;
    cachedFor = signature;
    return cachedUid;
  }

  const result = await rpc('common', 'authenticate', [
    config.db,
    config.login,
    config.apiKey,
    {},
  ]);
  if (!result) {
    cachedUid = null;
    throw new OdooError('odoo_auth_failed', 401);
  }
  cachedUid = result;
  cachedFor = signature;
  return cachedUid;
}

/**
 * `search_read` in one call. Odoo's own client does the same thing — searching
 * and then reading is two round trips for one question.
 */
export async function searchRead(model, domain, fields, options = {}) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const { db, apiKey } = CONFIG();
  const user = await uid();
  try {
    return await rpc('object', 'execute_kw', [
      db,
      user,
      apiKey,
      model,
      'search_read',
      [domain, fields],
      options,
    ]);
  } catch (error) {
    // A key rotated under us reads as an ordinary access error; forgetting the
    // uid means the next call re-authenticates instead of failing forever.
    if (error.status === 401 || /access|session|expired/i.test(error.message)) cachedUid = null;
    throw error;
  }
}

/**
 * Aggregation, done by Postgres.
 *
 * The alternative — reading every row and counting in JavaScript — means pulling
 * a thousand courses across the wire to learn five numbers. `read_group` is how
 * Odoo's own graph views do it.
 */
export async function readGroup(model, domain, groupBy, fields = []) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  // `fields` defaults to empty on purpose. A groupby may carry a granularity —
  // `date_begin:month` — and the same string in `fields` is read as an aggregate
  // function called "month", which Odoo rejects outright. Counting needs no
  // fields at all; `__count` comes back regardless.
  const { db, apiKey } = CONFIG();
  const user = await uid();
  return rpc('object', 'execute_kw', [
    db,
    user,
    apiKey,
    model,
    'read_group',
    [domain, fields, groupBy],
    { lazy: false },
  ]);
}

/**
 * Which of these fields the live database actually has.
 *
 * Written because `is_zoom_meet` exists in the customisation's source and not on
 * the server: a module can be a version behind what is deployed, and asking for
 * a field that is not there fails the whole query rather than one column. Any
 * reader over a model we do not control should intersect its wishlist with this.
 */
export async function existingFields(model, wanted) {
  const known = await fieldsOf(model);
  return wanted.filter((name) => Object.hasOwn(known, name));
}

/**
 * Field discovery, used by the diagnostics endpoint rather than the page.
 *
 * The customisation is somebody else's module and may move; being able to ask
 * the live database what `event.event` actually has beats guessing from a
 * repository that might be a version behind.
 */
export async function fieldsOf(model) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const { db, apiKey } = CONFIG();
  const user = await uid();
  return rpc('object', 'execute_kw', [
    db,
    user,
    apiKey,
    model,
    'fields_get',
    [],
    { attributes: ['string', 'type', 'relation', 'selection', 'required'] },
  ]);
}

export { OdooError };
