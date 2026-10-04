/**
 * Shell chrome. `portal_ui_standards.md` section 5a item 1.
 *
 * Brand block, connection badge, and workspace access control render
 * identically and sit in the same place in every portal.
 *
 * Of the five primitives this is the one where the three portals share the
 * most *meaning* and the least markup. All three show a dot-and-label badge
 * saying whether the portal is talking to a platform, and all three paint it
 * by toggling a modifier class on the dot and rewriting the label — but causal
 * and forecasting have theirs as static markup in `index.html` while
 * predictive renders its header from state on every pass. So the badge here is
 * a controller over elements the portal already has, not a markup generator,
 * and the markup generator (`brandMarkup`) is for portals that render their
 * own header — which, today, means predictive and anything
 * `create-scurve-portal` produces.
 *
 * What the badge standardizes is the vocabulary: three connection states, each
 * meaning one thing. Before this, "Connected" in one portal and "FastAPI" in
 * another described the same condition, and a dot with no label change
 * described a different one.
 */

import { escapeHtml, resolveClasses, type ClassMap } from './dom.js';

/**
 * Whether the portal is talking to a platform.
 *
 * `preview` is its own state rather than a flavour of `connected`, because an
 * operator looking at recorded or synthetic results must be able to tell at a
 * glance that nothing they do will reach a platform. Both predictive's
 * read-only snapshot and forecasting's pre-connection demo are this state.
 */
export type ConnectionState = 'connected' | 'disconnected' | 'preview';

export const CONNECTION_LABELS: Readonly<Record<ConnectionState, string>> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  preview: 'Read-only preview',
};

/** Which status token a connection state renders in. Section 5. */
export const CONNECTION_TONE: Readonly<Record<ConnectionState, 'ok' | 'warn' | 'risk'>> = {
  connected: 'ok',
  // Usable, but nothing here is evidence about a real platform.
  preview: 'warn',
  disconnected: 'risk',
};

export type ConnectionSlot = 'dot' | 'live';

const DEFAULT_CLASSES: Readonly<Record<ConnectionSlot, string>> = {
  dot: 'connection-dot',
  live: 'live',
};

export interface ConnectionBadgeOptions {
  /** The dot element whose modifier class carries the state. */
  dot: HTMLElement | null;
  /** The element holding the label text. */
  label: HTMLElement | null;
  classNames?: ClassMap<ConnectionSlot>;
  /** Per-portal wording for each state, over the kit defaults. */
  labels?: Partial<Record<ConnectionState, string>>;
  /**
   * Rewrites the dot's whole `class` rather than toggling the modifier.
   *
   * forecasting assigns `className` outright, so anything else a stylesheet or
   * another code path put on the dot is dropped. Kept as an option because
   * assigning is what its CSS expects, and toggling would leave a stale
   * modifier behind if some other path had set one.
   */
  replaceDotClass?: boolean;
}

export interface ConnectionBadge {
  /**
   * Paints a state. `label` overrides the wording for this call only, for a
   * portal that says something more specific than the state name — the
   * condition is still one of three, and that is the part that must not drift.
   */
  set(state: ConnectionState, label?: string): void;
  get(): ConnectionState;
  /** Re-reads the elements after a portal re-renders its header. */
  attach(elements: { dot?: HTMLElement | null; label?: HTMLElement | null }): void;
}

export function createConnectionBadge(options: ConnectionBadgeOptions): ConnectionBadge {
  const classes = resolveClasses(DEFAULT_CLASSES, options.classNames);
  const labels = { ...CONNECTION_LABELS, ...options.labels };
  let dot = options.dot;
  let label = options.label;
  let state: ConnectionState = 'disconnected';
  let lastLabel: string | undefined;

  function paint(): void {
    // `preview` lights the dot: something is answering, it is just not a
    // platform. A dark dot would read as "nothing is working".
    const live = state === 'connected' || state === 'preview';
    if (dot) {
      if (options.replaceDotClass) {
        dot.className = live ? `${classes.dot} ${classes.live}` : classes.dot;
      } else {
        dot.classList.toggle(classes.live, live);
      }
    }
    if (label) label.textContent = lastLabel ?? labels[state];
  }

  return {
    set: (next, override) => {
      state = next;
      lastLabel = override;
      paint();
    },
    get: () => state,
    attach: (elements) => {
      if (elements.dot !== undefined) dot = elements.dot;
      if (elements.label !== undefined) label = elements.label;
      paint();
    },
  };
}

// --- brand block ----------------------------------------------------------

export interface BrandOptions {
  /** Platform name, e.g. `Causal Agent`. */
  name: string;
  /** The emphasised trailing word, e.g. `Platform` or `Agent`. */
  suffix?: string;
  logoSrc?: string;
  /** A short status chip beside the name, e.g. `Early Access`. */
  tag?: string;
  /** Rendered small under the name. All three portals carry the house line. */
  byline?: string;
  /** Element id, so a portal can bind a "home" click to it. */
  id?: string;
}

/**
 * The brand block, for a portal that renders its own header.
 *
 * One arrangement — logo, name with an emphasised suffix, optional tag,
 * optional byline — so the top-left corner of portal four looks like the top-
 * left corner of the other three without anyone copying markup across.
 */
export function brandMarkup(options: BrandOptions): string {
  const logo = options.logoSrc
    ? `<span class="brand-icon"><img src="${escapeHtml(options.logoSrc)}" alt="S-Curve Data" class="brand-logo-img"></span>`
    : '';
  const suffix = options.suffix ? ` <span class="brand-accent">${escapeHtml(options.suffix)}</span>` : '';
  const tag = options.tag ? `<span class="brand-tag">${escapeHtml(options.tag)}</span>` : '';
  const byline = options.byline ? `<small class="brand-byline">${escapeHtml(options.byline)}</small>` : '';
  const id = options.id ? ` id="${escapeHtml(options.id)}"` : '';
  return (
    `<div class="brand"${id}>${logo}` +
    `<span class="brand-titles"><span class="brand-text">${escapeHtml(options.name)}${suffix}</span>` +
    `${tag}${byline}</span></div>`
  );
}

// --- workspace access control --------------------------------------------

/**
 * How a portal describes the access it currently holds.
 *
 * The dialog behind the control is not a primitive: predictive mints and
 * stores browser-local workspace recovery keys and can log out, causal takes
 * an email and nothing else, and forecasting sits between them. What *is*
 * shared is the sentence the control shows, because an operator reads it in
 * every portal and it has to mean the same thing.
 */
export interface AccessLabelInput {
  connected: boolean;
  /** Workspace or tenant name, when the platform reports one. */
  workspace?: string;
  /** `demo`, `trial`, `standard` — whatever the platform distinguishes. */
  kind?: string;
  /** True while reading recorded or synthetic results. */
  preview?: boolean;
}

/** The connection state implied by what a portal knows about its access. */
export function accessState(input: AccessLabelInput): ConnectionState {
  if (input.preview) return 'preview';
  return input.connected ? 'connected' : 'disconnected';
}

/**
 * One sentence for the access control, so the same situation reads the same
 * way in every portal.
 */
export function accessLabel(input: AccessLabelInput): string {
  if (input.preview) return CONNECTION_LABELS.preview;
  if (!input.connected) return 'Connect a workspace';
  const name = input.workspace?.trim();
  if (!name) return CONNECTION_LABELS.connected;
  return input.kind === 'demo' ? `${name} · demo` : name;
}
