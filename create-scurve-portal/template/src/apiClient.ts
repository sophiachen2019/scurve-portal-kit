/**
 * The portal's single network boundary, over `@scurve/portal-kit`.
 *
 * `portal_ui_standards.md` section 4 is the specification: the kit owns base
 * URL resolution, token storage, the auth protocol, the error mapping and the
 * polling helper. This module owns only what is specific to __PLATFORM__.
 *
 * Section 3's rule is that nothing outside this module and the `*Service`
 * modules may call `fetch`, name a storage key, or map an HTTP status to
 * operator text. A render function that fetches cannot be tested or reused.
 */

import {
  createPortalClient,
  operatorMessage,
  type Identity,
  type UnauthorizedContext,
} from '@scurve/portal-kit';

export const PLATFORM = '__PLATFORM__';

/** Preference names, so no caller spells a storage key itself. Section 4.2. */
export const PREF = {
  email: 'email',
  surfaceMode: 'surfaceMode',
  artifactWidth: 'artifactWidth',
} as const;

let reportUnauthorized: (context: UnauthorizedContext) => void = () => {};

/**
 * Registers the portal's reaction to a rejected token.
 *
 * The composition root owns what happens, so this module stays free of UI.
 */
export function onSessionExpired(handler: (context: UnauthorizedContext) => void): void {
  reportUnauthorized = handler;
}

const { api, auth } = createPortalClient({
  platform: PLATFORM,
  // Section 4.1: no deployed hostname in frontend source. It belongs in deploy
  // configuration. Read here so Vite substitutes it.
  buildTimeBase: import.meta.env.VITE_API_BASE,
  // Section 4.3: a platform that does not serve an endpoint gets a capability
  // flag, not a forked client. Turn these on as the backend grows them.
  auth: { capabilities: { config: false, logout: false, me: false } },
  onUnauthorized: (context) => reportUnauthorized(context),
});

export { api, auth, operatorMessage };
export type { Identity };

/** Resolved per section 4.1. Exported for display, never for building a URL. */
export const apiBase = api.baseUrl;
