/**
 * The one error HR V2 throws on purpose. Routes turn it into
 * `{ error: code, ...details }` with its status; anything else is a 500.
 */
export class HRError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.name = 'HRError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const forbidden = (missing) => new HRError('forbidden', 403, missing ? { missing } : null);
export const notFound = (code = 'not_found') => new HRError(code, 404);
