/**
 * Portal product telemetry, in the portal instrumentation standard's lifecycle.
 *
 * The standard is `portal_instrumentation_standard.md` in the `autonomous-data-team` repo; the event contract is
 * `contracts/events.yaml` in product-data. Every agent portal reports the same moments with the same names, and
 * adds detail only through property values. A portal that writes its own client is non-conforming.
 *
 * - Off unless configured: with no collector address every call is a no-op.
 * - Categories only: every property is an enum, a catalog slug or a count. The types below are the contract's
 *   enums, so a free-text value does not compile; the collector rejects anything else.
 * - Shared identity: the browser's anonymous ID and its 30-minute session live in the same storage keys as the
 *   site's own script, so a visit from the home page into a portal is one session.
 * - One journey per page load, in every portal, so one funnel definition serves every agent.
 * - The run's outcome is the server's to report. The browser says a run was asked for, and passes the
 *   correlation headers so the server's run events join the journey.
 */

/** The agent portals the contract knows. */
export type PortalApp = 'forecasting' | 'experimentation' | 'causal' | 'predictive';
export type StartKind = 'demo' | 'template' | 'import_json' | 'import_csv' | 'upload' | 'synthetic';
export type AuthMethod = 'frictionless' | 'token' | 'sso';
export type ErrorKind = 'timeout' | 'service_unavailable' | 'validation' | 'auth' | 'unknown';
export type ReportFormat = 'csv' | 'json' | 'html' | 'markdown' | 'pdf';

/** Names this client may send. Agent-specific moments (plan approved, decision recorded) go through `event`. */
export type LifecycleEvent =
  | 'portal_opened'
  | 'signed_in'
  | 'error_shown'
  | 'case_started'
  | 'workflow_step_viewed'
  | 'run_requested'
  | 'result_viewed'
  | 'report_downloaded';

export interface TelemetryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PortalTelemetryOptions {
  /** The collector's address (build-time `VITE_PRODUCT_DATA_URL`). Empty disables telemetry. */
  endpoint?: string | null;
  app: PortalApp;
  /** The build's commit, so a launch can be told from the week before it. */
  release?: string;
  storage?: TelemetryStorage;
  fetchImpl?: typeof fetch;
  clock?: () => number;
  uuid?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export interface CorrelationHeaders {
  [header: string]: string;
}

export interface PortalTelemetry {
  readonly enabled: boolean;
  readonly journeyId: string | null;
  /** Once per page load, when the portal is usable (before sign-in). */
  portalOpened(): void;
  /** Once per page load, after sign-in. Never an email or an ID. */
  signedIn(method: AuthMethod): void;
  caseStarted(kind: StartKind, catalogId?: string): void;
  /** The first time each step appears in a page load. The step must be one the contract lists for this app. */
  stepViewed(step: string): void;
  /** Says a run was asked for, and returns the headers the backend reads to join the run to this journey. */
  runRequested(methodId?: string): CorrelationHeaders;
  /** Once per run: the result is on screen. */
  resultViewed(runId: string): void;
  reportDownloaded(format?: ReportFormat): void;
  /** What the visitor was shown, as a category. Once per kind and step in a page load. */
  errorShown(kind: ErrorKind, step?: string): void;
  /** Correlation headers for any API call, without announcing a run. */
  headers(requestId?: string): CorrelationHeaders;
  /** An agent's own registered event (for example `plan_approved`). */
  event(name: string, properties?: Record<string, unknown>, extra?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

const PREFIX = 'scurve.telemetry.';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SLUG = /^[a-z0-9_]{1,64}$/;

/** The kit's transport error kinds, as the category the visitor saw. */
export function errorKindFor(kind: string | undefined | null): ErrorKind {
  switch (kind) {
    case 'timeout':
      return 'timeout';
    case 'unavailable':
    case 'server':
    case 'invalid-response':
      return 'service_unavailable';
    case 'request':
    case 'unsupported':
      return 'validation';
    case 'unauthorized':
    case 'forbidden':
      return 'auth';
    default:
      return 'unknown';
  }
}

function noop(): PortalTelemetry {
  return {
    enabled: false,
    journeyId: null,
    portalOpened() {},
    signedIn() {},
    caseStarted() {},
    stepViewed() {},
    runRequested: () => ({}),
    resultViewed() {},
    reportDownloaded() {},
    errorShown() {},
    headers: () => ({}),
    event() {},
    flush: async () => {},
  };
}

export function createPortalTelemetry(options: PortalTelemetryOptions): PortalTelemetry {
  const endpoint = (options.endpoint ?? '').replace(/\/+$/, '');
  if (!endpoint) return noop();
  const app = options.app;
  const release = options.release && /^[a-zA-Z0-9_.-]{1,64}$/.test(options.release) ? options.release : 'pilot-v1';
  const clock = options.clock ?? Date.now;
  const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let storage = options.storage;
  if (!storage) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = undefined;
    }
  }
  const fallback = new Map<string, unknown>();
  const read = <T>(key: string): T | undefined => {
    try {
      const raw = storage?.getItem(PREFIX + key);
      return raw == null ? (fallback.get(key) as T | undefined) : (JSON.parse(raw) as T);
    } catch {
      return fallback.get(key) as T | undefined;
    }
  };
  const write = (key: string, value: unknown) => {
    fallback.set(key, value);
    try {
      storage?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* private window: the in-memory copy holds for this page */
    }
  };

