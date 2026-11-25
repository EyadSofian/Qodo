/**
 * Lets this server call its own API as one named user, without a session.
 *
 * The MCP endpoint reads every module by issuing ordinary GET requests to
 * itself, so each route's own guards and permission checks decide what comes
 * back, exactly as they do for that user in the browser. A session cookie
 * would work too, but it would show up as a "device" in the user's sessions
 * list and could be revoked from there; this does not.
 *
 * The key is random per process and never leaves memory. A request only counts
 * as internal when it carries that key AND arrives on the loopback interface,
 * so neither a leaked header name nor a forwarded request from outside can use
 * it.
 */
import crypto from 'node:crypto';

const KEY = crypto.randomBytes(32).toString('hex');
const KEY_DIGEST = crypto.createHash('sha256').update(KEY).digest();

export const INTERNAL_KEY_HEADER = 'x-engosoft-internal-key';
export const INTERNAL_USER_HEADER = 'x-engosoft-internal-user';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Headers for a loopback request made on behalf of `user`. */
export function internalHeaders(user) {
  return { [INTERNAL_KEY_HEADER]: KEY, [INTERNAL_USER_HEADER]: String(user.id) };
}

/** The user id an internal request speaks for, or null when it is not one. */
export function internalUserId(req) {
  const supplied = req.headers?.[INTERNAL_KEY_HEADER];
  if (typeof supplied !== 'string' || !supplied) return null;
  if (!LOOPBACK.has(String(req.socket?.remoteAddress || ''))) return null;
  const digest = crypto.createHash('sha256').update(supplied).digest();
  if (!crypto.timingSafeEqual(digest, KEY_DIGEST)) return null;
  const userId = req.headers?.[INTERNAL_USER_HEADER];
  return typeof userId === 'string' && userId ? userId : null;
}

/** Base URL of this process for loopback calls. */
export function selfOrigin() {
  return `http://127.0.0.1:${Number(process.env.PORT) || 3000}`;
}
