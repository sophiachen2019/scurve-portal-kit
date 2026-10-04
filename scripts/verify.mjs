/**
 * Exercises the section 4 contract against stubbed transport and storage.
 *
 * Run with `node scripts/verify.mjs` after `npm run build`. This is not a test
 * framework; it is the evidence that the behaviours the standard names
 * actually hold, written so a reviewer can read what is being asserted.
 */

import assert from 'node:assert/strict';

// --- stubs ----------------------------------------------------------------

class MemoryStorage {
  #map = new Map();
  get length() {
    return this.#map.size;
  }
  key(index) {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    this.#map.set(key, String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
  snapshot() {
    return Object.fromEntries(this.#map);
  }
}

function resetStorage() {
  globalThis.window = globalThis.window ?? {};
  globalThis.window.localStorage = new MemoryStorage();
  globalThis.window.sessionStorage = new MemoryStorage();
  return { local: globalThis.window.localStorage, session: globalThis.window.sessionStorage };
}

/** Builds a fetch stub from a list of handlers, recording every call. */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length - 1);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(`  ok   ${name}`);
  } catch (error) {
    results.push(`  FAIL ${name}\n       ${error.message}`);
    process.exitCode = 1;
  }
}

const kit = await import('../dist/index.js');
const {
  ApiClient,
  AuthClient,
  TokenStore,
  PortalError,
  checkHealth,
  isPendingJobState,
  jobStateTone,
  operatorMessage,
  pollUntilSettled,
  resolveApiBase,
  createPortalClient,
} = kit;

// --- 4.1 base URL resolution ---------------------------------------------

await check('4.1 build-time variable wins', () => {
  resetStorage();
  globalThis.window.SCURVE_API_BASE = 'https://override.example/api';
  assert.equal(
    resolveApiBase({ buildTimeBase: 'https://build.example/api/' }),
    'https://build.example/api',
  );
  delete globalThis.window.SCURVE_API_BASE;
});

await check('4.1 runtime override is second', () => {
  resetStorage();
  globalThis.window.SCURVE_API_BASE = 'https://override.example/api/';
  assert.equal(resolveApiBase({ buildTimeBase: '' }), 'https://override.example/api');
  delete globalThis.window.SCURVE_API_BASE;
});

await check('4.1 a portal-specific override name is honoured', () => {
  resetStorage();
  globalThis.window.FORECASTING_API_BASE = 'https://legacy.example/api';
  assert.equal(
    resolveApiBase({ buildTimeBase: '', runtimeOverrideKeys: ['FORECASTING_API_BASE'] }),
    'https://legacy.example/api',
  );
  delete globalThis.window.FORECASTING_API_BASE;
});

await check('4.1 same-origin /api is the fallback', () => {
  resetStorage();
  assert.equal(resolveApiBase({ buildTimeBase: '' }), '/api');
});

await check('4.1 health resolves at the origin root, not under /api', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, { status: 'ok' }));
  const client = new ApiClient({
    platform: 'predictive',
    buildTimeBase: 'https://api.example/api',
    fetchImpl,
  });
  const health = await checkHealth(client);
  assert.equal(health.reachable, true);
  assert.equal(fetchImpl.calls[0].url, 'https://api.example/health');
});

// --- 4.2 token storage ----------------------------------------------------

await check('4.2 tokens land in sessionStorage under scurve.<platform>.token', () => {
  const { local, session } = resetStorage();
  const store = new TokenStore({ platform: 'predictive' });
  store.writeToken('tok-1');
  assert.equal(session.getItem('scurve.predictive.token'), 'tok-1');
  assert.equal(local.getItem('scurve.predictive.token'), null);
  assert.equal(store.readToken(), 'tok-1');
});

await check('4.2 prefs land in localStorage under scurve.<platform>.<key>', () => {
  const { local } = resetStorage();
  const store = new TokenStore({ platform: 'forecasting' });
  store.writePref('activeView', 'onboarding');
  assert.equal(local.getItem('scurve.forecasting.activeView'), 'onboarding');
});

