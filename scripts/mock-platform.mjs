/*
 * A deterministic stand-in for an agent platform, for verifying a portal.
 *
 * Why this exists rather than running the real backend. Proving that section 9
 * step 5 left three shipped portals rendering exactly as they did means
 * diffing the DOM before and after, and a diff only means something if the
 * page state is identical on both sides. The real agents are LLM-backed: two
 * runs of the same prompt return different prose, a different artifact set and
 * sometimes a different stage order, so the diff would be full of noise that
 * has nothing to do with the change. Replaying fixed responses makes any
 * difference attributable.
 *
 * It also turns the states that are awkward to reach into fixtures: a stage
 * paused at a gate, a blocked run carrying what would unblock it, a 401, a
 * queued job. Driving a real causal run to a blocked assumption check on
 * demand is slow and fiddly.
 *
 * What it does NOT do is prove the response shapes are right — a fixture only
 * ever agrees with whatever it was written to agree with. So every shape below
 * is taken from the platform's own schema, cited inline, and a real backend
 * still gets a smoke pass. Both, with different jobs.
 *
 * Usage:
 *     node scripts/mock-platform.mjs --platform causal --port 8080
 *     node scripts/mock-platform.mjs --platform causal --scenario blocked
 *
 * Then point the portal at it; the kit resolves the base per section 4.1:
 *     VITE_API_BASE=http://127.0.0.1:8080 npm run dev
 *
 * Not shipped: `scripts/` is outside the package `files` list.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}
const PLATFORM = args.get('platform') ?? 'causal';
const PORT = Number(args.get('port') ?? 8080);
const SCENARIO = args.get('scenario') ?? 'happy';

/*
 * Fixed so a snapshot taken before a change matches one taken after. Anything
 * derived from Date.now() or a random id would differ between the two runs for
 * reasons that are not the change under test — which is the whole point of
 * this file. `dom-snapshot.js` also masks ids and timestamps, belt and braces.
 */
const SESSION_ID = 'sess-000000000000000000000001';
const DATASET_ID = 'ds-000000000000000000000001';
const CREATED_AT = '2026-01-01T00:00:00+00:00';

/*
 * causal_agent_platform/causal_core/schemas.py: WorkflowState is
 * {current_step, completed_steps, blocked_reason, selected_variables,
 * last_artifact_ids}. Note `blocked_reason` — the platform has carried a
 * blocked signal all along and the portal's phase track never read it, which
 * is the section 5 defect pattern ("a blocked state must always render what
 * would unblock it"). The `blocked` scenario below is what makes that visible.
 */
function workflowState(step, completed, extra = {}) {
  return {
    current_step: step,
    completed_steps: completed,
    blocked_reason: null,
    selected_variables: {},
    last_artifact_ids: [],
    ...extra,
  };
}

/*
 * causal_agent_platform/causal_core/schemas.py: Artifact is
 * {id, type, title, payload, mime_type, created_at}, and ArtifactType is one
 * of table/chart/report/dataset/text/code/image/variable_editor. Several
 * types are covered on purpose: the type is rendered as a badge class, so a
 * single-type fixture would not exercise the badge at all.
 */
function artifact(id, type, title, payload = {}) {
  return { id, type, title, payload, mime_type: null, created_at: CREATED_AT };
}

/*
 * causal_agent_platform/agent/service.py `_suggested_actions`: a list of
 * {label, action} dicts. `params` is absent there but the portal reads
 * `action.params || {}`, so one fixture carries it to cover both.
 */
