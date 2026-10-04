/**
 * Long-running work. `portal_ui_standards.md` section 4.5.
 *
 * A queued job is not a completed job — the same rule as
 * `specialist_agent_standards.md` section 7. The kit provides one polling
 * helper with a timeout and a cancel path. A portal must show queued and
 * running states distinctly from succeeded, and must never render a result the
 * platform has not returned.
 */

import { PortalError, operatorMessage } from './errors.js';

/** The job vocabulary all three platforms report. */
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

const PENDING_STATES: readonly string[] = ['queued', 'running', 'pending', 'leased'];
const FAILED_STATES: readonly string[] = ['failed', 'error', 'cancelled', 'expired'];

/** True while the platform has not produced a result. */
export function isPendingJobState(state: unknown): boolean {
  return typeof state === 'string' && PENDING_STATES.includes(state.toLowerCase());
}

export function isFailedJobState(state: unknown): boolean {
  return typeof state === 'string' && FAILED_STATES.includes(state.toLowerCase());
}

/**
 * The status token a job state renders with, so one word means one thing
 * across the whole system. See section 5 of the standards.
 *
 * - `ok` — completed and usable as evidence
 * - `warn` — completed but needs human review, or still in flight
 * - `risk` — blocked or errored; produced no usable result
 */
export function jobStateTone(state: unknown): 'ok' | 'warn' | 'risk' | 'neutral' {
  if (isFailedJobState(state)) return 'risk';
  if (isPendingJobState(state)) return 'warn';
  if (typeof state === 'string' && state.toLowerCase() === 'succeeded') return 'ok';
  return 'neutral';
}

/** What a single poll told us about the work. */
export type Progress<T> =
  | { settled: false; value: T }
  | { settled: true; outcome: 'succeeded' | 'failed'; value: T };

export interface PollOptions<T> {
  /** Fetches the current status. Rejections propagate unless `retryErrors`. */
  fetch: (signal: AbortSignal) => Promise<T>;
  /** Classifies a status. The only place "is it done" is decided. */
  classify: (value: T) => Progress<T>;
  /** Delay between polls. */
  intervalMs?: number;
  /** Give up after this long. Section 4.5 requires a timeout. */
  timeoutMs?: number;
  /** Called after every poll, including the settling one, for queued/running UI. */
  onProgress?: (progress: Progress<T>) => void;
  /**
   * Keep polling through a transport failure rather than rejecting. A brief
   * API interruption should not discard an operator's running job.
   */
  retryErrors?: boolean;
  /** External cancellation, in addition to the returned `cancel`. */
  signal?: AbortSignal;
}

export interface PollHandle<T> {
  /**
   * Resolves only with a settled status.
   *
   * It never resolves with a pending one, so a caller cannot accidentally
   * render a result the platform has not returned. Rejects with a
   * `PortalError` of kind `timeout` or `cancelled`.
   */
  readonly result: Promise<Progress<T> & { settled: true }>;
  /** The cancel path. Safe to call after settling. */
  cancel(): void;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/**
 * Polls until the work settles, the timeout elapses, or the caller cancels.
 *
 * ```ts
 * const watch = pollUntilSettled({
 *   fetch: (signal) => client.request(`/jobs/${id}`, { signal }),
 *   classify: (job) =>
 *     isPendingJobState(job.state)
 *       ? { settled: false, value: job }
 *       : { settled: true, outcome: isFailedJobState(job.state) ? 'failed' : 'succeeded', value: job },
 *   onProgress: (p) => renderJobState(p.value.state),
 * });
 * ```
 */
export function pollUntilSettled<T>(options: PollOptions<T>): PollHandle<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const run = async (): Promise<Progress<T> & { settled: true }> => {
    let lastError: unknown;
    try {
      while (!controller.signal.aborted) {
        try {
          const progress = options.classify(await options.fetch(controller.signal));
          options.onProgress?.(progress);
          if (progress.settled) return progress;
          lastError = undefined;
        } catch (error) {
          if (controller.signal.aborted) break;
          if (!options.retryErrors) throw error;
          lastError = error;
        }
        await sleep(intervalMs, controller.signal);
      }

      if (timedOut) {
        throw new PortalError('timeout', {
          message: lastError
            ? `The run did not finish in time. Last status check failed: ${operatorMessage(lastError)}`
            : 'The run did not finish in time. It may still be running — check the run list.',
          cause: lastError,
        });
      }
      throw new PortalError('cancelled', {
        message: 'Waiting for the run was cancelled. The run itself was not cancelled.',
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  };

  return { result: run(), cancel };
}

export interface RefreshLoopOptions {
  /** One refresh pass. Rejections are swallowed; see `onError`. */
  tick: () => Promise<void>;
  intervalMs: number;
  /**
   * Skip this pass without stopping the loop. Used to leave an operator's
   * open dialog, focused field or draft alone.
   */
  pause?: () => boolean;
  /** Observes a swallowed failure, for telemetry. */
  onError?: (error: unknown) => void;
}

export interface RefreshLoop {
  /** The cancel path. Idempotent. */
  stop(): void;
}

/**
 * A repeating background refresh with an explicit stop.
 *
 * Distinct from `pollUntilSettled`: this one never settles, so it takes no
 * timeout. A transport failure is swallowed, because a temporary API
 * interruption must not discard an operator's in-progress work; `onError`
 * exists so the failure is still observable.
 */
export function startRefreshLoop(options: RefreshLoopOptions): RefreshLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(pass, options.intervalMs);
  };

  const pass = async () => {
    if (stopped) return;
    if (options.pause?.()) {
      schedule();
      return;
    }
    try {
      await options.tick();
    } catch (error) {
      options.onError?.(error);
    }
    schedule();
  };

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
