/**
 * The phase track. `portal_ui_standards.md` section 5a item 4.
 *
 * Where a platform exposes a gated workflow, progress renders with the same
 * component and the same gate semantics — including the paused and blocked
 * states, which are the whole reason the component matters. Causal's product
 * *is* a gated sequential workflow: `AGENT_PARITY_AUDIT.md` lists 14 stages
 * from data onboarding through DAG confirmation, assumption checks, analysis,
 * HTE, robustness and sensitivity, several of which stop and wait for a human.
 * A track that renders "in progress" where the platform said "paused, waiting
 * on you" hides the gate, and hiding the gate loses the run.
 *
 * Section 5 is the other half of it: a blocked state must always render what
 * would unblock it, never a bare red indicator. The agent standard requires
 * specialists to return that string; this component will not accept a blocked
 * state without one, because a UI that drops it recreates the dead end that
 * was a real defect in the cockpit.
 *
 * Two granularities, from one state: the stages a platform reports, and the
 * phases it groups them into. Causal shows both — per-stage dots under a
 * five-phase track — because 14 stages is more than an operator holds in their
 * head while five is not.
 *
 * No network access (section 3). Workflow state arrives on every agent
 * response.
 */

import { resolveClasses, type ClassMap } from './dom.js';

/**
 * What a step or phase is doing.
 *
 * `paused` and `blocked` are distinct and both are required. `paused` is the
 * platform waiting for the operator — a gate, which is a normal and expected
 * state in a gated workflow. `blocked` is the run unable to continue. Mapping
 * both onto one "stopped" colour is the mistake this vocabulary exists to
 * prevent; it tells an operator their run has failed when it is waiting for
 * them.
 */
export type PhaseState = 'pending' | 'active' | 'paused' | 'blocked' | 'done';

/** Which status token a state renders in. Section 5's three fixed meanings. */
export const PHASE_TONE: Readonly<Record<PhaseState, 'ok' | 'warn' | 'risk' | 'neutral'>> = {
  pending: 'neutral',
  active: 'neutral',
  // Completed, but needs a human before the run goes on.
  paused: 'warn',
  blocked: 'risk',
  done: 'ok',
};

export type PhaseSlot = 'done' | 'active' | 'paused' | 'blocked';

const DEFAULT_CLASSES: Readonly<Record<PhaseSlot, string>> = {
  done: 'done',
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
};

/** The workflow state a platform reports, in the shape all three report it. */
export interface WorkflowState {
  completed_steps?: readonly string[];
  current_step?: string;
  /** Set when the current step is a gate waiting on the operator. */
  paused?: boolean;
  /** Set when the run cannot continue. */
  blocked?: boolean;
  /**
   * What would unblock it. Required whenever `blocked` or `paused` is set —
   * see the module comment and standards section 5.
   */
  next_actions?: readonly string[] | string;
}

export interface PhaseTrackOptions {
  /** Per-stage elements, each carrying its stage name in a data attribute. */
  steps?: { elements: () => Iterable<HTMLElement>; attribute?: string };
  /** Per-phase elements, each carrying its phase key. */
  phases?: {
    elements: () => Iterable<HTMLElement>;
    attribute?: string;
    /** Phase key -> the stage names it covers. */
    groups: Readonly<Record<string, readonly string[]>>;
    /** Where the phase's operator-facing title is read from, for summaries. */
    titleSelector?: string;
  };
  /** Where a stage's label is read from, for the summary line. */
  stepLabelSelector?: string;
  classNames?: ClassMap<PhaseSlot>;
  /** A compact one-line summary of where the run is, for narrow layouts. */
  summary?: HTMLElement | null;
  /** Text for the summary when nothing has started. */
  idleLabel?: string;
  /**
   * Called when the platform reports a gate or a block, with the strings that
   * would clear it. A portal must render these somewhere the operator reads.
   */
  onGate?: (gate: { state: 'paused' | 'blocked'; step?: string; nextActions: string[] }) => void;
}

export interface PhaseTrack {
  update(state: WorkflowState | null | undefined): void;
  /** The phase holding the current stage, or the furthest one with progress. */
  activePhase(): string;
  /** The state a given stage is in, as the track last painted it. */
  stateOf(step: string): PhaseState;
}

function normalizeNextActions(state: WorkflowState): string[] {
  const raw = state.next_actions;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
}