const SCENARIOS = {
  /** A normal mid-run response: prose, artifacts, progress, next actions. */
  happy: {
    message: [
      '## Dataset profiled',
      '',
      'The dataset has **3,051 rows** across 12 columns. Treatment assignment',
      'looks observational, so `signup_channel` and `plan_tier` are candidate',
      'confounders.',
      '',
      '| Column | Role | Missing |',
      '| --- | --- | --- |',
      '| revenue_30d | outcome | 0.0% |',
      '| used_feature | treatment | 0.0% |',
      '| plan_tier | confounder | 1.2% |',
      '',
      '- Temporal coverage is complete.',
      '- No duplicate unit-period rows.',
    ].join('\n'),
    workflow_state: workflowState('data_quality', ['data_onboarding', 'data_inspection']),
    artifacts: [
      artifact('art-profile', 'table', 'Column profile', {
        headers: ['Column', 'Role', 'Missing'],
        rows: [
          ['revenue_30d', 'outcome', 0],
          ['used_feature', 'treatment', 0],
          ['plan_tier', 'confounder', 0.012],
        ],
      }),
      artifact('art-dist', 'chart', 'Outcome distribution', {
        chart_type: 'histogram',
        x: [1, 2, 3, 4, 5],
        y: [10, 42, 88, 40, 9],
      }),
      artifact('art-notes', 'text', 'Profiling notes', {
        content: 'Observational assignment; adjust before estimating.',
      }),
    ],
    suggested_actions: [
      { label: '🛡️ Check Data Quality', action: 'check_data_quality' },
      { label: '📊 Run EDA', action: 'run_eda' },
      // Carries params, which the bare-string portals never produce.
      { label: '✅ Confirm variables', action: 'confirm_variables', params: { outcome: 'revenue_30d' } },
      // Filtered out by the portal: the chip would be a dead end, because the
      // file picker only opens from the sidebar and the import modal.
      { label: 'Upload dataset', action: 'upload_dataset' },
    ],
  },

  /**
   * A gate. Several of causal's 14 stages stop for human judgment, and section
   * 5a item 4 requires paused to render differently from blocked — a gate is
   * the platform waiting for the operator, not a failure.
   */
  paused: {
    message: 'Assumption checks need your decision before estimation continues.',
    workflow_state: workflowState(
      'assumption_checking',
      ['data_onboarding', 'data_inspection', 'data_quality', 'eda', 'variable_confirmation', 'causal_dag'],
      { paused: true, next_actions: ['Override the parallel-trends assumption', 'Revise the method'] },
    ),
    artifacts: [
      artifact('art-assumptions', 'table', 'Assumption checks', {
        headers: ['Check', 'Status'],
        rows: [
          ['Parallel trends', 'warning'],
          ['Overlap', 'pass'],
        ],
      }),
    ],
    suggested_actions: [
      { label: 'Override assumptions', action: 'override_assumptions' },
      { label: 'Revise method', action: 'select_method' },
    ],
  },

  /**
   * A blocked run. Section 5: this must render what would unblock it, never a
   * bare red indicator. `blocked_reason` is the platform's own field.
   */
  blocked: {
    message: 'Estimation could not run.',
    workflow_state: workflowState(
      'analysis',
      ['data_onboarding', 'data_inspection', 'data_quality', 'eda', 'variable_confirmation', 'causal_dag'],
      {
        blocked: true,
        blocked_reason: 'No pre-treatment periods for the treated unit.',
        next_actions: [
          'Supply an intervention date inside the observed range',
          'Choose a treated unit with pre-period coverage',
        ],
      },
    ),
    artifacts: [],
    suggested_actions: [
      { label: '📅 Input Intervention Date', action: 'prompt_intervention_date' },
      { label: 'Revise method', action: 'select_method' },
    ],
  },

  /**
   * The reply the portal adopts a server-generated dataset from.
   *
   * A demo or synthetic run produces its dataset on the platform, so the
   * portal learns the id from the artifact rather than from an upload
   * response — see `syncCurrentDatasetFromArtifacts`.
   */
  demoDataset: {
    message: 'Demo dataset generated. Profiling next.',
    workflow_state: workflowState('data_inspection', ['data_onboarding']),
    artifacts: [
      artifact('art-dataset', 'dataset', 'Campaign lift demo', {
        dataset_id: DATASET_ID,
        name: 'Campaign lift demo',
        rows: 3051,
      }),
    ],
    suggested_actions: [{ label: '🔍 Profile Dataset', action: 'profile_dataset' }],
  },

  /** No artifacts and nothing to suggest: the empty states. */
  empty: {
    message: 'Nothing to report yet.',
    workflow_state: workflowState('data_onboarding', []),
    artifacts: [],
    suggested_actions: [],
  },
};

function agentResponse(scenario) {
  const payload = SCENARIOS[scenario] ?? SCENARIOS.happy;
  return { session_id: SESSION_ID, ...payload };
}

// --- routing ---------------------------------------------------------------

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    // The portal is served from the Vite dev origin in development.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end(text);
}

