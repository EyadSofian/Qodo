/**
 * The parts of "a file hangs off a record" that are the same whichever record
 * it is.
 *
 * Task deliverables came first and owned all of this. The management desk needs
 * the identical treatment — the same name flattening, the same media-type
 * allowlist, the same download headers — and two copies of a security decision
 * is one copy too many: the day the allowlist needs a new entry, only one of
 * them would get it.
 *
 * What stays in each route file is what actually differs: who is allowed to
 * attach, and what the file is attached to.
 */

/**
 * Types the browser may render in place. Everything else is forced to download
 * as an opaque octet-stream: an uploaded .html or .svg served inline would run
 * its own script on this origin, which is the classic stored-XSS-by-upload.
 */
export const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/**
 * A filename arrives from someone else's computer, so it is treated as text,
 * never as a path: separators, quotes and control characters are flattened to
 * spaces. The bytes are stored under the id we generated, so this only affects
 * what the name looks like coming back out.
 */
export function safeName(raw) {
  let name = String(raw || '');
  try {
    name = decodeURIComponent(name);
  } catch {
    /* not percent-encoded — take it literally */
  }
  const flattened = [...name]
    .map((character) => {
      const code = character.codePointAt(0);
      const unsafe = character === '"' || character === '/' || character === '\\';
      return unsafe || code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (flattened || 'file').slice(0, 180);
}

export function cleanType(raw) {
  const type = String(raw || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream';
}

/** Serves stored bytes under the one set of headers that is safe for all of them. */
export function sendBlob(res, { name, type }, bytes) {
  const inline = INLINE_TYPES.has(type);
  res
    .set({
      'Content-Type': inline ? type : 'application/octet-stream',
      'Content-Length': String(bytes.length),
      // RFC 5987 encoding — an Arabic filename is not header-safe otherwise.
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Belt and braces around anything that slipped past the type allowlist.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
    })
    .send(bytes);
}

/**
 * Body-parser rejections arrive as thrown errors carrying a `type`. Without
 * this they reach the global handler and are reported as a server fault, when
 * in fact the user simply picked a file that is too big.
 */
export function attachmentErrors(label) {
  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  return (err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'file_too_large' });
    console.error(`[${label}]`, err);
    res.status(500).json({ error: 'server_error' });
  };
}
