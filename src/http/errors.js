export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const invalid = (message) => new AppError(400, 'INVALID_REQUEST', message);
export const provider = (message) => new AppError(503, 'PROVIDER_UNAVAILABLE', message);
export function publicError(error) {
  const status =
    error instanceof AppError
      ? error.status
      : [401, 429].includes(error.status)
        ? error.status
        : 500;
  return {
    status,
    code:
      status === 401
        ? 'UNAUTHORIZED'
        : status === 429
          ? 'RATE_LIMITED'
          : error instanceof AppError
            ? error.code
            : 'INTERNAL_ERROR',
    message:
      status === 500 ? 'An unexpected server error occurred. Please try again.' : error.message,
  };
}
// Allowlist fields: never log bodies, cookies, usernames, emails, tokens, or raw exceptions.
export function logRequest(fields, sink = console.log) {
  sink(
    JSON.stringify({
      event: 'http_request',
      requestId: fields.requestId,
      method: fields.method,
      path: fields.path,
      status: fields.status,
      durationMs: fields.durationMs,
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
    }),
  );
}
