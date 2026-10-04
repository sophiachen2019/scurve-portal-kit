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
| API client, token store, auth, errors, polling | planned |
| UX primitives — shell, conversation, artifacts, phase track, mode | planned |
| `create-scurve-portal` starter | planned |

## Install

```jsonc
// <platform>/dev_portal/package.json
"dependencies": {
  "@scurve/portal-kit": "github:sophiachen2019/scurve-portal-kit#v0.1.0"
}
```

Before the first tag is pushed, use a local path instead:

```jsonc
"@scurve/portal-kit": "file:../../scurve-portal-kit"
```

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