await check('4.2 workspace keys land in localStorage under workspaceKeys', () => {
  const { local } = resetStorage();
  const store = new TokenStore({ platform: 'predictive' });
  const key = store.ensureWorkspaceKey('a@b.com', () => 'recovery-1');
  assert.equal(key, 'recovery-1');
  assert.equal(store.ensureWorkspaceKey('a@b.com', () => 'recovery-2'), 'recovery-1');
  assert.deepEqual(JSON.parse(local.getItem('scurve.predictive.workspaceKeys')), {
    'a@b.com': 'recovery-1',
  });
});

await check('4.2 legacy sessionStorage token migrates without logging the user out', () => {
  const { session } = resetStorage();
  session.setItem('pml-token', 'legacy-session-token');
  const store = new TokenStore({
    platform: 'predictive',
    legacyTokenKeys: [{ from: 'pml-token', area: 'session' }],
  });
  assert.equal(store.readToken(), 'legacy-session-token');
  assert.equal(session.getItem('pml-token'), null, 'legacy entry must be deleted');
  assert.equal(session.getItem('scurve.predictive.token'), 'legacy-session-token');
});

await check('4.2 legacy localStorage token moves to sessionStorage', () => {
  const { local, session } = resetStorage();
  local.setItem('forecasting_user_token', 'legacy-local-token');
  const store = new TokenStore({
    platform: 'forecasting',
    legacyTokenKeys: [{ from: 'forecasting_user_token', area: 'local' }],
  });
  assert.equal(store.readToken(), 'legacy-local-token');
  assert.equal(local.getItem('forecasting_user_token'), null);
  assert.equal(session.getItem('scurve.forecasting.token'), 'legacy-local-token');
});

await check('4.2 migration is idempotent across store instances', () => {
  const { local, session } = resetStorage();
  local.setItem('forecasting_user_token', 'legacy-local-token');
  const options = {
    platform: 'forecasting',
    legacyTokenKeys: [{ from: 'forecasting_user_token', area: 'local' }],
  };
  new TokenStore(options).readToken();
  session.setItem('scurve.forecasting.token', 'reconnected-token');
  // A second page load must not resurrect the deleted legacy value over the
  // token the operator has since obtained.
  assert.equal(new TokenStore(options).readToken(), 'reconnected-token');
});

await check('4.2 legacy prefs migrate to namespaced names', () => {
  const { local } = resetStorage();
  local.setItem('forecasting_active_view', 'forecasting');
  local.setItem('forecasting_state_weekly_active_users', '{"fitted":true}');
  const store = new TokenStore({
    platform: 'forecasting',
    legacyPrefKeys: [{ from: 'forecasting_active_view', area: 'local', to: 'activeView' }],
    legacyPrefPrefixes: [{ from: 'forecasting_state_', to: 'state.' }],
  });
  assert.equal(store.readPref('activeView'), 'forecasting');
  assert.equal(store.readPref('state.weekly_active_users'), '{"fitted":true}');
  assert.equal(local.getItem('forecasting_active_view'), null);
  assert.equal(local.getItem('forecasting_state_weekly_active_users'), null);
});

await check('4.2 unreadable workspace keys raise recoverable guidance', () => {
  const { local } = resetStorage();
  local.setItem('scurve.predictive.workspaceKeys', 'not json');
  const store = new TokenStore({ platform: 'predictive' });
  assert.throws(() => store.readWorkspaceKeys(), /operator token to recover access/);
});

// --- 4.3 authentication ---------------------------------------------------

await check('4.3 frictionless-login sends workspace_key only when supplied', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, { token: 'tok-login' }));
  const predictive = createPortalClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    auth: { capabilities: { config: true, logout: true, me: true } },
  });
  await predictive.auth.frictionlessLogin({ email: 'a@b.com', workspaceKey: 'wk-1' });
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), {
    email: 'a@b.com',
    workspace_key: 'wk-1',
  });
  assert.equal(predictive.api.token(), 'tok-login', 'token must be stored on login');

  resetStorage();
  const forecasting = createPortalClient({
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
  });
  await forecasting.auth.frictionlessLogin({ email: 'a@b.com' });
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { email: 'a@b.com' });
});

await check('4.3 login with no token in the response is a readable failure', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, { ok: true }));
  const { auth } = createPortalClient({ platform: 'forecasting', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(auth.frictionlessLogin({ email: 'a@b.com' }), /returned no access token/);
});

