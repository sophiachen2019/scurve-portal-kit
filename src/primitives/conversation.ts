/**
 * The conversation surface. `portal_ui_standards.md` section 5a item 2.
 *
 * One component: message list, composer, suggested-action chips, streaming and
 * error states. All three portals already had one, which is why this is a
 * primitive rather than a guess — the shared API below is the intersection of
 * three working implementations.
 *
 * What this module does *not* do is decide where the conversation sits or
 * whether it is the primary surface. Section 5a is explicit that causal is
 * conversation-first, forecasting workbench-first and predictive dual-mode,
 * that the divergence follows the shape of the task, and that primary
 * interaction model is not a conformance item. A portal composes this; it does
 * not inherit a layout from it.
 *
 * No network access, per section 3: a render function that fetches cannot be
 * tested or reused. Every method here takes data the caller already has.
 */

import {
  element,
  escapeHtml,
  resolveClasses,
  scrollToEnd,
  type ClassMap,
} from './dom.js';

/**
 * Who a message is from.
 *
 * Three kinds, because all three portals have exactly these three: what the
 * operator typed, what the agent answered, and what the portal itself had to
 * say. `system` carries an `error` flavour rather than being a fourth kind,
 * because an error *is* the portal talking.
 */
export type MessageKind = 'user' | 'agent' | 'system';

export type ConversationSlot =
  | 'message'
  | 'user'
  | 'agent'
  | 'system'
  | 'error'
  | 'artifactChips'
  | 'artifactChip'
  | 'pending'
  | 'pendingDots'
  | 'pendingText'
  | 'suggestion';

const DEFAULT_CLASSES: Readonly<Record<ConversationSlot, string>> = {
  message: 'conversation-message',
  user: 'user',
  agent: 'agent',
  system: 'system',
  error: 'error',
  artifactChips: 'conversation-artifact-chips',
  artifactChip: 'conversation-artifact-chip',
  pending: 'conversation-pending',
  pendingDots: 'conversation-pending-dots',
  pendingText: 'conversation-pending-text',
  suggestion: 'conversation-suggestion',
};

/** An artifact as the conversation needs to know it: something to point at. */
export interface ConversationArtifactRef {
  id?: string;
  title?: string;
  type?: string;
}

export interface ComposerOptions {
  input: HTMLInputElement | HTMLTextAreaElement | null;
  send?: HTMLElement | null;
  /** Called with the trimmed text, after the field has been cleared. */
  onSubmit: (text: string) => void | Promise<void>;
  /**
   * Refuses the submission before the field is cleared.
   *
   * Checked synchronously and before clearing, because that is the only order
   * that is correct in both directions: the field has to empty the instant the
   * operator presses Enter, not when the response lands, and a submission the
   * portal cannot act on must leave what they typed alone. causal uses this
   * when there is no session yet.
   */
  canSubmit?: () => boolean;
  /** Enter sends, Shift+Enter inserts a newline. All three portals do this. */
  submitOnEnter?: boolean;
}

export interface SuggestionsOptions<Item> {
  container: HTMLElement | null;
  /** Called with the item's action id and its params, if it carries any. */
  onAction: (action: string, params: Record<string, unknown>) => void;
  /**
   * Turns a portal's suggestion into the primitive's shape. causal's arrive as
   * `{action, label, params}` objects, forecasting's as bare strings.
   */
  normalize?: (item: Item) => { action: string; label: string; params?: Record<string, unknown> };
  /** Decorates the visible label, e.g. forecasting's leading emoji. */
  decorate?: (label: string, action: string) => string;
  /**
   * Drops a suggestion the surface cannot honour. causal hides
   * `upload_dataset`, because the chip would be a dead end — the file picker
   * is reachable only from the sidebar and the import modal.
   */
  filter?: (entry: { action: string; label: string }) => boolean;
  /** Caps the row. Forecasting keeps at most seven. */
  limit?: number;
  /** Drops repeats, compared case-insensitively on the action. */
  dedupe?: boolean;
  /**
   * Sets `hidden` on the container when there is nothing to suggest.
   *
   * Evaluated against what the caller passed, *before* `filter` and `limit`,
   * because that is what causal does: a response offering only
   * `upload_dataset` leaves an empty but visible row, and the row has padding.
   */
  hideWhenEmpty?: boolean;
  /** Attribute to carry the action on each button, e.g. `data-action`. */
  actionAttribute?: string;
}

export interface ConversationOptions<Item = unknown> {
  /** The scrolling message container. */
  messages: HTMLElement | null;
  classNames?: ClassMap<ConversationSlot>;
  /**
   * Renders agent prose to HTML. Defaults to the kit's `renderAgentMarkdown`
   * via `markdown.js`; a portal only passes this to keep an existing
   * renderer's exact output.
   */
  renderMarkdown?: (text: string) => string;
  /** Called with an artifact id when an in-message chip is clicked. */
  onArtifactChip?: (artifactId: string) => void;
  /** The chip's visible text. Forecasting prefixes an emoji. */
  chipLabel?: (artifact: ConversationArtifactRef) => string;
  /**
   * The welcome block to remove once there is a real message, if the portal
   * wants that tied to messages. causal removes its own when the session
   * starts instead, and passes nothing here.
   */
  welcome?: HTMLElement | null;
  /**
   * Whether a `system` message also clears the welcome block.
   *
   * Default `false`, which is forecasting's behaviour: a "session started" or
   * "configuration changed" line is the portal talking, and it should not
   * displace the block that tells a first-time operator what to do.
   */
  systemClearsWelcome?: boolean;
  /** The id the pending indicator is found by, so it can be replaced. */
  pendingElementId?: string;
  composer?: ComposerOptions;
  suggestions?: SuggestionsOptions<Item>;
}

