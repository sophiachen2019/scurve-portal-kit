/**
 * The artifact surface. `portal_ui_standards.md` section 5a item 3.
 *
 * One component: artifact list, type badges, expand-to-modal, and a resize
 * handle. All three portals already had one, so — as with conversation — the
 * API below is the intersection of three working implementations rather than a
 * design guess.
 *
 * The body of an artifact is *not* in the kit. A forecast chart, a DAG and a
 * model card are the products themselves and fail the section 5a membership
 * test: a portal that renders one wrong confuses nobody who uses the other
 * two. So `renderBody` is injected, and the kit owns only the frame around it —
 * the part an operator moving between portals has to relearn if it differs.
 *
 * No network access (section 3). Artifacts arrive already fetched.
 *
 * ## About the option surface
 *
 * `ArtifactViewOptions` is wider than a component designed from scratch would
 * be, and deliberately so. Each presentation option — `badgePlacement`,
 * `controlsWrapper`, `downloadLabel`, `badgeTypeClass`, `collapse.mode`,
 * `cardId` — exists because two shipped portals disagree on that one point,
 * and none of the disagreements has a reason behind it. They are an inventory
 * of the drift, written down where it is countable, rather than three private
 * copies where it is not.
 *
 * Reconciling them is a visible change and needs its own review, exactly as
 * adopting the kit palette in the `autonomous-data-team` cockpit did in step 1
 * of the adoption path. The target state is that every option here is deleted
 * and the kit default is the only arrangement.
 */

import {
  clamp,
  element,
  escapeHtml,
  highlightElement,
  resolveClasses,
  slugifyDomId,
  type ClassMap,
  type HighlightOptions,
} from './dom.js';

export type ArtifactSlot =
  | 'card'
  | 'header'
  | 'title'
  | 'typeBadge'
  | 'controls'
  | 'download'
  | 'expand'
  | 'collapseArrow'
  | 'body'
  | 'collapsed'
  | 'group'
  | 'groupHeader'
  | 'empty'
  | 'modalOverlay'
  | 'modalContent'
  | 'modalHeader'
  | 'modalBody'
  | 'modalClose';

const DEFAULT_CLASSES: Readonly<Record<ArtifactSlot, string>> = {
  card: 'artifact-card',
  header: 'artifact-card-header',
  title: 'artifact-card-title',
  typeBadge: 'artifact-type-badge',
  controls: 'artifact-card-controls',
  download: 'artifact-download-btn',
  expand: 'artifact-expand-btn',
  collapseArrow: 'artifact-collapse-arrow',
  body: 'artifact-card-body',
  collapsed: 'collapsed',
  group: 'artifact-group',
  groupHeader: 'artifact-group-header',
  empty: 'artifact-empty',
  modalOverlay: 'artifact-modal-overlay',
  modalContent: 'artifact-modal-content',
  modalHeader: 'artifact-modal-header',
  modalBody: 'artifact-modal-body',
  modalClose: 'artifact-modal-close',
};