await check('4.3 /auth/config rejects a non-boolean enabled', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, { nope: true }));
  const { auth } = createPortalClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    auth: { capabilities: { config: true } },
  });
  await assert.rejects(auth.loadConfig(), /not reachable at this address/);
});

await check('4.3 a missing endpoint is a capability flag, not a network call', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, {}));
  const { auth } = createPortalClient({
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
  });
  await assert.rejects(auth.loadConfig(), /does not provide \/auth\/config/);
  await assert.rejects(auth.identity('t'), /does not provide \/me/);
  assert.equal(fetchImpl.calls.length, 0, 'no request should have been attempted');
});

await check('4.3 /me validates the identity shape and preserves the session', async () => {
  resetStorage();
  const fetchImpl = stubFetch((url, init, index) =>
    index === 0
      ? jsonResponse(200, { tenant: 't1', actor: 'a@b.com', role: 'admin' })
      : jsonResponse(200, { tenant: '', actor: 'a@b.com', role: 'wizard' }),
  );
  const { api, auth } = createPortalClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    auth: { capabilities: { me: true } },
  });
  api.setToken('tok-1');
  const me = await auth.identity();
  assert.equal(me.role, 'admin');
  await assert.rejects(auth.identity(), /current workspace was preserved/);
  assert.equal(api.token(), 'tok-1', 'a malformed identity must not clear the token');
});

await check('4.3 logout clears the token even when the server call fails', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  const { api, auth } = createPortalClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    auth: { capabilities: { logout: true } },
  });
  api.setToken('tok-1');
  const outcome = await auth.logout();
  assert.equal(outcome.revoked, false);
  assert.match(outcome.reason, /service is unavailable/i);
  assert.equal(api.token(), '', 'the token must not survive a disconnect');
});

await check('4.3 logout on a platform without the endpoint still clears locally', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, {}));
  const { api, auth } = createPortalClient({
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
  });
  api.setToken('tok-1');
  const outcome = await auth.logout();
  assert.equal(outcome.revoked, false);
  assert.equal(api.token(), '');
  assert.equal(fetchImpl.calls.length, 0);
});

// --- 4.4 errors -----------------------------------------------------------

await check('4.4 network failure maps to the unavailable text', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => {
    throw new TypeError('fetch failed');
  });
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/records/dataset'), (error) => {
    assert.equal(error.kind, 'unavailable');
    assert.equal(
      error.message,
      'The service is unavailable. Check that the server is running, then retry.',
    );
    return true;
  });
});

await check('4.4 timeout maps to the same text as a network failure', async () => {
  resetStorage();
  const fetchImpl = stubFetch(
    (url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const client = new ApiClient({
    platform: 'causal',
    buildTimeBase: '/api',
    fetchImpl,
    timeoutMs: 20,
  });
  await assert.rejects(client.request('/slow'), (error) => {
    assert.equal(error.kind, 'timeout');
    assert.match(error.message, /service is unavailable/i);
    return true;
  });
});

await check('4.4 401 maps to the reconnect text', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(401, { detail: 'Signature failed' }));
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/records/dataset'), (error) => {
    assert.equal(error.message, 'The access token is expired or invalid. Reconnect to continue.');
    assert.equal(error.detail, 'Signature failed', 'the raw detail stays on the error for logs');
    return true;
  });
});

await check('4.4 403 maps to the permission text', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(403, { detail: 'Beta Connect is disabled' }));
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/x'), /lacks permission for this action/);
});

await check('4.4 4xx detail is shown verbatim', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(400, { detail: 'Enter a valid email address' }));
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/x'), (error) => {
    assert.equal(error.message, 'Enter a valid email address');
    return true;
  });
});

await check('4.4 5xx hides the detail behind the retry-then-logs text', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() =>
    jsonResponse(500, { detail: "Traceback: KeyError 'tenant'" }),
  );
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/x'), (error) => {
    assert.equal(
      error.message,
      'The service failed to process the request. Retry, then check the server logs.',
    );
    assert.doesNotMatch(error.message, /Traceback/);
    return true;
  });
});

