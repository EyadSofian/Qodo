/**
 * Demo media, generated rather than shipped.
 *
 * The E-Learning Production demo needs files that are *really* a PDF, really a
 * WAV and really a PNG, because the module sniffs the first bytes of everything
 * it stores (`server/learningProduction/fileTypes.js`) and the review tools
 * render what they are given — a placeholder named `deck.pdf` that is not a PDF
 * would fail exactly where the demo is supposed to prove the feature works.
 *
 * Committing a binary fixture for every course would put megabytes of opaque
 * data in the repository for something only a developer ever sees. So each file
 * is written here, in a few dozen lines of arithmetic, from the same blueprint
 * that names the course.
 *
 * Development tooling. Nothing under `server/` imports this file.
 */

import zlib from 'node:zlib';

/* ── PNG ──────────────────────────────────────────────────────────── */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * A course cover: a diagonal wash between two brand-ish colours with a lighter
 * band across it, so seven courses in a grid are seven different pictures and
 * none of them is a stock photograph of a handshake.
 */
export function coverPng({ width = 640, height = 360, from, to, band }) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const diagonal = (x / width) * 0.65 + (y / height) * 0.35;
      // A soft repeating ripple keeps the wash from looking like a CSS gradient.
      const ripple = Math.sin((x / width) * 6.2 + (y / height) * 3.1) * 0.05;
      const mix = Math.max(0, Math.min(1, diagonal + ripple));
      const inBand = band && y > height * band.top && y < height * (band.top + band.height);
      const target = inBand ? band.color : to;
      const offset = 1 + x * 3;
      row[offset] = clamp(from[0] + (target[0] - from[0]) * mix);
      row[offset + 1] = clamp(from[1] + (target[1] - from[1]) * mix);
      row[offset + 2] = clamp(from[2] + (target[2] - from[2]) * mix);
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── PDF ──────────────────────────────────────────────────────────── */

/** Balanced parentheses and backslashes are PDF syntax; everything else is text. */
function pdfText(value) {
  return String(value ?? '')
    .replace(/[\\()]/g, (character) => `\\${character}`)
    // The base-14 fonts are Latin-1; anything outside it would draw as noise.
    .replace(/[^\x20-\x7e]/g, ' ');
}

/**
 * A slide deck as a PDF, 16:9, one page per slide.
 *
 * This is what a PPT asset's version *is* in the demo: the module accepts a PDF
 * for the PPT stage precisely so that a deck exported for review can be read
 * page by page, which is what the reviewer's annotation layer needs.
 */
export function slidesPdf({ title, slides }) {
  const objects = [];
  const pageIds = [];
  const fontId = 3 + slides.length * 2;

  slides.forEach((slide, index) => {
    const contentId = 4 + index * 2;
    const pageId = 3 + index * 2;
    pageIds.push(pageId);

    const lines = [
      `BT /F1 9 Tf 0.45 0.52 0.60 rg 48 486 Td (${pdfText(title)}) Tj ET`,
      `BT /F1 26 Tf 0.04 0.15 0.27 rg 48 430 Td (${pdfText(slide.title)}) Tj ET`,
      `1 0 0 RG 0.11 0.44 0.72 RG 48 414 m 220 414 l S`,
    ];
    slide.bullets.forEach((bullet, line) => {
      lines.push(`BT /F1 14 Tf 0.25 0.31 0.40 rg 56 ${372 - line * 30} Td (- ${pdfText(bullet)}) Tj ET`);
    });
    lines.push(`BT /F1 9 Tf 0.58 0.64 0.72 rg 48 40 Td (${index + 1} / ${slides.length}) Tj ET`);

    const stream = lines.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${slides.length} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id <= fontId; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* ── WAV ──────────────────────────────────────────────────────────── */

/**
 * A voice-over recording: speech-shaped, not speech.
 *
 * The audio reviewer draws a waveform, seeks, and pins comments to a second, so
 * the demo needs a file whose amplitude actually varies — silence would make
 * every marker land on a flat line. Phrases of a few seconds separated by short
 * pauses give it something to look like.
 *
 * 8 kHz mono keeps a forty-second clip around 640 KB, which matters when the
 * blueprint asks for several dozen of them.
 */
export function narrationWav({ seconds, seed = 1 }) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  let random = (seed >>> 0) || 1;
  const next = () => {
    random = (random * 1664525 + 1013904223) >>> 0;
    return random / 0xffffffff;
  };

  let phraseEnd = 0;
  let speaking = false;
  let pitch = 130;
  for (let index = 0; index < samples; index += 1) {
    if (index >= phraseEnd) {
      speaking = !speaking;
      phraseEnd = index + Math.round((speaking ? 1.6 + next() * 2.6 : 0.25 + next() * 0.5) * rate);
      pitch = 110 + next() * 70;
    }
    let value = 0;
    if (speaking) {
      const time = index / rate;
      // A syllable envelope over two harmonics — enough shape for a waveform.
      const syllable = 0.55 + 0.45 * Math.sin(time * 2 * Math.PI * 3.4);
      value = (Math.sin(time * 2 * Math.PI * pitch) * 0.6 + Math.sin(time * 2 * Math.PI * pitch * 2.1) * 0.25) * syllable * 0.42;
    }
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
