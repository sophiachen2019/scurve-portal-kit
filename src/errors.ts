/**
 * One mapping from transport outcome to operator-facing text.
 *
 * `portal_ui_standards.md` section 4.4 fixes this table so the same failure
 * reads the same way in every portal, and forbids surfacing a raw stack trace
 * or a bare status code to an operator.
 */

export type PortalErrorKind =
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'unauthorized'
  | 'forbidden'
  | 'request'
  | 'server'
  | 'unsupported'
  | 'invalid-response';

/** Operator-facing text for each transport outcome. Section 4.4. */
export const OPERATOR_MESSAGES: Record<PortalErrorKind, string> = {
  unavailable:
    'The service is unavailable. Check that the server is running, then retry.',
  timeout:
    'The service is unavailable. Check that the server is running, then retry.',
  cancelled: 'The request was cancelled.',
  unauthorized: 'The access token is expired or invalid. Reconnect to continue.',
  forbidden: 'This account lacks permission for this action.',
  request: 'The request could not be completed. Review the values, then retry.',
  server:
    'The service failed to process the request. Retry, then check the server logs.',
  unsupported: 'This platform does not support that action.',
  'invalid-response':
    'The service returned a response this portal could not read. Check the configured API address, then retry.',
};

export interface PortalErrorOptions {
  /** HTTP status, when the failure reached the server and came back. */
  status?: number;
  /** The `detail` string a backend returned, when it sent one. */
  detail?: string;
  /** Request path, for telemetry. Never shown to an operator. */
  path?: string;
  /** Underlying cause, kept for logs only. */
  cause?: unknown;
  /** Replaces the mapped text. Use only for a message already operator-safe. */
  message?: string;
}

/**
 * An error whose `message` is always safe to render to an operator.
 *
 * `cause` holds the original failure for logging; it is deliberately not part
 * of the message.
 */
export class PortalError extends Error {
  readonly kind: PortalErrorKind;
  readonly status?: number;
  readonly detail?: string;
  readonly path?: string;

  constructor(kind: PortalErrorKind, options: PortalErrorOptions = {}) {
    super(options.message ?? OPERATOR_MESSAGES[kind], { cause: options.cause });
    this.name = 'PortalError';
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
    this.path = options.path;
  }
}

/**
 * Builds the error for a response the portal received.
 *
 * `detail` is shown verbatim for a 4xx, because a backend 4xx detail is
 * written for the operator ("Enter a valid email address"). A 5xx detail is
 * not: it describes an internal failure, so the generic 5xx text is used and
 * the detail is kept on the error for logs.
 */
export function errorForStatus(
  status: number,
  detail?: unknown,
  options: Omit<PortalErrorOptions, 'status' | 'detail' | 'message'> = {},
): PortalError {
  const text = typeof detail === 'string' && detail.trim() ? detail.trim() : undefined;
  const base = { ...options, status, detail: text };

  if (status === 401) return new PortalError('unauthorized', base);
  if (status === 403) return new PortalError('forbidden', base);
  if (status >= 500) return new PortalError('server', base);
  if (status >= 400) {
    return new PortalError('request', text ? { ...base, message: text } : base);
  }
  return new PortalError('invalid-response', base);
}

export function isPortalError(value: unknown): value is PortalError {
  return value instanceof PortalError;
}

export function isUnauthorized(value: unknown): boolean {
  return isPortalError(value) && value.kind === 'unauthorized';
}

export function isUnavailable(value: unknown): boolean {
  return (
    isPortalError(value) && (value.kind === 'unavailable' || value.kind === 'timeout')
  );
}

/**
 * Coerces anything thrown into text that is safe to show an operator.
 *
 * A portal catch block receives `unknown`. Rendering `String(error)` risks
 * putting a stack trace or `[object Object]` on screen, so unrecognised values
 * collapse to the generic failure text.
 */
export function operatorMessage(error: unknown, fallback?: string): string {
  if (isPortalError(error)) return error.message;
  // A plain Error raised by portal code carries an authored message.
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback ?? OPERATOR_MESSAGES.request;
}