export interface PendingOptions {
  /**
   * Further lines to rotate through while the work is in flight.
   *
   * Section 4.5: a queued job is not a completed job. Forecasting narrates the
   * agent's actual stages here so a long run does not look like a hang; causal
   * shows one line. Rotation stops on the last message rather than looping,
   * because looping would suggest progress that is not being observed.
   */
  rotate?: readonly string[];
  rotateMs?: number;
}

export interface Conversation<Item = unknown> {
  addUser(text: string): HTMLElement;
  addAgent(text: string, artifacts?: readonly ConversationArtifactRef[]): HTMLElement;
  addSystem(text: string, options?: { error?: boolean }): HTMLElement;
  /** Shows the streaming state. Replaces any indicator already up. */
  showPending(message?: string, options?: PendingOptions): void;
  /** Rewrites the pending line in place, keeping the animation running. */
  updatePending(message: string): void;
  clearPending(): void;
  /** Locks the composer while a step is in flight, and unlocks it after. */
  setBusy(busy: boolean): void;
  isBusy(): boolean;
  setSuggestions(items: readonly Item[]): void;
  clear(): void;
  scrollToEnd(): void;
  /** Re-reads the composer and suggestion elements after a full re-render. */
  attach(elements: {
    messages?: HTMLElement | null;
    input?: HTMLInputElement | HTMLTextAreaElement | null;
    send?: HTMLElement | null;
    suggestions?: HTMLElement | null;
  }): void;
}

const PENDING_ID = 'conversation-pending-indicator';

