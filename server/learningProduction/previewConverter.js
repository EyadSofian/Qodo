/**
 * PowerPoint → PDF, when the server can do it.
 *
 * Browsers cannot render a PPTX faithfully, and a review tool that shows the
 * wrong fonts in the wrong places is worse than none. The reliable review
 * format is a PDF, so a PowerPoint version gets a PDF preview one of two ways:
 *
 *   • the uploader attaches the PDF export PowerPoint and Keynote already make,
 *     from the version itself (`POST /versions/:id/preview`); or
 *   • this converter, when `LIBREOFFICE_PATH` points at a `soffice` binary.
 *
 * Conversion runs after the upload has committed and never blocks it. If it
 * fails, the version still exists and the uploader can attach a PDF by hand.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA as S, direct } from './db.js';
import * as blobs from './blobs.js';

export function converterConfigured() {
  return Boolean(process.env.LIBREOFFICE_PATH);
}

function run(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      // LibreOffice writes a user profile; a throwaway HOME keeps concurrent
      // conversions from fighting over one.
      env: { ...process.env, HOME: cwd },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString().slice(0, 2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`converter exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function convert(version) {
  const bytes = await blobs.load(version.storage_key);
  if (!bytes) return;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-preview-'));
  try {
    const extension = version.mime_type === 'application/vnd.ms-powerpoint' ? 'ppt' : 'pptx';
    const input = path.join(directory, `slides.${extension}`);
    await fs.writeFile(input, bytes);
    await run(process.env.LIBREOFFICE_PATH, ['--headless', '--convert-to', 'pdf', '--outdir', directory, input], {
      cwd: directory,
      timeoutMs: 120_000,
    });
    const pdf = await fs.readFile(path.join(directory, 'slides.pdf'));
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('converter did not produce a PDF');

    const key = await blobs.store(pdf);
    const name = `${String(version.file_name ?? 'slides').replace(/\.[^.]+$/, '')}.pdf`;
    const updated = await direct.row(
      `UPDATE ${S}.learning_asset_versions
          SET preview_storage_key = $2, preview_file_name = $3, preview_mime_type = 'application/pdf', preview_file_size = $4
        WHERE id = $1 AND preview_storage_key IS NULL
        RETURNING id`,
      [version.id, key, name, pdf.length]
    );
    if (!updated) await blobs.discard(key);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** Fire and forget, after the upload has committed. */
export function schedulePreview(version) {
  if (!converterConfigured() || !version?.storage_key) return;
  setImmediate(() => {
    convert(version).catch((error) => {
      console.error('[learning-production] PDF preview was not generated —', error.message);
    });
  });
}