/** What the frame needs from an artifact. Everything else is the body's. */
export interface Artifact {
  id?: string;
  title?: string;
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

/**
 * How a card collapses.
 *
 * `class` toggles a class on the body and lets the stylesheet decide, which is
 * causal's. `display` sets `style.display` directly, which is forecasting's.
 * They are not interchangeable: causal animates the transition in CSS, and
 * `display: none` cannot be transitioned.
 */
export type CollapseMode = 'class' | 'display';

export interface CollapseOptions {
  mode?: CollapseMode;
  /** Which element the operator clicks. causal: the title. forecasting: the header. */
  trigger?: 'title' | 'header';
  /** Glyphs for the open/closed arrow, when the portal shows one. */
  arrow?: { open: string; closed: string };
}

export interface ArtifactGroup {
  /** Stable key, used to find an existing group to append to. */
  key: string;
  label: string;
}

export interface ArtifactViewOptions {
  /** The container cards are added to. */
  list: HTMLElement | null;
  /** Renders the artifact's own content into the given container. */
  renderBody: (container: HTMLElement, artifact: Artifact) => void;
  classNames?: ClassMap<ArtifactSlot>;
  /**
   * Operator-facing label for an artifact type. Falls back to the raw type,
   * which is causal's behaviour; forecasting maps `forecast_chart` to
   * `Forecast` and so on.
   */
  typeLabel?: (type: string) => string;
  /** Element showing how many artifacts there are. Several portals show two. */
  counters?: readonly (HTMLElement | null)[];
  /** The empty-state block, removed when the first artifact arrives. */
  emptyState?: HTMLElement | null;
  /** Rebuilt by `reset` so an empty panel says so again after a new session. */
  renderEmptyState?: () => string;
  /**
   * Files artifacts under a heading. causal groups by the workflow stage that
   * produced them, which is what keeps a 14-stage run readable; forecasting
   * has one flat list and omits this.
   */
  group?: (artifact: Artifact, context: { step?: string }) => ArtifactGroup;
  /** Group keys in the order they should appear, rather than arrival order. */
  groupOrder?: readonly string[];
  collapse?: CollapseOptions;
  /** Whether a card offers expand-to-modal. */
  expandable?: boolean;
  /** Whether new cards go to the top of their group. causal prepends. */
  prepend?: boolean;
  /**
   * Where the type badge sits.
   *
   * `in-title` nests it inside the title span, which is causal's; `sibling`
   * puts it between the title and the controls, which is forecasting's. Both
   * arrangements show the same badge with the same meaning, and reconciling
   * them is a visible change that needs its own review — so the kit expresses
   * both rather than silently restyling one portal.
   */
  badgePlacement?: 'in-title' | 'sibling';
  /**
   * Whether the badge also carries the raw type as a class, so a stylesheet
   * can colour it per type. causal does; forecasting styles one badge.
   */
  badgeTypeClass?: boolean;
  /**
   * The card's DOM id. Defaults to `artifact-<n>-<slug>`.
   *
   * Only the kit's own `scrollTo` needs to find a card, and it goes through
   * `data-artifact-id`, so this exists purely so a portal's existing ids
   * survive the move.
   */
  cardId?: (artifact: Artifact, index: number) => string;
  /**
   * Whether the controls go in a wrapper element. causal wraps them to push
   * them to the far end of the header; forecasting lays the header out
   * directly and has no wrapper.
   */
  controlsWrapper?: boolean;
  /** Visible content of the download control. An icon unless a label is given. */
  downloadLabel?: string;
  /** Extra attribute carrying the artifact id on the download control. */
  downloadAttribute?: string;
  download?: (artifact: Artifact) => void;
  onExpand?: (artifact: Artifact) => void;
  highlight?: HighlightOptions;
  /** Called after a card is added, for a navigator or telemetry. */
  onCardAdded?: (artifact: Artifact, card: HTMLElement) => void;
  trackEvent?: (name: string, payload?: Record<string, unknown>) => void;
}

export interface ArtifactView {
  /** Clears the panel for a new session. */
  reset(): void;
  /** Adds one artifact and returns its card. */
  add(artifact: Artifact, context?: { step?: string }): HTMLElement | null;
  /** Adds every artifact in an agent response, under one stage heading. */
  addAll(artifacts: readonly Artifact[], context?: { step?: string }): void;
  /** Jumps to the card a conversation chip refers to. */
  scrollTo(artifactId: string): void;
  scrollToCard(card: Element | null): void;
  count(): number;
  all(): readonly Artifact[];
  openModal(artifact: Artifact): void;
}

const DOWNLOAD_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const EXPAND_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

export function createArtifactView(options: ArtifactViewOptions): ArtifactView {
  const classes = resolveClasses(DEFAULT_CLASSES, options.classNames);
  const collapse = options.collapse ?? {};
  const typeLabel = options.typeLabel ?? ((type: string) => type);
  const artifacts: Artifact[] = [];
  let emptyState = options.emptyState ?? null;

  function updateCounters(): void {
    for (const counter of options.counters ?? []) {
      if (counter) counter.textContent = String(artifacts.length);
    }
  }

  function dropEmptyState(): void {
    if (!emptyState) return;
    emptyState.remove();
    emptyState = null;
  }

  function reset(): void {
    artifacts.length = 0;
    if (options.list) {
      options.list.innerHTML = options.renderEmptyState?.() ?? '';
      emptyState = options.list.querySelector<HTMLElement>(`.${classes.empty}`);
    }
    updateCounters();
  }

  /** The group a card belongs in, created in `groupOrder` position if new. */
  function groupContainer(artifact: Artifact, context: { step?: string }): HTMLElement | null {
    if (!options.group || !options.list) return options.list;
    const { key, label } = options.group(artifact, context);
    const existing = options.list.querySelector<HTMLElement>(
      `.${classes.group}[data-group="${CSS.escape(key)}"]`,
    );
    if (existing) return existing;

    const group = element('div', classes.group);
    group.dataset.group = key;
    group.innerHTML = `<div class="${classes.groupHeader}">${escapeHtml(label)}</div>`;
    insertInOrder(group, key);
    return group;
  }

  function insertInOrder(group: HTMLElement, key: string): void {
    const order = options.groupOrder;
    if (!options.list) return;
    if (!order) {
      options.list.appendChild(group);
      return;
    }
    const position = order.indexOf(key);
    for (const existing of options.list.querySelectorAll<HTMLElement>(`.${classes.group}`)) {
      if (order.indexOf(existing.dataset.group ?? '') > position) {
        options.list.insertBefore(group, existing);
        return;
      }
    }
    options.list.appendChild(group);
  }

  function artifactName(artifact: Artifact): string {
    return artifact.title || artifact.id || 'Artifact';
  }

  function buildBadge(type: string): HTMLElement {
    const className =
      options.badgeTypeClass === false ? classes.typeBadge : `${classes.typeBadge} ${type}`.trim();
    return element('span', className, typeLabel(type));
  }

  function buildTitle(artifact: Artifact, type: string): HTMLElement {
    const title = element('span', classes.title);
    if (options.badgePlacement !== 'sibling') title.appendChild(buildBadge(type));
    title.appendChild(document.createTextNode(artifactName(artifact)));
    return title;
  }

  function buildHeader(artifact: Artifact, type: string): HTMLElement {
    const header = element('div', classes.header);
    header.appendChild(buildTitle(artifact, type));
    if (options.badgePlacement === 'sibling') header.appendChild(buildBadge(type));

    const controls =
      options.controlsWrapper === false ? header : element('div', classes.controls);

    if (options.download) {
      const download = element('button', classes.download);
      download.type = 'button';
      if (options.downloadLabel) {
        download.textContent = options.downloadLabel;
      } else {
        // An icon-only control needs a tooltip; a labelled one would only be
        // repeating itself, and a tooltip that duplicates the button's own
        // text is noise on hover.
        download.innerHTML = DOWNLOAD_ICON;
        download.title = 'Download';
      }
      download.setAttribute('aria-label', `Download ${artifactName(artifact)}`);
      if (options.downloadAttribute) {
        download.setAttribute(options.downloadAttribute, artifact.id ?? '');
      }
      download.addEventListener('click', (event) => {
        event.stopPropagation();
        options.download?.(artifact);
        options.trackEvent?.('artifact_downloaded', {
          type,
          title: artifact.title ?? artifact.id,
        });
      });
      controls.appendChild(download);
    }

    if (options.expandable) {
      const expand = element('button', classes.expand);
      expand.type = 'button';
      expand.title = 'Expand View';
      expand.innerHTML = EXPAND_ICON;
      expand.addEventListener('click', (event) => {
        event.stopPropagation();
        openModal(artifact);
      });
      controls.appendChild(expand);
    }

    if (collapse.arrow) {
      controls.appendChild(element('span', classes.collapseArrow, collapse.arrow.open));
    }

    if (controls !== header && controls.childElementCount > 0) header.appendChild(controls);
    return header;
  }

  function bindCollapse(header: HTMLElement, body: HTMLElement, type: string): void {
    if (!options.collapse) return;
    const trigger =
      collapse.trigger === 'header' ? header : header.firstElementChild as HTMLElement | null;
    if (!trigger) return;

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const closed =
        collapse.mode === 'display'
          ? toggleDisplay(body)
          : body.classList.toggle(classes.collapsed);
      const arrow = header.querySelector<HTMLElement>(`.${CSS.escape(classes.collapseArrow)}`);
      if (arrow && collapse.arrow) {
        arrow.textContent = closed ? collapse.arrow.closed : collapse.arrow.open;
      }
      options.trackEvent?.('artifact_card_toggled', { type, collapsed: closed });
    });
  }

  /** Returns whether the body ended up hidden. */
  function toggleDisplay(body: HTMLElement): boolean {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    return !hidden;
  }

  function add(artifact: Artifact, context: { step?: string } = {}): HTMLElement | null {
    if (!options.list) return null;
    dropEmptyState();
    artifacts.push(artifact);
    updateCounters();

    const type = artifact.type ?? 'text';
    const card = element('div', classes.card);
    card.id =
      options.cardId?.(artifact, artifacts.length) ??
      `artifact-${artifacts.length}-${slugifyDomId(artifact.id || artifact.title)}`;
    card.dataset.artifactId = artifact.id ?? '';

    const header = buildHeader(artifact, type);
    const body = element('div', classes.body);
    options.renderBody(body, artifact);
    bindCollapse(header, body, type);

    card.appendChild(header);
    card.appendChild(body);

    const container = groupContainer(artifact, context) ?? options.list;
    if (options.prepend) container.prepend(card);
    else container.appendChild(card);

    options.onCardAdded?.(artifact, card);
    return card;
  }

  function addAll(artifacts_: readonly Artifact[], context: { step?: string } = {}): void {
    for (const artifact of artifacts_) add(artifact, context);
  }

  function openModal(artifact: Artifact): void {
    options.onExpand?.(artifact);
    const type = artifact.type ?? 'text';
    const overlay = element('div', classes.modalOverlay);
    const content = element('div', classes.modalContent);
    const header = element('div', classes.modalHeader);
    const title = element('span', classes.title);
    title.innerHTML = `<span class="${classes.typeBadge} ${escapeHtml(type)}">${escapeHtml(
      typeLabel(type),
    )}</span>${escapeHtml(artifact.title || artifact.id || 'Artifact')}`;
    const close = element('button', classes.modalClose);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(close);
    const body = element('div', classes.modalBody);
    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // After attaching, because a body may measure its container — a chart
    // sized against a detached node collapses to zero width.
    options.renderBody(body, artifact);

    const dismiss = (): void => {
      overlay.classList.add('closing');
      window.setTimeout(() => overlay.remove(), 300);
    };
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
  }

  function scrollToCard(card: Element | null): void {
    highlightElement(card, options.highlight);
  }

  return {
    reset,
    add,
    addAll,
    scrollTo: (artifactId) => {
      scrollToCard(document.querySelector(`[data-artifact-id="${CSS.escape(artifactId)}"]`));
    },
    scrollToCard,
    count: () => artifacts.length,
    all: () => artifacts,
    openModal,
  };
}