  const anonymous = read<string>('anonymous_id') ?? uuid();
  write('anonymous_id', anonymous);
  const journey = uuid();
  const once = new Set<string>();
  let queue: Record<string, unknown>[] = [];
  let flushing = false;
  let attempts = 0;
  let timer: unknown = null;

  function identity() {
    let session = read<{ id: string; last: number }>('session');
    if (!session || clock() - session.last > SESSION_IDLE_MS) session = { id: uuid(), last: clock() };
    session.last = clock();
    write('session', session);
    return { anonymous_id: anonymous, session_id: session.id, journey_id: journey };
  }

  function schedule(ms: number) {
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, ms);
  }

  function event(name: string, properties: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    queue.push({
      event_id: uuid(),
      event_name: name,
      schema_version: 1,
      source_app: app,
      occurred_at: new Date(clock()).toISOString(),
      release_version: release,
      ...identity(),
      ...extra,
      properties,
    });
    if (queue.length > 100) queue.shift();
    schedule(300);
  }

  function first(key: string): boolean {
    if (once.has(key)) return false;
    once.add(key);
    return true;
  }

  function headers(requestId?: string): CorrelationHeaders {
    const values: Record<string, string> = { ...identity(), ...(requestId ? { request_id: requestId } : {}) };
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => ['X-Product-' + key.replaceAll('_', '-'), value]),
    );
  }

  async function flush(): Promise<void> {
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.slice(0, 20);
    try {
      const response = await fetchImpl(endpoint + '/v1/events/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Collection unavailable');
      const result = (await response.json()) as { results: { event_id: string; status: string }[] };
      // A rejected event is acknowledged too: resending it would be rejected again.
      const done = new Set(
        result.results.filter((r) => ['accepted', 'duplicate', 'rejected'].includes(r.status)).map((r) => r.event_id),
      );
      queue = queue.filter((e) => !done.has(e.event_id as string));
      attempts = 0;
    } catch {
      attempts += 1;
    } finally {
      flushing = false;
      if (queue.length && attempts < 5) schedule(attempts ? Math.min(30000, 500 * 2 ** attempts) : 300);
    }
  }

  return {
    enabled: true,
    journeyId: journey,
    portalOpened() {
      if (first('portal_opened')) event('portal_opened', { portal: app });
    },
    signedIn(method) {
      if (first('signed_in')) event('signed_in', { auth_method: method });
    },
    caseStarted(kind, catalogId) {
      event('case_started', { start_kind: kind, ...(catalogId && SLUG.test(catalogId) ? { catalog_id: catalogId } : {}) });
    },
    stepViewed(step) {
      if (first('step:' + step)) event('workflow_step_viewed', { workflow_step: step });
    },
    runRequested(methodId) {
      const requestId = uuid();
      event('run_requested', methodId && SLUG.test(methodId) ? { method_id: methodId } : {}, { request_id: requestId });
      return headers(requestId);
    },
    resultViewed(runId) {
      if (runId && first('result:' + runId)) event('result_viewed', {}, { run_id: runId });
    },
    reportDownloaded(format) {
      event('report_downloaded', format ? { format } : {});
    },
    errorShown(kind, step) {
      if (first(`error:${kind}:${step ?? ''}`)) event('error_shown', { error_kind: kind, ...(step ? { workflow_step: step } : {}) });
    },
    headers,
    event,
    flush,
  };
}
