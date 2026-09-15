/**
 * What a file really is.
 *
 * The extension and the browser's declared type are both whatever the uploader's
 * computer said, so neither is trusted on its own. The first bytes decide the
 * family (PDF, ZIP, OLE, MP3, RIFF, ISO media, WebM, Ogg, images); the
 * extension only chooses between members of a family the bytes cannot tell
 * apart — a ZIP is a PPTX only if it also contains `ppt/presentation.xml`.
 *
 * Limits are configurable per stage because a voice-over and a finished video
 * differ by two orders of magnitude, and one global cap is either useless for
 * one or dangerous for the other.
 */

export const KINDS = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PPTX' },
  ppt: { mime: 'application/vnd.ms-powerpoint', label: 'PPT' },
  mp3: { mime: 'audio/mpeg', label: 'MP3' },
  wav: { mime: 'audio/wav', label: 'WAV' },
  m4a: { mime: 'audio/mp4', label: 'M4A' },
  ogg: { mime: 'audio/ogg', label: 'OGG' },
  weba: { mime: 'audio/webm', label: 'WEBM' },
  mp4: { mime: 'video/mp4', label: 'MP4' },
  mov: { mime: 'video/quicktime', label: 'MOV' },
  webm: { mime: 'video/webm', label: 'WEBM' },
  png: { mime: 'image/png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', label: 'JPEG' },
  webp: { mime: 'image/webp', label: 'WEBP' },
};

/** What each upload target accepts. */
export const ACCEPTED = {
  PPT: ['pptx', 'ppt', 'pdf'],
  PREVIEW: ['pdf'],
  VOICE_OVER: ['mp3', 'wav', 'm4a', 'ogg', 'weba'],
  VIDEO: ['mp4', 'mov', 'webm'],
  COVER: ['png', 'jpeg', 'webp'],
};

/** Types a browser may play or show in place. Everything else downloads. */
export const INLINE_KINDS = new Set(['pdf', 'mp3', 'wav', 'm4a', 'ogg', 'weba', 'mp4', 'mov', 'webm', 'png', 'jpeg', 'webp']);

const MB = 1024 * 1024;

function envMegabytes(name, fallback) {
  const value = Number(process.env[name]);
  return Math.round((Number.isFinite(value) && value > 0 ? value : fallback) * MB);
}

export function uploadLimit(target) {
  switch (target) {
    case 'PPT':
    case 'PREVIEW':
      return envMegabytes('LEARNING_PRODUCTION_MAX_PPT_MB', 100);
    case 'VOICE_OVER':
      return envMegabytes('LEARNING_PRODUCTION_MAX_AUDIO_MB', 100);
    case 'VIDEO':
      return envMegabytes('LEARNING_PRODUCTION_MAX_VIDEO_MB', 300);
    case 'COVER':
      return 5 * MB;
    default:
      return 0;
  }
}

/** The largest body any upload route may receive — the parser's own cap. */
export function largestUploadLimit() {
  return Math.max(...Object.keys(ACCEPTED).map(uploadLimit));
}

function extensionOf(fileName) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(fileName ?? ''));
  return match ? match[1].toLowerCase() : '';
}

const startsWith = (buffer, bytes, offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (buffer, start, end) => buffer.subarray(start, end).toString('latin1');

/**
 * The kind of file these bytes are, for this target, or `null`.
 * `target` breaks the WebM tie: an audio-only WebM and a video WebM share a header.
 */
export function detectKind(buffer, fileName, target) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const extension = extensionOf(fileName);

  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';

  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return buffer.includes('ppt/presentation.xml') ? 'pptx' : null;
  }

  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return extension === 'ppt' || extension === 'pps' ? 'ppt' : null;
  }

  if (startsWith(buffer, [0x49, 0x44, 0x33])) return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && extension === 'mp3') return 'mp3';

  if (ascii(buffer, 0, 4) === 'RIFF') {
    const format = ascii(buffer, 8, 12);
    if (format === 'WAVE') return 'wav';
    if (format === 'WEBP') return 'webp';
    return null;
  }

  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (brand === 'M4A ' || brand === 'M4B ' || (extension === 'm4a' && target === 'VOICE_OVER')) return 'm4a';
    if (brand === 'qt  ') return 'mov';
    return target === 'VOICE_OVER' ? 'm4a' : 'mp4';
  }

  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return target === 'VOICE_OVER' ? 'weba' : 'webm';
  if (ascii(buffer, 0, 4) === 'OggS') return 'ogg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';

  return null;
}

/**
 * The file name kept for display. The bytes are stored under a generated key,
 * so this is a label only — but a label reaches a Content-Disposition header,
 * and separators and control characters have no business there.
 */
export function safeFileName(raw) {
  let name = String(raw ?? '');
  try {
    name = decodeURIComponent(name);
  } catch {
    /* not percent-encoded */
  }
  const flattened = [...name]
    .map((character) => {
      const code = character.codePointAt(0);
      return character === '"' || character === '/' || character === '\\' || code < 0x20 || code === 0x7f ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (flattened || 'file').slice(0, 180);
}
