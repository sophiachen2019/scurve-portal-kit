/**
 * The shared API client. `portal_ui_standards.md` section 4.
 *
 * The kit owns base URL resolution (4.1), token storage (4.2), the auth
 * protocol (4.3), the error mapping (4.4) and the polling helper (4.5).
 * A portal that reimplements one of those is non-conforming.
 */

import { resolveApiBase, originRoot, type BaseUrlOptions } from './baseUrl.js';
import { PortalError, errorForStatus } from './errors.js';
import { TokenStore, type TokenStoreOptions } from './tokenStore.js';

/** How a request authenticates itself. */
export type AuthMode =
  /** `Authorization: Bearer <token>` from the token store. The default. */
  | 'bearer'
  /** A demo-session header instead of a bearer token. */
  | 'demo'
  /** No credential at all, for login and health. */
  | 'none';

export interface DemoSessionOptions {
  /** Header the backend reads. Forecasting uses `X-Demo-Session`. */
  header?: string;
  /** Preference name the session id is stored under. */
  prefName?: string;
  /** Mints a new session id when none is stored. */
  mint?: () => string;
}

export interface UnauthorizedContext {
  path: string;
  error: PortalError;
}

export interface ApiClientOptions extends BaseUrlOptions, TokenStoreOptions {
  /** Shared store, when the portal already built one. */
  store?: TokenStore;
  /** Enables `authMode: 'demo'`. Omit on platforms with no demo surface. */
  demoSession?: DemoSessionOptions;
  /** Default request timeout. Section 4.5 requires one. */
  timeoutMs?: number;
  /**
   * Called when a request that carried a token comes back 401 and the token
   * has not changed since it was sent. The client has already cleared the
   * stored token; the portal resets its own state and prompts a reconnect.
   */
  onUnauthorized?: (context: UnauthorizedContext) => void;
  /** Paths exempt from `onUnauthorized`, since a 401 there is the answer. */
  authPathPrefix?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  /** Serialized as JSON unless it is already a `FormData` or a string. */
  body?: unknown;
  /** Overrides the stored token for this request. */
  token?: string;
  authMode?: AuthMode;
  headers?: Record<string, string>;
  /** Caller cancellation, separate from the timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Resolve against the origin root rather than the API base (`/health`). */
  atOriginRoot?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DEMO_HEADER = 'X-Demo-Session';
const DEFAULT_DEMO_PREF = 'demoSessionId';

function mintSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function isJsonBody(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  return typeof body !== 'string';
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export class ApiClient {
  /** Resolved per section 4.1. Read-only: a portal must not recompute it. */
  readonly baseUrl: string;
  /** Origin root, for endpoints outside the API prefix such as `/health`. */
  readonly originUrl: string;
  readonly store: TokenStore;
  readonly platform: string;

  private readonly options: ApiClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.platform = options.platform;
    this.baseUrl = resolveApiBase(options);
    this.originUrl = originRoot(this.baseUrl);
    this.store = options.store ?? new TokenStore(options);
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** The bearer token for the current session, after any legacy migration. */
  token(): string {
    return this.store.readToken();
  }

  setToken(token: string): void {
    this.store.writeToken(token);
  }

  clearToken(): void {
    this.store.clearToken();
  }

  /**
   * The demo session id, minted and persisted on first use.
   *
   * Forecasting's demo endpoints identify an anonymous visitor by this header
   * instead of a bearer token. It is a kit option so the demo surface does not
   * require a forked client.
   */
  demoSessionId(): string {
    const demo = this.options.demoSession;
    if (!demo) throw new PortalError('unsupported');
    const prefName = demo.prefName ?? DEFAULT_DEMO_PREF;
    const existing = this.store.readPref(prefName);
    if (existing) return existing;
    const minted = (demo.mint ?? mintSessionId)();
    this.store.writePref(prefName, minted);
    return minted;
  }

  url(path: string, atOriginRoot = false): string {
    const base = atOriginRoot ? this.originUrl : this.baseUrl;
    return path.startsWith('/') ? base + path : `${base}/${path}`;
  }

  /**
   * Performs a request and returns the parsed JSON body.
   *
   * Every failure arrives as a `PortalError` whose message is already the
   * operator text from section 4.4.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { response, sentToken } = await this.rawRequest(path, options);
    const payload = await this.readJson(response, path);
    if (!response.ok) {
      throw this.reportFailure(
        path,
        sentToken,
        errorForStatus(response.status, (payload as { detail?: unknown })?.detail, {
          path,
        }),
      );
    }
    return payload as T;
  }

  /**
   * Performs a request and returns the `Response` itself, for a body that is
   * not JSON (a CSV download, an evidence packet blob).
   *
   * A non-2xx response still throws the mapped error, so a caller never has to
   * inspect a status code.
   */
  async requestResponse(path: string, options: RequestOptions = {}): Promise<Response> {
    const { response, sentToken } = await this.rawRequest(path, options);
    if (!response.ok) {
      const detail = await response
        .clone()
        .json()
        .then((body: unknown) => (body as { detail?: unknown })?.detail)
        .catch(() => undefined);
      throw this.reportFailure(
        path,
        sentToken,
        errorForStatus(response.status, detail, { path }),
      );
    }
    return response;
  }

  /**
   * Returns the response together with the token it actually carried.
   *
   * The token has to travel with the response: `reportFailure` compares it
   * with the current one, and re-reading the store at failure time would
   * compare the new token with itself and clear a session the operator had
   * just reconnected.
   */
  private async rawRequest(
    path: string,
    options: RequestOptions,
  ): Promise<{ response: Response; sentToken: string }> {
    const authMode = options.authMode ?? 'bearer';
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = { ...options.headers };
    if (isJsonBody(options.body)) headers['Content-Type'] = 'application/json';

    const token = authMode === 'bearer' ? (options.token ?? this.token()) : '';
    if (authMode === 'bearer' && token) headers.Authorization = `Bearer ${token}`;
    if (authMode === 'demo') {
      const demo = this.options.demoSession;
      headers[demo?.header ?? DEFAULT_DEMO_HEADER] = this.demoSessionId();
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.url(path, options.atOriginRoot), {
        method,
        headers,
        body: serializeBody(options.body),
        signal: controller.signal,
      });
      return { response, sentToken: token };
    } catch (cause) {
      if (timedOut) throw new PortalError('timeout', { path, cause });
      if (options.signal?.aborted) throw new PortalError('cancelled', { path, cause });
      // A rejected fetch means the request never completed: DNS, TLS, CORS
      // preflight, or no server listening. Section 4.4 treats all of those the
      // same way, because the operator's next step is the same.
      throw new PortalError('unavailable', { path, cause });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private async readJson(response: Response, path: string): Promise<unknown> {
    if (response.status === 204) return {};
    try {
      return await response.json();
    } catch (cause) {
      // An ok response with an unreadable body is a configuration problem:
      // normally an index.html served where the API was expected.
      if (response.ok) throw new PortalError('invalid-response', { path, cause });
      return {};
    }
  }

  /**
   * Clears a token the server has rejected and tells the portal, once.
   *
   * The token is compared with the one the request carried so a reconnect that
   * raced an in-flight request is not undone by its late 401.
   */
  private reportFailure(
    path: string,
    sentToken: string,
    error: PortalError,
  ): PortalError {
    if (error.kind !== 'unauthorized') return error;

    const authPrefix = this.options.authPathPrefix ?? '/auth/';
    const stillCurrent = Boolean(sentToken) && sentToken === this.token();
    if (!stillCurrent || path.startsWith(authPrefix)) return error;

    this.clearToken();
    this.options.onUnauthorized?.({ path, error });
    return error;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