await check('4.4 no bare status code or stack trace reaches operator text', async () => {
  resetStorage();
  for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) {
    const fetchImpl = stubFetch(() => jsonResponse(status, {}));
    const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
    const message = await client.request('/x').then(
      () => '',
      (error) => error.message,
    );
    assert.doesNotMatch(message, /\b\d{3}\b/, `status ${status} leaked into "${message}"`);
    assert.doesNotMatch(message, /\bat \w+ \(/, `a stack frame leaked for ${status}`);
  }
});

await check('4.4 operatorMessage never renders [object Object]', () => {
  assert.equal(operatorMessage(new PortalError('forbidden')), 'This account lacks permission for this action.');
  assert.equal(operatorMessage(new Error('Select at least one feature.')), 'Select at least one feature.');
  assert.doesNotMatch(operatorMessage({ weird: true }), /object Object/);
  assert.doesNotMatch(operatorMessage(undefined), /undefined/);
});

await check('4.4 an ok response that is not JSON is a configuration message', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => new Response('<!DOCTYPE html>', { status: 200 }));
  const client = new ApiClient({ platform: 'causal', buildTimeBase: '/api', fetchImpl });
  await assert.rejects(client.request('/x'), /could not read/);
});

// --- expired-token handling ----------------------------------------------

await check('expired token is cleared once and reported to the portal', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(401, { detail: 'expired' }));
  const seen = [];
  const client = new ApiClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    onUnauthorized: (context) => seen.push(context.path),
  });
  client.setToken('tok-expired');
  await assert.rejects(client.request('/records/dataset'));
  assert.deepEqual(seen, ['/records/dataset']);
  assert.equal(client.token(), '', 'a rejected token must not be kept');
});

await check('a 401 from the auth endpoints does not trigger the reconnect hook', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(401, { detail: 'bad token' }));
  const seen = [];
  const client = new ApiClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    onUnauthorized: (context) => seen.push(context.path),
  });
  client.setToken('tok-1');
  await assert.rejects(client.request('/auth/logout', { method: 'POST', body: {} }));
  assert.deepEqual(seen, []);
  assert.equal(client.token(), 'tok-1');
});

await check('a late 401 does not undo a reconnect that raced it', async () => {
  resetStorage();
  const seen = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = stubFetch(async () => {
    await gate;
    return jsonResponse(401, { detail: 'expired' });
  });
  const client = new ApiClient({
    platform: 'predictive',
    buildTimeBase: '/api',
    fetchImpl,
    onUnauthorized: (context) => seen.push(context.path),
  });
  client.setToken('tok-old');
  const inFlight = client.request('/records/dataset');
  client.setToken('tok-new'); // operator reconnected while the request was out
  release();
  await assert.rejects(inFlight);
  assert.deepEqual(seen, [], 'the stale 401 must not prompt a reconnect');
  assert.equal(client.token(), 'tok-new', 'the new token must survive');
});

// --- authenticated request and demo header --------------------------------

await check('an authenticated request carries the stored bearer token', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, [{ id: 'd1' }]));
  const client = new ApiClient({ platform: 'predictive', buildTimeBase: '/api', fetchImpl });
  client.setToken('tok-1');
  const rows = await client.request('/records/dataset');
  assert.deepEqual(rows, [{ id: 'd1' }]);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok-1');
  assert.equal(fetchImpl.calls[0].init.headers['Content-Type'], undefined);
});

await check('a JSON body sets Content-Type; FormData does not', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, {}));
  const client = new ApiClient({ platform: 'predictive', buildTimeBase: '/api', fetchImpl });
  await client.request('/datasets', { method: 'POST', body: { name: 'x' } });
  assert.equal(fetchImpl.calls[0].init.headers['Content-Type'], 'application/json');

  const form = new FormData();
  form.append('file', new Blob(['a,b']), 'x.csv');
  await client.request('/datasets/csv/preview', { method: 'POST', body: form });
  assert.equal(
    fetchImpl.calls[1].init.headers['Content-Type'],
    undefined,
    'the browser must set the multipart boundary itself',
  );
});

