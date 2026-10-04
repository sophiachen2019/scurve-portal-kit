/**
 * __PLATFORM__'s task area: every request this portal makes lives here.
 *
 * `portal_ui_standards.md` section 3: only `apiClient` and `*Service` modules
 * call the network, so the request and response shapes of __PLATFORM__'s
 * endpoints have one home and the views and the composition root have none.
 *
 * Errors are not caught here. The kit raises a `PortalError` whose message is
 * already the operator text from section 4.4; callers render it through
 * `operatorMessage` and decide where it goes on screen. Never catch an error
 * here just to re-throw a vaguer one.
 *
 * Replace the shapes below with your platform's own. They are the ones every
 * S-Curve agent platform already serves.
 */

import { checkHealth, type Artifact } from '@scurve/portal-kit';

import { api, auth } from './apiClient';

/** What an agent reply carries. All three existing platforms return this shape. */
export interface AgentResponse {
  session_id: string;
  message: string;
  artifacts?: Artifact[];
  suggested_actions?: { label: string; action: string; params?: Record<string, unknown> }[];
  workflow_state?: {
    current_step?: string;
    completed_steps?: string[];
    /** Set when the run cannot continue. Section 5 requires rendering it. */
    blocked_reason?: string | null;
  };
}

/**
 * Wakes a cold instance so the operator's first real request is not the one
 * that pays the start-up cost.
 *
 * `checkHealth` never throws and resolves `/health` against the origin root,
 * which is where the S-Curve backends serve it — a portal appending `/health`
 * to its API base reaches `/api/health` and reports a healthy service as
 * unreachable.
 */
export async function warmBackend() {
  return checkHealth(api);
}

/**
 * Connects the portal and proves the token works.
 *
 * Listing something afterwards is the check that the token is actually
 * accepted, rather than trusting a 200 from login alone.
 */
export async function connect(email: string) {
  const result = await auth.frictionlessLogin({ email });
  await listDatasets();
  return result;
}

export async function listDatasets(): Promise<unknown[]> {
  return api.request('/datasets');
}

export async function createSession(datasetId?: string): Promise<{ session_id: string }> {
  const path = datasetId
    ? `/agent/sessions?dataset_id=${encodeURIComponent(datasetId)}`
    : '/agent/sessions';
  return api.request(path, { method: 'POST' });
}

export async function sendMessage(
  sessionId: string,
  message: string,
  datasetId?: string,
): Promise<AgentResponse> {
  return api.request(`/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: { message, dataset_id: datasetId },
  });
}

/** Runs one workflow action — the path a gate takes when an operator clears it. */
export async function runAction(
  sessionId: string,
  action: string,
  datasetId?: string,
  params: Record<string, unknown> = {},
): Promise<AgentResponse> {
  return api.request(`/agent/sessions/${encodeURIComponent(sessionId)}/actions`, {
    method: 'POST',
    body: { action, dataset_id: datasetId, params },
  });
}
