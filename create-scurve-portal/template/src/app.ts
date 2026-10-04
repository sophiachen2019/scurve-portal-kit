/* ─────────────────────────────────────────────────────
   __PLATFORM_TITLE__ Agent Portal — composition root.

   `portal_ui_standards.md` section 3: this file wires the modules and owns the
   session state. It contains no request logic — every call goes through
   `__PLATFORM__Service`, which with `apiClient` is the only module allowed to
   reach the network — and no markup beyond layout.

   This portal declares __PRIMARY_SURFACE__ as its primary surface. Section 5a
   records that the interaction model should follow the shape of the task, and
   that primary interaction model is deliberately *not* a conformance item:
   causal is conversation-first because its product is a gated 14-stage
   workflow, forecasting is workbench-first because it is iterative comparison,
   predictive is dual-mode because artifact review wants both. Declaring it is
   the conformance item; which one you declare is yours.
   ───────────────────────────────────────────────────── */

import {
  createArtifactView,
  createConnectionBadge,
  createConversation,
/* IF:workbench */
  createPhaseTrack,
/* ENDIF:workbench */
  createResizeHandle,
/* IF:dual */
  createSurfaceMode,
/* ENDIF:dual */
  downloadArtifact,
  brandMarkup,
  renderAgentMarkdown,
  operatorMessage,
} from '@scurve/portal-kit';

import { PREF, api, onSessionExpired } from './apiClient';
import * as platform from './__PLATFORM__Service';
import { renderArtifactBody } from './views/artifactBody';
import './styles.css';

// ── State ────────────────────────────────────────────
let sessionId: string | null = null;
let datasetId: string | undefined;

const $ = (id: string) => document.getElementById(id);

// ── Shell chrome, section 5a item 1 ──────────────────
const brand = $('brand');
if (brand) {
  brand.innerHTML = brandMarkup({
    name: '__PLATFORM_TITLE__ Agent',
    suffix: 'Platform',
    byline: 'by S-Curve Data',
    logoSrc: './logo.png',
  });
}

const connection = createConnectionBadge({
  dot: $('connectionDot'),
  label: $('connectionLabel'),
});

// ── Artifacts, section 5a item 3 ─────────────────────
const artifacts = createArtifactView({
  list: $('artifactList'),
  renderBody: renderArtifactBody,
  counters: [$('artifactCount')],
  emptyState: document.querySelector<HTMLElement>('.artifact-empty'),
  renderEmptyState: () =>
    '<div class="artifact-empty">Artifacts will appear here as the agent produces them.</div>',
  collapse: { mode: 'class', trigger: 'title', arrow: { open: '▼', closed: '▶' } },
  expandable: true,
  download: downloadArtifact,
});

createResizeHandle({
  handle: $('artifactResizeHandle'),
  panel: $('artifactPanel'),
  edge: 'right',
  bounds: () => ({ min: 320, max: Math.min(window.innerWidth - 360, 880) }),
  bodyClass: 'resizing-artifacts',
  // Persisted under scurve.__PLATFORM__.artifactWidth, per section 4.2.
  onCommit: (width) => api.store.writePref(PREF.artifactWidth, String(width)),
});

const savedWidth = Number(api.store.readPref(PREF.artifactWidth));
if (Number.isFinite(savedWidth) && savedWidth > 0) {
  const panel = $('artifactPanel');
  if (panel) panel.style.width = `${savedWidth}px`;
}

// ── Conversation, section 5a item 2 ──────────────────
const conversation = createConversation<{ label: string; action: string; params?: Record<string, unknown> }>({
  messages: $('conversationMessages'),
  welcome: $('conversationWelcome'),
  renderMarkdown: renderAgentMarkdown,
  onArtifactChip: (artifactId) => artifacts.scrollTo(artifactId),
  composer: {
    input: $('conversationInput') as HTMLInputElement | null,
    send: $('conversationSend'),
    // Checked before the field is cleared, so a message typed with no session
    // is not silently thrown away.
    canSubmit: () => Boolean(sessionId),
    onSubmit: (text) => {
      conversation.addUser(text);
      void send(text);
    },
  },
  suggestions: {
    container: $('conversationSuggestions'),
    hideWhenEmpty: true,
    normalize: (item) => ({
      action: item.action,
      label: item.label || item.action,
      params: item.params ?? {},
    }),
    onAction: (action, params) => void run(action, params),
  },
});

