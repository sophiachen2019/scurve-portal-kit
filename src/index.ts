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

// --- UX primitives, section 5a -------------------------------------------
//
// Five composable primitives, not a layout. Section 5a records that causal is
// conversation-first, forecasting workbench-first and predictive dual-mode,
// that the divergence follows the shape of the task, and that primary
// interaction model is deliberately not a conformance item. A portal declares
// which surface is primary and composes these; nothing here imposes an
// arrangement, and nothing here reaches the network.

export {
  clamp,
  cssEscape,
  element,
  escapeHtml,
  highlightElement,
  resolveClasses,
  scrollToEnd,
  slugifyDomId,
  type ClassMap,
  type HighlightOptions,
} from './primitives/dom.js';

export {
  renderAgentMarkdown,
  renderMarkdownWithMarked,
  type MarkdownOptions,
} from './primitives/markdown.js';

export {
  createConversation,
  dedupeActions,
  dedupeByAction,
  type ComposerOptions,
  type Conversation,
  type ConversationArtifactRef,
  type ConversationOptions,
  type ConversationSlot,
  type MessageKind,
  type PendingOptions,
  type SuggestionsOptions,
} from './primitives/conversation.js';

export {
  createArtifactView,
  createResizeHandle,
  downloadArtifact,
  type Artifact,
  type ArtifactGroup,
  type ArtifactSlot,
  type ArtifactView,
  type ArtifactViewOptions,
  type CollapseMode,
  type CollapseOptions,
  type ResizeHandle,
  type ResizeHandleOptions,
} from './primitives/artifacts.js';

export {
  createPhaseTrack,
  PHASE_TONE,
  phaseForStep,
  type PhaseSlot,
  type PhaseState,
  type PhaseTrack,
  type PhaseTrackOptions,
  type WorkflowState,
} from './primitives/phaseTrack.js';

export {
  createSurfaceMode,
  isSurfaceMode,
  SURFACE_MODES,
  type SurfaceMode,
  type SurfaceModeController,
  type SurfaceModeOptions,
  type SurfaceSlot,
} from './primitives/surfaceMode.js';

export {
  accessLabel,
  accessState,
  brandMarkup,
  CONNECTION_LABELS,
  CONNECTION_TONE,
  createConnectionBadge,
  type AccessLabelInput,
  type BrandOptions,
  type ConnectionBadge,
  type ConnectionBadgeOptions,
  type ConnectionSlot,
  type ConnectionState,
} from './primitives/shellChrome.js';

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