/** Routes for causal, keyed `METHOD pathname` with `:id` wildcards. */
const CAUSAL_ROUTES = {
  'GET /health': () => ({ status: 'ok', service: 'causal-agent-platform' }),
  // api/routes/auth.py returns AuthVerifyOut; the kit requires a non-empty
  // `token` string and throws a configuration message without one.
  'POST /auth/frictionless-login': () => ({
    token: 'mock-token-causal',
    email: 'operator@example.com',
    tenant_id: 'mock-tenant',
  }),
  'GET /datasets': () => [{ dataset_id: DATASET_ID, name: 'Mock dataset', rows: 3051 }],
  // api/routes/agent.py create_session returns exactly these two fields.
  'POST /agent/sessions': () => ({ session_id: SESSION_ID, dataset_id: DATASET_ID }),
  'POST /agent/sessions/:id/messages': () => agentResponse(SCENARIO),
  /*
   * The action is read from the body because the portal's demo flow depends on
   * one specific reply: `startDemoWorkflow` looks for an artifact of type
   * `dataset` carrying `payload.dataset_id` and throws without it, so a
   * one-size response would stall the flow before any artifact rendered.
   */
  'POST /agent/sessions/:id/actions': (body, _params, url) => {
    if (body?.action === 'generate_demo_dataset') return agentResponse('demoDataset');
    return agentResponse(url.searchParams.get('scenario') ?? SCENARIO);
  },
  'POST /access-requests/feedback': () => ({ ok: true }),
  'POST /access-requests/contact': () => ({ ok: true }),
  // Telemetry is fire-and-forget; the portal swallows a failure here on
  // purpose, so answering 200 keeps the console clean.
  'POST /access-requests/telemetry': () => ({ ok: true }),
};

const ROUTES = { causal: CAUSAL_ROUTES };

function match(routes, method, pathname) {
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct, params: {} };
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, pattern] = key.split(' ');
    if (routeMethod !== method || !pattern.includes(':')) continue;
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    const ok = patternParts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = pathParts[index];
        return true;
      }
      return part === pathParts[index];
    });
    if (ok) return { handler, params };
  }
  return null;
}

const routes = ROUTES[PLATFORM];
if (!routes) {
  console.error(`No routes for platform "${PLATFORM}". Known: ${Object.keys(ROUTES).join(', ')}`);
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    json(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  /*
   * Serves the snapshot helper to the page under test.
   *
   * Both the before and after portal are different origins from this server
   * and neither serves files from this repo, so handing the helper out here is
   * what guarantees the two snapshots were taken by the same code. Loading it
   * from each portal's own tree instead would leave the comparison resting on
   * two copies being identical.
   */
  /*
   * Collects a snapshot from the page under test.
   *
   * The before and after portals are two origins, so a snapshot taken in one
   * cannot be read from the other. Posting both here puts them side by side as
   * files that `diff` can compare, which keeps the comparison out of the
   * browser and reviewable afterwards.
   */
  if (url.pathname.startsWith('/__snapshot/') && request.method === 'POST') {
    const name = url.pathname.slice('/__snapshot/'.length).replace(/[^a-z0-9_-]/gi, '');
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const file = join('/tmp', `snapshot-${name}.txt`);
      writeFileSync(file, Buffer.concat(chunks));
      console.log(`  snapshot ${name} -> ${file}`);
      json(response, 200, { ok: true, file, bytes: Buffer.concat(chunks).length });
    });
    return;
  }

  if (url.pathname === '/__dom-snapshot.js') {
    const source = readFileSync(join(HERE, 'dom-snapshot.js'), 'utf8');
    response.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    response.end(source);
    return;
  }
  const body = [];
  request.on('data', (chunk) => body.push(chunk));
  request.on('end', () => {
    const found = match(routes, request.method ?? 'GET', url.pathname);
    if (!found) {
      console.log(`  ${request.method} ${url.pathname} -> 404 (no fixture)`);
      // Shaped like the platform's own errors so the kit maps it per 4.4.
      json(response, 404, { detail: `No mock fixture for ${request.method} ${url.pathname}` });
      return;
    }

    let parsed = null;
    if (body.length > 0) {
      try {
        parsed = JSON.parse(Buffer.concat(body).toString('utf8'));
      } catch {
        parsed = null;
      }
    }

    console.log(`  ${request.method} ${url.pathname} -> 200`);
    json(response, 200, found.handler(parsed, found.params, url));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock ${PLATFORM} platform on http://127.0.0.1:${PORT}  scenario=${SCENARIO}`);
  console.log(`scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
});