/* IF:workbench */
// ── Phase track, section 5a item 4 ───────────────────
// Where a platform exposes a gated workflow, progress renders with the same
// component and the same gate semantics. `paused` is the platform waiting for
// the operator; `blocked` is the run unable to continue. They must never
// render the same — telling an operator their run failed when it is waiting
// for them is the mistake this vocabulary exists to prevent.
const phaseTrack = createPhaseTrack({
  phases: {
    elements: () => document.querySelectorAll<HTMLElement>('.phase-step'),
    groups: {
      prepare: ['data_onboarding', 'data_inspection'],
      run: ['analysis'],
      review: ['interpretation', 'report'],
    },
    titleSelector: '.phase-title',
  },
  onGate: ({ state, nextActions }) => {
    // Section 5: a blocked state must always render what would unblock it,
    // never a bare red indicator. The agent standard requires specialists to
    // return that string; a UI that discards it recreates the dead end.
    if (nextActions.length === 0) return;
    conversation.addSystem(
      `${state === 'blocked' ? 'Blocked' : 'Waiting on you'}: ${nextActions.join(' · ')}`,
      { error: state === 'blocked' },
    );
  },
});
/* ENDIF:workbench */

/* IF:dual */
// ── Surface mode, section 5a item 5 ──────────────────
// Both surfaces, with predictive's explicit toggle rather than a third
// arrangement invented here.
const surfaceMode = createSurfaceMode({
  primary: '__PRIMARY_SURFACE__',
  dual: true,
  toggle: $('surfaceMode'),
  classNames: { active: '' },
  paint: { bodyAttribute: 'surface' },
  store: {
    read: () => api.store.readPref(PREF.surfaceMode),
    write: (value) => api.store.writePref(PREF.surfaceMode, value),
  },
  queryParameter: 'mode',
  onChange: (mode) => {
    const workbench = $('workbenchPanel');
    const conversationPanel = $('conversationPanel');
    if (workbench) workbench.hidden = mode !== 'workbench';
    if (conversationPanel) conversationPanel.hidden = mode !== 'conversation';
  },
});
surfaceMode.start();
/* ENDIF:dual */

// ── Flow ─────────────────────────────────────────────

/** The single place an agent response updates every surface. */
function handleResponse(response: platform.AgentResponse): void {
  conversation.addAgent(response.message, response.artifacts ?? []);
  conversation.setSuggestions(response.suggested_actions ?? []);
  artifacts.addAll(response.artifacts ?? [], {
    step: response.workflow_state?.current_step,
  });
/* IF:workbench */
  phaseTrack.update(
    response.workflow_state
      ? {
          ...response.workflow_state,
          // The platform reports a block as a reason string; the kit's
          // vocabulary wants the flag alongside it.
          blocked: Boolean(response.workflow_state.blocked_reason),
          next_actions: response.workflow_state.blocked_reason
            ? [response.workflow_state.blocked_reason]
            : undefined,
        }
      : null,
  );
/* ENDIF:workbench */
}

async function send(text: string): Promise<void> {
  if (!sessionId) return;
  conversation.setBusy(true);
  // Section 4.5: running work renders distinctly from a finished result, so
  // the operator is never shown a conclusion the platform has not returned.
  conversation.showPending('Working…');
  try {
    handleResponse(await platform.sendMessage(sessionId, text, datasetId));
  } catch (error) {
    conversation.addSystem(operatorMessage(error), { error: true });
  } finally {
    conversation.clearPending();
    conversation.setBusy(false);
  }
}

async function run(action: string, params: Record<string, unknown>): Promise<void> {
  if (!sessionId) return;
  conversation.addSystem(`Running: ${action}…`);
  conversation.setBusy(true);
  conversation.showPending('Executing workflow step…');
  try {
    handleResponse(await platform.runAction(sessionId, action, datasetId, params));
  } catch (error) {
    conversation.addSystem(operatorMessage(error), { error: true });
  } finally {
    conversation.clearPending();
    conversation.setBusy(false);
  }
}

/** The kit has already discarded the rejected token; drop the session built on it. */
onSessionExpired(() => {
  sessionId = null;
  connection.set('disconnected');
});

async function start(): Promise<void> {
  const health = await platform.warmBackend();
  connection.set(health.reachable ? 'connected' : 'disconnected');
  if (!health.reachable) {
    // `message` is only set when unreachable, so it is optional on the type.
    // The fallback is the section 4.4 wording, never a bare status code.
    conversation.addSystem(
      health.message ?? 'The service is unavailable. Check that the server is running, then retry.',
      { error: true },
    );
    return;
  }

  try {
    const session = await platform.createSession(datasetId);
    sessionId = session.session_id;
    conversation.setBusy(false);
    conversation.addSystem('Session started.');
  } catch (error) {
    conversation.addSystem(operatorMessage(error), { error: true });
  }
}

void start();