export function createConversation<Item = unknown>(
  options: ConversationOptions<Item>,
): Conversation<Item> {
  const classes = resolveClasses(DEFAULT_CLASSES, options.classNames);
  const pendingId = options.pendingElementId ?? PENDING_ID;
  const renderMarkdown = options.renderMarkdown;
  const chipLabel =
    options.chipLabel ?? ((artifact: ConversationArtifactRef) => artifact.title || artifact.id || 'Artifact');

  let messages = options.messages;
  let welcome = options.welcome ?? null;
  let composerInput = options.composer?.input ?? null;
  let composerSend = options.composer?.send ?? null;
  let suggestionsContainer = options.suggestions?.container ?? null;
  let busy = false;
  let rotateTimer: ReturnType<typeof setInterval> | null = null;
  // Held rather than re-queried: the indicator is replaced wholesale on every
  // `showPending`, so a selector would have to escape a portal-supplied class
  // name on every rotation tick to find what we just built.
  let pendingText: HTMLElement | null = null;

  function classFor(kind: MessageKind, error: boolean): string {
    const parts = [classes.message, classes[kind]];
    if (error) parts.push(classes.error);
    return parts.filter(Boolean).join(' ');
  }

  function dropWelcome(kind: MessageKind): void {
    if (!welcome) return;
    if (kind === 'system' && options.systemClearsWelcome !== true) return;
    welcome.remove();
    welcome = null;
  }

  function append(node: HTMLElement): HTMLElement {
    messages?.appendChild(node);
    scrollToEnd(messages);
    return node;
  }

  function addUser(text: string): HTMLElement {
    dropWelcome('user');
    return append(element('div', classFor('user', false), text));
  }

  function addAgent(
    text: string,
    artifacts: readonly ConversationArtifactRef[] = [],
  ): HTMLElement {
    dropWelcome('agent');
    const node = element('div', classFor('agent', false));
    node.innerHTML = renderMarkdown ? renderMarkdown(String(text ?? '')) : escapeHtml(text);

    if (artifacts.length > 0) {
      const chips = element('div', classes.artifactChips);
      for (const artifact of artifacts) {
        const chip = element('span', classes.artifactChip, chipLabel(artifact));
        chip.addEventListener('click', () => {
          if (artifact.id) options.onArtifactChip?.(artifact.id);
        });
        chips.appendChild(chip);
      }
      node.appendChild(chips);
    }

    return append(node);
  }

  function addSystem(text: string, { error = false } = {}): HTMLElement {
    dropWelcome('system');
    return append(element('div', classFor('system', error), text));
  }

  function stopRotation(): void {
    if (rotateTimer !== null) clearInterval(rotateTimer);
    rotateTimer = null;
  }

  function clearPending(): void {
    stopRotation();
    // By id, not by the held reference: a portal that rebuilds its message
    // list from state can leave an indicator in the DOM that this closure no
    // longer points at.
    document.getElementById(pendingId)?.remove();
    pendingText = null;
  }

  function showPending(message = 'Working…', pending: PendingOptions = {}): void {
    // Replace rather than stack. A second indicator left behind by a path that
    // forgot to clear the first reads as two runs in flight.
    clearPending();

    const container = element('div', classes.pending);
    container.id = pendingId;
    const dots = element('div', classes.pendingDots);
    dots.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(dots);
    pendingText = element('span', classes.pendingText, message);
    container.appendChild(pendingText);
    append(container);

    const rotate = pending.rotate ?? [];
    if (rotate.length === 0) return;
    let index = 0;
    rotateTimer = setInterval(() => {
      index = Math.min(index + 1, rotate.length - 1);
      updatePending(rotate[index]!);
      if (index === rotate.length - 1) stopRotation();
    }, pending.rotateMs ?? 2600);
  }

  function updatePending(message: string): void {
    if (pendingText) pendingText.textContent = message;
    scrollToEnd(messages);
  }

  function setBusy(next: boolean): void {
    busy = next;
    if (composerInput) composerInput.disabled = next;
    if (composerSend instanceof HTMLButtonElement) composerSend.disabled = next;
    if (!next) composerInput?.focus();
  }

  function submit(): void {
    const composer = options.composer;
    if (!composer || !composerInput) return;
    const text = composerInput.value.trim();
    if (!text || busy) return;
    if (composer.canSubmit && !composer.canSubmit()) return;
    composerInput.value = '';
    void composer.onSubmit(text);
  }

  function normalizeSuggestions(items: readonly Item[]): {
    action: string;
    label: string;
    params: Record<string, unknown>;
  }[] {
    const config = options.suggestions;
    if (!config) return [];
    const normalize =
      config.normalize ??
      ((item: Item) => ({ action: String(item), label: String(item), params: {} }));

    let entries = items.map((item) => {
      const normalized = normalize(item);
      return {
        action: normalized.action,
        label: normalized.label,
        params: normalized.params ?? {},
      };
    });

    if (config.filter) entries = entries.filter(config.filter);
    if (config.dedupe) entries = dedupeByAction(entries);
    if (config.limit !== undefined) entries = entries.slice(0, config.limit);
    return entries;
  }

  function setSuggestions(items: readonly Item[]): void {
    const config = options.suggestions;
    if (!config || !suggestionsContainer) return;

    suggestionsContainer.innerHTML = '';

    if (config.hideWhenEmpty) {
      // Against the caller's list, not the filtered one — see the option's own
      // comment. A row that is empty but present is a layout decision the
      // portal already made.
      suggestionsContainer.hidden = items.length === 0;
      if (items.length === 0) return;
    }

    for (const entry of normalizeSuggestions(items)) {
      const button = element('button', classes.suggestion);
      button.type = 'button';
      button.textContent = config.decorate
        ? config.decorate(entry.label, entry.action)
        : entry.label;
      if (config.actionAttribute) button.setAttribute(config.actionAttribute, entry.action);
      button.addEventListener('click', () => config.onAction(entry.action, entry.params));
      suggestionsContainer.appendChild(button);
    }
  }

  function bindComposer(): void {
    const composer = options.composer;
    if (!composer) return;
    if (composerSend) {
      composerSend.addEventListener('click', () => void submit());
    }
    if (composerInput && composer.submitOnEnter !== false) {
      // Narrowed to the base element so `keydown` resolves to KeyboardEvent:
      // across the input/textarea union TypeScript falls back to the generic
      // `Event` overload, which has no `key`.
      const field: HTMLElement = composerInput;
      field.addEventListener('keydown', (event) => {
        // Shift+Enter inserts a newline, which is what a textarea composer
        // needs and what all three portals already do.
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        submit();
      });
    }
  }

  bindComposer();

  return {
    addUser,
    addAgent,
    addSystem,
    showPending,
    updatePending,
    clearPending,
    setBusy,
    isBusy: () => busy,
    setSuggestions,
    clear: () => {
      stopRotation();
      pendingText = null;
      if (messages) messages.innerHTML = '';
    },
    scrollToEnd: () => scrollToEnd(messages),
    attach: (next) => {
      if (next.messages !== undefined) messages = next.messages;
      if (next.suggestions !== undefined) suggestionsContainer = next.suggestions;
      if (next.input !== undefined || next.send !== undefined) {
        if (next.input !== undefined) composerInput = next.input;
        if (next.send !== undefined) composerSend = next.send;
        bindComposer();
      }
    },
  };
}

/**
 * Drops repeated suggestions, comparing case-insensitively, and keeps the
 * first occurrence.
 *
 * Exported because a portal assembles its contextual suggestions before
 * handing them over — forecasting merges the agent's `suggested_actions` with
 * its own follow-ups and the two overlap — so the dedupe has to be available
 * outside `setSuggestions` as well as inside it.
 */
export function dedupeByAction<T extends { action: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.action.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The same dedupe for the bare-string lists forecasting builds. */
export function dedupeActions(actions: readonly string[], limit?: number): string[] {
  const deduped = dedupeByAction(actions.map((action) => ({ action }))).map(
    (entry) => entry.action,
  );
  return limit === undefined ? deduped : deduped.slice(0, limit);
}
