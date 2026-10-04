/**
 * @scurve/portal-kit — shared front-end code for the S-Curve Data agent
 * platform portals.
 *
 * The governing specification is `portal_ui_standards.md` in the
 * `autonomous-data-team` repo. Section 4 fixes the API client contract this
 * module implements; a portal that reimplements any part of it is
 * non-conforming.
 */

export {
  ApiClient,
  createApiClient,
  type ApiClientOptions,
  type AuthMode,
  type DemoSessionOptions,
  type RequestOptions,
  type UnauthorizedContext,
} from './apiClient.js';

export {
  normalizeBase,
  originRoot,
  readBuildTimeBase,
  resolveApiBase,
  RUNTIME_OVERRIDE_KEY,
  type BaseUrlOptions,
} from './baseUrl.js';

export {
  errorForStatus,
  isPortalError,
  isUnauthorized,
  isUnavailable,
  operatorMessage,
  OPERATOR_MESSAGES,
  PortalError,
  type PortalErrorKind,
  type PortalErrorOptions,
} from './errors.js';

export {
  KEY_NAMESPACE,
  TOKEN_KEY,
  TokenStore,
  WORKSPACE_KEYS_KEY,
  type LegacyKeyMigration,
  type StorageArea,
  type TokenStoreOptions,
} from './tokenStore.js';

export {
  AuthClient,
  BASE_CAPABILITIES,
  DEFAULT_ROLES,
  type AuthCapabilities,
  type AuthClientOptions,
  type AuthConfig,
  type Identity,
  type LoginRequest,
  type LoginResult,
  type Role,
} from './auth.js';

export {
  checkHealth,
  fetchHealth,
  type HealthOptions,
  type HealthPayload,
  type HealthResult,
} from './health.js';

export {
  isFailedJobState,
  isPendingJobState,
  jobStateTone,
  pollUntilSettled,
  startRefreshLoop,
  type JobState,
  type PollHandle,
  type PollOptions,
  type Progress,
  type RefreshLoop,
  type RefreshLoopOptions,
} from './poll.js';

import { ApiClient, type ApiClientOptions } from './apiClient.js';
import { AuthClient, type AuthClientOptions } from './auth.js';

export interface PortalClientOptions extends ApiClientOptions {
  /** Which auth endpoints this platform serves. Section 4.3. */
  auth?: AuthClientOptions;
}

export interface PortalClient {
  api: ApiClient;
  auth: AuthClient;
}

/**
 * Builds the API client and the auth client a portal needs, sharing one token
 * store and one resolved base URL.
 *
 * ```ts
 * export const { api, auth } = createPortalClient({
 *   platform: 'predictive',
 *   legacyTokenKeys: [{ from: 'pml-token', area: 'session' }],
 *   auth: { capabilities: { config: true, logout: true, me: true } },
 * });
 * ```
 */
export function createPortalClient(options: PortalClientOptions): PortalClient {
  const api = new ApiClient(options);
  return { api, auth: new AuthClient(api, options.auth) };
}
