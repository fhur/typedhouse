export class ValidationError extends Error {
  constructor(readonly code: string, readonly node: unknown, readonly path: string, detail = '') {
    super(`${code} at ${path}: ${detail}`); this.name = 'ValidationError';
  }
}
