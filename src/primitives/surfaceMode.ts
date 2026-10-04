/**
 * Surface mode. `portal_ui_standards.md` section 5a item 5.
 *
 * Where a portal offers both surfaces, it uses predictive's explicit
 * `workbench` / `conversation` mode rather than inventing a third
 * arrangement. Two words, two meanings, everywhere.
 *
 * What this module does *not* do is pick a mode for a portal, and nothing here
 * prefers one. Section 5a is explicit that the primary interaction model
 * follows the shape of the task and is not a conformance item: causal is
 * conversation-first because causal analysis is a gated 14-stage workflow,
 * forecasting is workbench-first because it is iterative comparison, and
 * predictive is dual-mode because artifact review wants both. A portal
 * declares its `primary` here and — if it has only one surface — never calls
 * `set` again. Declaring it is the conformance item; which one it is, is not.
 */

import { resolveClasses, type ClassMap } from './dom.js';

export type SurfaceMode = 'workbench' | 'conversation';

export const SURFACE_MODES: readonly SurfaceMode[] = ['workbench', 'conversation'];

export function isSurfaceMode(value: unknown): value is SurfaceMode {
  return value === 'workbench' || value === 'conversation';
}

export type SurfaceSlot = 'active';

const DEFAULT_CLASSES: Readonly<Record<SurfaceSlot, string>> = { active: 'active' };

export interface SurfaceModeOptions {
  /**
   * Which surface this portal leads with.
   *
   * A single-surface portal declares it and offers no toggle, which is how
   * causal stops being "implicit (chat)" in the conformance table without
   * growing a workbench it has no use for.
   */
  primary: SurfaceMode;
  /** Both surfaces available, so the operator can switch. */
  dual?: boolean;
  /** Toggle buttons, each carrying its mode in `data-mode`. */
  toggle?: HTMLElement | null;
  /** How the mode is published to CSS. */
  paint?: {
    /** A data attribute on `<body>`, e.g. `uiMode` for `data-ui-mode`. */
    bodyAttribute?: string;
    /** A class on `<body>`, added only in `conversation`. */
    conversationClass?: string;
  };
  classNames?: ClassMap<SurfaceSlot>;
  /** Persists the choice. Omit for a portal that does not remember it. */
  store?: {
    read: () => string;
    write: (value: string) => void;
  };
  /** Seeds the initial mode from the URL, e.g. `?mode=conversation`. */
  queryParameter?: string;
  onChange?: (mode: SurfaceMode, previous: SurfaceMode | null) => void;
  trackEvent?: (name: string, payload?: Record<string, unknown>) => void;
}

export interface SurfaceModeController {
  get(): SurfaceMode;
  set(mode: SurfaceMode): void;
  /** The declared primary surface, whether or not it is the current one. */
  primary(): SurfaceMode;
  isDual(): boolean;
  /** Applies the stored or seeded mode and binds the toggle. Call once. */
  start(): SurfaceMode;
  /** Re-paints and re-binds the toggle after a portal re-renders its header. */
  bindToggle(): void;
}

export function createSurfaceMode(options: SurfaceModeOptions): SurfaceModeController {
  const classes = resolveClasses(DEFAULT_CLASSES, options.classNames);
  let mode: SurfaceMode = options.primary;
  let started = false;

  function paint(): void {
    const paintOptions = options.paint ?? {};
    if (paintOptions.bodyAttribute) {
      document.body.dataset[paintOptions.bodyAttribute] = mode;
    }
    if (paintOptions.conversationClass) {
      document.body.classList.toggle(paintOptions.conversationClass, mode === 'conversation');
    }
    for (const button of toggleButtons()) {
      const isCurrent = button.dataset.mode === mode;
      // An empty class name means the portal marks the current button by
      // `aria-pressed` alone, which predictive does.
      if (classes.active) button.classList.toggle(classes.active, isCurrent);
      // `aria-pressed` is what tells a screen reader which surface is
      // showing. A toggle that only changes a class is silent.
      button.setAttribute('aria-pressed', String(isCurrent));
    }
  }

  function toggleButtons(): HTMLElement[] {
    const container = options.toggle;
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>('[data-mode]')];
  }

  /**
   * Binds the toggle buttons.
   *
   * Separate from `start` because a portal that re-renders its whole header
   * from state — predictive does — throws its buttons away on every render and
   * has to bind the new ones.
   */
  function bindToggle(): void {
    if (!options.dual) return;
    for (const button of toggleButtons()) {
      button.addEventListener('click', () => {
        const next = button.dataset.mode;
        if (isSurfaceMode(next)) set(next);
      });
    }
  }

  function set(next: SurfaceMode): void {
    if (!isSurfaceMode(next)) return;
    const previous = started ? mode : null;
    if (started && next === mode) return;
    mode = next;
    started = true;
    paint();
    options.store?.write(mode);
    options.trackEvent?.('surface_mode_set', { mode });
    options.onChange?.(mode, previous);
  }

  function seed(): SurfaceMode {
    if (options.queryParameter) {
      const fromUrl = new URLSearchParams(window.location.search).get(options.queryParameter);
      if (isSurfaceMode(fromUrl)) return fromUrl;
    }
    const saved = options.store?.read();
    if (isSurfaceMode(saved)) return saved;
    return options.primary;
  }

  return {
    get: () => mode,
    set,
    primary: () => options.primary,
    isDual: () => options.dual === true,
    start: () => {
      // A single-surface portal still paints, so the body attribute a
      // stylesheet reads is present rather than absent-meaning-workbench.
      const initial = options.dual ? seed() : options.primary;
      started = false;
      set(initial);
      bindToggle();
      return mode;
    },
    bindToggle: () => {
      paint();
      bindToggle();
    },
  };
}
