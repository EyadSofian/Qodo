/**
 * One row per signed-in browser, so a person can see where their account is
 * open and sign one device out without touching the others.
 *
 * The session cookie stays a signed JWT; it now carries `sid`, the id of its
 * row here. A row that is revoked, or belongs to someone else, ends that
 * cookie on its next request. A cookie signed before rows existed has no
 * `sid`: its first request records a row for it from that request's browser,
 * so a device that was already signed in shows up once it next opens the app.
 */

import nodeCrypto from 'node:crypto';
import { createIfAbsent, find, getStore, newId, now } from './store.js';

const SEEN_EVERY_MS = 5 * 60 * 1000;

/** "Windows · Chrome" — read from the User-Agent; never used for access decisions. */
export function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'macOS'
          : /CrOS/i.test(ua)
            ? 'ChromeOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'other';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
      ? 'Opera'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : 'other';
  return { os, browser };
}

function clientIp(req) {
  return String(req?.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null;
}

function sessionRow(user, req, expiresAt, id) {
  const userAgent = String(req?.get?.('user-agent') || '').slice(0, 400);
  const stamp = now();
  return {
    id,
    userId: user.id,
    organizationId: user.organizationId ?? null,
    userAgent,
    ...describeDevice(userAgent),
    ip: clientIp(req),
    createdAt: stamp,
    updatedAt: stamp,
    lastSeenAt: stamp,
    expiresAt,
    revokedAt: null,
  };
}

export async function openSession(user, req, expiresAt) {
  const store = await getStore();
  return store.insert('sessions', sessionRow(user, req, expiresAt, newId()));
}

/**
 * The row for a cookie signed before devices were recorded. Its id comes from
 * the cookie itself, so the parallel requests a page fires on load all land on
 * one row instead of one each — a device signed out must not live on in a twin.
 */
export async function adoptLegacySession(user, req, token, expiresAt) {
  const id = `legacy-${nodeCrypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}`;
  const { doc } = await createIfAbsent('sessions', sessionRow(user, req, expiresAt, id));
  return doc;
}

export async function getSession(id) {
  if (!id) return null;
  const store = await getStore();
  return store.get('sessions', String(id));
}

export function isLive(session, userId) {
  return Boolean(
    session &&
      session.userId === userId &&
      !session.revokedAt &&
      (!session.expiresAt || new Date(session.expiresAt).getTime() > Date.now()),
  );
}

/** Throttled: a busy tab must not write a row on every poll. */
export async function touchSession(session, req) {
  if (Date.now() - new Date(session.lastSeenAt || 0).getTime() < SEEN_EVERY_MS) return;
  const store = await getStore();
  await store.update('sessions', session.id, { lastSeenAt: now(), ip: clientIp(req) ?? session.ip });
}

export async function revokeSession(id, revokedBy) {
  const store = await getStore();
  return store.update('sessions', String(id), { revokedAt: now(), revokedBy: revokedBy ?? null });
}

export async function liveSessionsOf(userId) {
  const rows = await find('sessions', (session) => isLive(session, userId));
  return rows.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

/** Expired and revoked rows are kept a week for the record, then dropped. */
export async function pruneSessions(userId) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const store = await getStore();
  const stale = await find(
    'sessions',
    (session) =>
      session.userId === userId &&
      new Date(session.revokedAt || session.expiresAt || session.createdAt).getTime() < cutoff,
  );
  for (const session of stale) await store.remove('sessions', session.id);
}

export function publicSession(session, currentId) {
  return {
    id: session.id,
    os: session.os,
    browser: session.browser,
    ip: session.ip,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    current: session.id === currentId,
  };
}