/**
 * Serialises an artifact for download.
 *
 * A report is HTML because that is what an operator forwards; everything else
 * is its JSON payload, because that is what a reviewer re-reads. Shared so
 * the same artifact downloads under the same name from any portal.
 */
export function downloadArtifact(artifact: Artifact): void {
  const payload = (artifact.payload ?? {}) as Record<string, unknown>;
  const name = slugifyDomId(artifact.title || artifact.id);
  const isReport = (artifact.type ?? 'text') === 'report';
  const body = isReport
    ? String(payload.html ?? payload.content ?? JSON.stringify(payload, null, 2))
    : JSON.stringify(payload, null, 2);

  const blob = new Blob([body], { type: isReport ? 'text/html' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.${isReport ? 'html' : 'json'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- resize handle --------------------------------------------------------

export interface ResizeHandleOptions {
  handle: HTMLElement | null;
  /**
   * The panel being resized, when the width is applied to it directly. Omit
   * and pass `cssVariable` instead when a custom property drives the layout.
   */
  panel?: HTMLElement | null;
  /**
   * A custom property on `<html>` to write the size into, e.g.
   * `--conv-artifact-width`. Forecasting sizes its panel this way so a grid
   * track can read it.
   */
  cssVariable?: string;
  /** Which edge the drag grows from. Both existing panels are right-docked. */
  edge?: 'right' | 'left';
  /** Resolves the bounds at drag start, so they can depend on window size. */
  bounds: (axis: 'width' | 'height') => { min: number; max: number };
  /** Switches the drag to vertical, for a bottom-sheet drawer on a phone. */
  vertical?: () => boolean;
  /** Class put on `<body>` for the duration, to suppress text selection. */
  bodyClass?: string;
  /**
   * Called as the drag proceeds and once when it ends.
   *
   * Plotly sizes a chart to its container at draw time and does not observe
   * it, so every chart in a resized panel has to be re-measured or it keeps
   * its pre-drag width and clips.
   */
  onResize?: () => void;
  /** Persists the final size. The kit does not choose the preference name. */
  onCommit?: (size: number) => void;
}

export interface ResizeHandle {
  /** Applies a size, clamped to the current bounds. Used to restore a saved width. */
  set(size: number, axis?: 'width' | 'height'): void;
  get(axis?: 'width' | 'height'): number;
}

/**
 * Drag-resizes a docked panel. `portal_ui_standards.md` section 5a item 3
 * counts the handle as part of the artifact primitive.
 *
 * causal and forecasting each had their own copy of this: pointer capture, a
 * clamp, a body class during the drag, a persisted width and a chart
 * re-measure. The copies agreed on everything except the minimum width, which
 * is the kind of difference an operator notices only as "that panel won't go
 * as narrow over here".
 */
export function createResizeHandle(options: ResizeHandleOptions): ResizeHandle {
  const edge = options.edge ?? 'right';

  function apply(size: number, axis: 'width' | 'height'): number {
    const { min, max } = options.bounds(axis);
    const clamped = clamp(Math.round(size), min, max);
    if (options.cssVariable) {
      document.documentElement.style.setProperty(options.cssVariable, `${clamped}px`);
    } else if (options.panel) {
      options.panel.style[axis] = `${clamped}px`;
    }
    options.onResize?.();
    return clamped;
  }

  function current(axis: 'width' | 'height'): number {
    if (options.cssVariable) {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(
        options.cssVariable,
      );
      return Number(raw.replace('px', '').trim()) || options.bounds(axis).min;
    }
    if (!options.panel) return 0;
    return options.panel.getBoundingClientRect()[axis];
  }

  options.handle?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const vertical = options.vertical?.() ?? false;
    const axis = vertical ? 'height' : 'width';
    const start = vertical ? event.clientY : event.clientX;
    const startSize = current(axis);

    options.handle?.setPointerCapture?.(event.pointerId);
    if (options.bodyClass) document.body.classList.add(options.bodyClass);

    const move = (moveEvent: PointerEvent): void => {
      const delta = (vertical ? start - moveEvent.clientY : start - moveEvent.clientX) *
        (edge === 'right' ? 1 : -1);
      apply(startSize + delta, axis);
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (options.bodyClass) document.body.classList.remove(options.bodyClass);
      options.onResize?.();
      options.onCommit?.(current(axis));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  return {
    set: (size, axis = 'width') => {
      apply(size, axis);
    },
    get: (axis = 'width') => current(axis),
  };
}
