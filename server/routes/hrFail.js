import { HRWorkbookError } from '../hrWorkbook.js';
import { HRError } from '../hr/errors.js';

/**
 * One way every HR route answers an error: the code (and its details) for a
 * refusal the module meant, a 500 for anything else. Details never carry a
 * stack or a secret — they are the capacity picture, the missing fields, the
 * allowed band.
 */
export function fail(res, error, label = 'hr') {
  if (error instanceof HRError || error instanceof HRWorkbookError) {
    return res.status(error.status).json({ error: error.code, ...(error.details ?? {}) });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'hr_file_too_large' });
  console.error(`[${label}]`, error);
  return res.status(500).json({ error: 'server_error' });
}

/** Wrap an async handler so a thrown error always becomes a response. */
export const handle = (fn, label) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (error) {
    fail(res, error, label);
  }
};
