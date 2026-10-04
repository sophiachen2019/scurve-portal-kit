# @scurve/portal-kit

Shared front-end code for the S-Curve Data agent platform portals:
`causal-agent-platform`, `forecasting-agent-platform`, and
`predictive-ml-agent-platform`, each of which ships its own `dev_portal/`.

The governing specification is
[`portal_ui_standards.md`](https://github.com/sophiachen2019/autonomous-data-team/blob/main/docs/architecture/portal_ui_standards.md)
in the `autonomous-data-team` repo. Read it before changing anything here.

## Why this exists

The three portals were built in separate phases. They converged on the same
toolchain by accident — all Vite, identical `dev`/`build`/`preview` scripts,
almost no dependencies — while diverging on everything above it.

The divergence is not cosmetic. All three backends implement the same auth
protocol (`/health`, `/auth/frictionless-login`; predictive adds `/auth/config`,
`/auth/logout`, `/me`) behind three different client implementations that
disagree on decisions that are not stylistic:

- Bearer tokens in `localStorage` (causal, forecasting) versus `sessionStorage`
  (predictive).
- Three base-URL strategies, each with a Cloud Run URL hardcoded in frontend
  source.
- Three hand-rolled HTTP-status-to-operator-text mappings.

A fourth portal would inherit one of these at random, or invent a fourth.

## What belongs here

> If two portals would both need it, and a wrong implementation would confuse
> an operator who uses both, it is a primitive.

Chart types, DAG editors, and model cards fail that test and stay in their own
portal.

What explicitly does **not** belong here is a layout. The portals drive their
task differently on purpose — causal is conversation-first because causal
analysis is a gated 14-stage workflow, forecasting is workbench-first because
it is iterative comparison, predictive offers both as an explicit mode. Primary
interaction model is per-portal and is not a conformance item. See
`portal_ui_standards.md` section 5a.

## Status

| Contents | State |
| --- | --- |
| `tokens.css` — palette, typography, radii, motion, status colors | shipped in 0.1.0 |
| API client, token store, auth, errors, polling | shipped in 0.2.0 |
| UX primitives — shell, conversation, artifacts, phase track, mode | shipped in 0.3.0 |
| `primitives.css` — default styling for the primitives | shipped in 0.3.0 |
| `create-scurve-portal` starter | planned |

Adopters: all three portals consume the client as of 0.2.0 — causal's
restructure was standards section 9 step 4 and is done.

## Install

```jsonc
// <platform>/dev_portal/package.json
"dependencies": {
  "@scurve/portal-kit": "github:sophiachen2019/scurve-portal-kit#v0.3.0"
}
```

## Build

The kit is TypeScript and ships generated `.d.ts`, so the JavaScript portals
get type checking at the API boundary without migrating (standards section 6).

`tsc` runs from the `prepare` script, which npm executes when installing a git
dependency. There is no committed build output: `dist/` is gitignored and
produced on install, so it cannot go stale the way a committed artifact can.
A consuming image therefore needs git and a working `npm ci` — see the comment
block at the top of `predictive-ml-agent-platform/Dockerfile`.

```sh
npm run build      # tsc -> dist/
npm run verify     # build, then exercise the section 4 contract
```

`scripts/verify.mjs` asserts the behaviours section 4 names — resolution order,
key placement, legacy migration, every row of the error table, the capability
flags, and the poller's timeout and cancel paths — against stubbed transport
and storage. Run it before tagging.

## API client

One client, configured per platform. Section 4 of the standards is the
specification; this is the shape it takes.

```ts
import { createPortalClient } from '@scurve/portal-kit';

export const { api, auth } = createPortalClient({
  platform: 'predictive',
  // Section 4.2: carry pre-standard keys across, then delete them, so the move
  // to sessionStorage does not log existing operators out on upgrade.
  legacyTokenKeys: [{ from: 'pml-token', area: 'session' }],
  legacyWorkspaceKeys: [{ from: 'pml-workspace-keys', area: 'local' }],
  legacyPrefKeys: [{ from: 'pml-email', area: 'local', to: 'email' }],
  // Section 4.3: a platform that lacks an endpoint gets a flag, not a fork.
  auth: { capabilities: { config: true, logout: true, me: true } },
  onUnauthorized: () => promptReconnect(),
});
```

### Base URL — section 4.1

No deployed hostname in frontend source. `resolveApiBase` checks, in order,
`import.meta.env.VITE_API_BASE`, then `window.SCURVE_API_BASE` (plus any
`runtimeOverrideKeys` a portal already documents), then same-origin `/api`.
Deployed hostnames belong in deploy configuration.

`/health` is served at the application root on all three backends, not under
the API prefix, so `checkHealth` resolves against `api.originUrl`. A portal
appending `/health` to its API base reaches `/api/health` and reports a healthy
service as unreachable.

### Storage — section 4.2

| What | Where | Key |
| --- | --- | --- |
| Bearer token | `sessionStorage` | `scurve.<platform>.token` |
| Durable non-secret preference | `localStorage` | `scurve.<platform>.<key>` |
| Workspace recovery keys | `localStorage` | `scurve.<platform>.workspaceKeys` |

`sessionStorage` for tokens is deliberate: a credential that outlives the
browser session is a longer-lived secret than an operator portal needs. Moving
causal and forecasting off `localStorage` is a behaviour change, which is why
`legacyTokenKeys` exists — the value is carried across before the old entry is
deleted, and deleting it is what makes the migration idempotent.

`readSessionPref` / `writeSessionPref` cover the narrow fourth case: a
non-secret value that still should not outlive the session, such as a demo
workspace key that must not silently resurrect a stale demo workspace.

Workspace recovery keys are browser-local and not recoverable anywhere else.
A portal offering them must say so where the operator can read it.

### Errors — section 4.4

Every failure arrives as a `PortalError` whose `message` is already the
operator text, so a portal renders `error.message` and never maps a status
itself. Use `operatorMessage(error)` in a catch block, since a catch receives
`unknown` and `String(error)` risks putting a stack trace on screen.

| Condition | `kind` | Message |
| --- | --- | --- |
| Network failure | `unavailable` | The service is unavailable. Check that the server is running, then retry. |
| Timeout | `timeout` | as above |
| 401 | `unauthorized` | The access token is expired or invalid. Reconnect to continue. |
| 403 | `forbidden` | This account lacks permission for this action. |
| 4xx with `detail` | `request` | `detail`, verbatim |
| 5xx | `server` | The service failed to process the request. Retry, then check the server logs. |

A 5xx `detail` is deliberately *not* shown: it describes an internal failure,
not something the operator can act on. It stays on `error.detail` for logs.

A 401 clears the stored token and calls `onUnauthorized` once — but only when
the token the request carried is still the current one, so a reconnect that
raced an in-flight request is not undone by its late 401.

### Long-running work — section 4.5

`pollUntilSettled` resolves only with a settled status, so a caller cannot
render a result the platform has not returned. It takes a timeout and returns a
`cancel`. `isPendingJobState` and `jobStateTone` give queued and running a
rendering distinct from succeeded, mapped onto the `--ok` / `--warn` / `--risk`
tokens so one word means one thing across the system.

`startRefreshLoop` is the separate case of a background refresh that never
settles: no timeout, an explicit `stop`, and a `pause` predicate so an
operator's open dialog or focused field is left alone.

## UX primitives

Five composable primitives, from standards section 5a: shell chrome,
conversation, artifacts, phase track, and mode. They were extracted from the
three portals rather than designed ahead of them — all three already had a
conversation surface and an artifact surface, so each API below is the
intersection of three working implementations.

**What is not here is a layout.** Section 5a is explicit that the primary
interaction model follows the shape of the task and is *not* a conformance
item: causal is conversation-first because causal analysis is a gated 14-stage
workflow, forecasting is workbench-first because it is iterative comparison,
predictive is dual-mode because artifact review wants both. A portal declares
which surface is primary and composes the primitives behind it. Nothing in the
kit prefers an arrangement, and no primitive touches the network.

```ts
import {
  createConversation,
  createArtifactView,
  createPhaseTrack,
  createSurfaceMode,
  createConnectionBadge,
} from '@scurve/portal-kit';
```

### Presentation is a parameter

Every primitive takes a `classNames` map from a semantic slot — `message`,
`typeBadge`, `pendingText` — to the class a portal's stylesheet already
targets. That is what let three shipped portals adopt one implementation
without any of them changing how they look.

```ts
// causal keeps its own class vocabulary; the behaviour comes from the kit.
const conversation = createConversation({
  messages: document.getElementById('chatMessages'),
  classNames: { message: 'msg', pending: 'typing-indicator-container' },
  renderMarkdown: renderMarkdownWithMarked,
});
```

The kit defaults are the vocabulary `primitives.css` styles and the vocabulary
`create-scurve-portal` emits. A new portal passes no `classNames` at all.

### The option surface is an inventory, not a design

`ArtifactViewOptions` in particular is wider than a from-scratch component
would be. Each presentation option — `badgePlacement`, `controlsWrapper`,
`downloadLabel`, `badgeTypeClass`, `collapse.mode`, `cardId` — exists because
two shipped portals disagree on that one point and neither disagreement has a
reason behind it. Writing them down here makes the drift countable; three
private copies did not.

Reconciling them is a visible change and needs its own review, exactly as
adopting the kit palette in the cockpit did in step 1 of the adoption path.
The target state is that every one of those options is deleted and the kit
default is the only arrangement.

### Gate semantics

`PhaseState` is `pending | active | paused | blocked | done`, and `paused` and
`blocked` are deliberately distinct:

| State | Tone | Means |
| --- | --- | --- |
| `paused` | `--warn` | The platform is waiting for the operator. A gate. |
| `blocked` | `--risk` | The run cannot continue. |

Collapsing both onto one "stopped" colour tells an operator their run has
failed when it is waiting for them. `createPhaseTrack` reports either through
`onGate` together with the platform's `next_actions`, because section 5
requires a blocked state to render what would unblock it — the defect that had
`next_actions` appearing zero times in the cockpit while the API returned it on
every blocked result.

### Connection states

Three states, each meaning one thing, so `Connected` in one portal and
`FastAPI` in another stop describing the same condition:

| State | Tone | Dot |
| --- | --- | --- |
| `connected` | `--ok` | lit |
| `preview` | `--warn` | lit — something is answering, but not a platform |
| `disconnected` | `--risk` | dark |

`set(state, label?)` lets a portal say something more specific than the state
name while the condition stays one of the three.

### Markdown

`renderAgentMarkdown` renders the subset agents actually emit — headings,
bullets, pipe tables, bold, italic, inline code, soft breaks — and escapes
before it formats, because an agent reply is LLM-authored text. It is
forecasting's renderer, which was the most complete of the three and needs no
CDN.

`renderMarkdownWithMarked` prefers a `marked` CDN script when the page has one
and falls back to the above. causal loads `marked`, and its own fallback
covered bold, code and line breaks only — so a blocked CDN turned an estimate
table into a wall of pipes. The loaded path is unchanged; the degraded path is
now legible.

Predictive renders agent text escaped and unformatted, so the same reply reads
as prose in two portals and as source in the third. That is a visible change to
fix and is listed in the standards doc rather than done quietly here.

### Verification

`npm run verify` asserts the DOM-free half of this section — the markdown
subset, the chip dedupe, the phase and connection vocabularies, the access
label, escaping — alongside the section 4 contract.

The DOM-building half is deliberately not asserted there. A hand-rolled or
library DOM stub agrees with whatever it was written to agree with, and the
claim that matters is that three shipped portals render exactly as they did.
That is checked in a real browser against each portal's real stylesheet with
`scripts/dom-snapshot.js`, which emits a normalized line-per-node signature
including the computed properties that decide layout:

```js
const before = scurveDomSnapshot(document.body);
// ... swap in the primitives, reload, drive the same page state ...
scurveDomDiff(before, scurveDomSnapshot(document.body));   // [] when neutral
```

Run both. Neither half alone is enough.

## Tokens

Import first, then add portal-specific rules. Surfaces are opt-in via a
`data-surface` attribute on `<html>`, because the portals render dark and the
`autonomous-data-team` cockpit renders light.

```html
<html data-surface="dark">
```

```css
@import "@scurve/portal-kit/tokens.css";
/* portal-specific rules below */
```

Status tokens carry fixed meaning matching the agent status vocabulary in
`specialist_agent_standards.md`:

| Token | Meaning |
| --- | --- |
| `--ok` | Completed and usable as evidence |
| `--warn` | Completed but needs human review before use |
| `--risk` | Blocked or errored; produced no usable result |

A blocked state must always render what would unblock it, never a bare red
indicator.

### Known divergence to resolve

The `autonomous-data-team` cockpit (`apps/web/styles.css`) uses the same token
*names* with different *values*: `--ok` `#16a34a` vs `#10b981`, `--warn`
`#d97706` vs `#f59e0b`, `--risk` `#e11d48` vs `#f87171`, `--radius-sm` `6px` vs
`4px`. Only `--accent` agrees.

Adopting these tokens in the cockpit is therefore a visible change and needs
review; it was deliberately left out of 0.1.0 so that tokens could be wired
into the three portals with no visual effect at all. Pick one palette and
migrate the other side in a dedicated change.

## Versioning

Portals pin a tag and upgrade on their own schedule. Tag every change that
alters a token value or a client signature; portals are separate deployed
products and must not be upgraded implicitly.