await check('demo mode sends X-Demo-Session instead of a bearer token', async () => {
  const { local } = resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, {}));
  const client = new ApiClient({
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
    demoSession: { mint: () => 'demo-fixed' },
  });
  client.setToken('tok-1');
  await client.request('/demo/forecasts/run', { method: 'POST', body: {}, authMode: 'demo' });
  const headers = fetchImpl.calls[0].init.headers;
  assert.equal(headers['X-Demo-Session'], 'demo-fixed');
  assert.equal(headers.Authorization, undefined);
  assert.equal(local.getItem('scurve.forecasting.demoSessionId'), 'demo-fixed');
});

await check('a demo session id is stable across clients', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, {}));
  const options = {
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
    demoSession: {},
  };
  const first = new ApiClient(options).demoSessionId();
  assert.equal(new ApiClient(options).demoSessionId(), first);
});

await check('login and health send no credential', async () => {
  resetStorage();
  const fetchImpl = stubFetch(() => jsonResponse(200, { token: 't', status: 'ok' }));
  const { api, auth } = createPortalClient({
    platform: 'forecasting',
    buildTimeBase: '/api',
    fetchImpl,
  });
  api.setToken('tok-stale');
  await auth.frictionlessLogin({ email: 'a@b.com' });
  await checkHealth(api);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined);
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, undefined);
});

// --- 4.5 polling ----------------------------------------------------------

await check('4.5 queued and running are distinct from succeeded', () => {
  assert.equal(isPendingJobState('queued'), true);
  assert.equal(isPendingJobState('running'), true);
  assert.equal(isPendingJobState('succeeded'), false);
  assert.equal(jobStateTone('queued'), 'warn');
  assert.equal(jobStateTone('running'), 'warn');
  assert.equal(jobStateTone('succeeded'), 'ok');
  assert.equal(jobStateTone('failed'), 'risk');
  assert.equal(jobStateTone('cancelled'), 'risk');
});

await check('4.5 the poller resolves only with a settled status', async () => {
  const states = ['queued', 'queued', 'running', 'succeeded'];
  const seen = [];
  let index = 0;
  const handle = pollUntilSettled({
    fetch: async () => ({ state: states[Math.min(index++, states.length - 1)] }),
    classify: (job) =>
      isPendingJobState(job.state)
        ? { settled: false, value: job }
        : { settled: true, outcome: 'succeeded', value: job },
    intervalMs: 1,
    onProgress: (progress) => seen.push(progress.value.state),
  });
  const settled = await handle.result;
  assert.equal(settled.value.state, 'succeeded');
  assert.deepEqual(seen, ['queued', 'queued', 'running', 'succeeded']);
});

await check('4.5 the poller times out rather than hanging', async () => {
  const handle = pollUntilSettled({
    fetch: async () => ({ state: 'running' }),
    classify: (job) => ({ settled: false, value: job }),
    intervalMs: 5,
    timeoutMs: 30,
  });
  await assert.rejects(handle.result, (error) => {
    assert.equal(error.kind, 'timeout');
    assert.match(error.message, /may still be running/);
    return true;
  });
});

await check('4.5 cancel stops the poller and says the run was not cancelled', async () => {
  let polls = 0;
  const handle = pollUntilSettled({
    fetch: async () => {
      polls += 1;
      return { state: 'running' };
    },
    classify: (job) => ({ settled: false, value: job }),
    intervalMs: 5,
  });
  setTimeout(() => handle.cancel(), 20);
  await assert.rejects(handle.result, (error) => {
    assert.equal(error.kind, 'cancelled');
    assert.match(error.message, /run itself was not cancelled/);
    return true;
  });
  const after = polls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(polls, after, 'polling must stop after cancel');
});

await check('4.5 a transient failure can be ridden out', async () => {
  let call = 0;
  const handle = pollUntilSettled({
    fetch: async () => {
      call += 1;
      if (call < 3) throw new PortalError('unavailable');
      return { state: 'succeeded' };
    },
    classify: (job) => ({ settled: true, outcome: 'succeeded', value: job }),
    intervalMs: 1,
    retryErrors: true,
  });
  assert.equal((await handle.result).value.state, 'succeeded');
});

// --- report ---------------------------------------------------------------

console.log('@scurve/portal-kit — section 4 contract\n');
console.log(results.join('\n'));
const failures = results.filter((line) => line.includes('FAIL')).length;
console.log(
  `\n${results.length - failures} passed, ${failures} failed (${results.length} checks)`,
);