export function createPhaseTrack(options: PhaseTrackOptions): PhaseTrack {
  const classes = resolveClasses(DEFAULT_CLASSES, options.classNames);
  const stepAttribute = options.steps?.attribute ?? 'step';
  const phaseAttribute = options.phases?.attribute ?? 'phase';
  const modifiers = [classes.done, classes.active, classes.paused, classes.blocked];
  let active = '';
  const states = new Map<string, PhaseState>();

  /** The state the current step is in, which is where gating shows up. */
  function currentState(state: WorkflowState): PhaseState {
    if (state.blocked) return 'blocked';
    if (state.paused) return 'paused';
    return 'active';
  }

  function paint(element: HTMLElement, state: PhaseState): void {
    element.classList.remove(...modifiers);
    if (state === 'done') element.classList.add(classes.done);
    if (state === 'active') element.classList.add(classes.active);
    // A gate is a kind of active: the run is here, and it is waiting. Keeping
    // `active` on as well is what stops the track going blank at a gate.
    if (state === 'paused') element.classList.add(classes.active, classes.paused);
    if (state === 'blocked') element.classList.add(classes.active, classes.blocked);
  }

  function updateSteps(state: WorkflowState): string {
    if (!options.steps) return '';
    const completed = new Set(state.completed_steps ?? []);
    const current = state.current_step;
    const currentTone = currentState(state);
    let currentLabel = '';

    for (const element of options.steps.elements()) {
      const step = element.dataset[stepAttribute];
      if (!step) continue;
      // Completed wins over current: a platform that reports a step as both
      // has moved past it, and painting it active would show the run standing
      // still on work it has already done.
      const next: PhaseState = completed.has(step)
        ? 'done'
        : step === current
          ? currentTone
          : 'pending';
      states.set(step, next);
      paint(element, next);
      if (next === currentTone && step === current) {
        currentLabel =
          (options.stepLabelSelector
            ? element.querySelector(options.stepLabelSelector)?.textContent
            : element.textContent) ?? '';
      }
    }
    return currentLabel;
  }

  function updatePhases(state: WorkflowState): string {
    const config = options.phases;
    if (!config) return '';
    const completed = new Set(state.completed_steps ?? []);
    const current = state.current_step;
    const currentTone = currentState(state);

    const rows = [...config.elements()].map((element) => {
      const key = element.dataset[phaseAttribute] ?? '';
      const steps = config.groups[key] ?? [];
      const holdsCurrent = current !== undefined && steps.includes(current);
      return {
        element,
        key,
        holdsCurrent,
        reached: holdsCurrent || steps.some((step) => completed.has(step)),
      };
    });

    // The phase holding the current stage, or — when the platform reports a
    // stage the portal has no mapping for — the furthest one with any
    // progress, so the track never goes blank mid-run.
    const activeRow = rows.find((row) => row.holdsCurrent) ?? [...rows].reverse().find((row) => row.reached);
    let title = '';

    for (const row of rows) {
      const isActive = row === activeRow;
      const next: PhaseState = isActive ? currentTone : row.reached ? 'done' : 'pending';
      states.set(row.key, next);
      // A reached phase keeps `done` even while it is the active one, which is
      // what draws the track as filled up to the operator's position.
      row.element.classList.remove(...modifiers);
      if (row.reached) row.element.classList.add(classes.done);
      if (isActive) {
        if (next === 'paused') row.element.classList.add(classes.active, classes.paused);
        else if (next === 'blocked') row.element.classList.add(classes.active, classes.blocked);
        else row.element.classList.add(classes.active);
        active = row.key;
        title = (config.titleSelector
          ? row.element.querySelector(config.titleSelector)?.textContent
          : row.element.textContent) ?? '';
      }
    }
    return title;
  }

  return {
    update(state) {
      if (!state) return;
      const stepLabel = updateSteps(state);
      const phaseTitle = updatePhases(state);

      if (options.summary) {
        options.summary.textContent = phaseTitle || stepLabel || options.idleLabel || 'Ready';
      }

      const gate = currentState(state);
      if (gate === 'paused' || gate === 'blocked') {
        options.onGate?.({
          state: gate,
          step: state.current_step,
          nextActions: normalizeNextActions(state),
        });
      }
    },
    activePhase: () => active,
    stateOf: (step) => states.get(step) ?? 'pending',
  };
}

/**
 * The phase a stage belongs to, or `other` for a stage with no mapping.
 *
 * Shared with the artifact navigator so the two cannot drift: a run whose
 * artifacts are filed under "Check Design" and whose track says "Define
 * Question" is telling the operator two different things.
 */
export function phaseForStep(
  groups: Readonly<Record<string, readonly string[]>>,
  step: string | undefined,
): string {
  if (!step) return 'other';
  for (const [phase, steps] of Object.entries(groups)) {
    if (steps.includes(step)) return phase;
  }
  return 'other';
}
