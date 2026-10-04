/**
 * The shared health check.
 *
 * All three backends serve `/health` at the application root rather than under
 * the API prefix, so the path is resolved against the origin root. A portal
 * that appends `/health` to its API base reaches `/api/health` and reports a
 * healthy service as unreachable.
 */

import type { ApiClient } from './apiClient.js';
import { operatorMessage } from './errors.js';

export interface HealthPayload {
  status?: string;
  service?: string;
  environment?: string;
  [key: string]: unknown;
}

export interface HealthResult {
  reachable: boolean;
  /** The parsed body when reachable. */
  payload?: HealthPayload;
  /** Operator-facing text when not reachable. Section 4.4. */
  message?: string;
}

export interface HealthOptions {
  path?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Throws on failure, for a caller that wants the mapped error. */
export async function fetchHealth(
  client: ApiClient,
  options: HealthOptions = {},
): Promise<HealthPayload> {
  return client.request<HealthPayload>(options.path ?? '/health', {
    authMode: 'none',
    atOriginRoot: true,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

/**
 * Never throws — a connection badge should not need a try/catch.
 *
 * Returns `reachable: false` with operator text so the badge can render the
 * reason rather than a bare red dot.
 */
export async function checkHealth(
  client: ApiClient,
  options: HealthOptions = {},
): Promise<HealthResult> {
  try {
    return { reachable: true, payload: await fetchHealth(client, options) };
  } catch (error) {
    return { reachable: false, message: operatorMessage(error) };
  }
}
