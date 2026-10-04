/**
 * The small DOM helpers every primitive needs.
 *
 * `portal_ui_standards.md` section 7 requires every interpolated value in a
 * template literal to be escaped. All three portals build markup with template
 * strings and all three had their own escape function, which is exactly the
 * situation section 1 describes: one decision made three times by accident.
 * They did not agree — causal's went through `div.textContent`, which leaves
 * `"` and `'` intact and so is not safe in an attribute, while predictive's
 * covered all five characters. `escapeHtml` here is the strict one.
 */

/** Semantic slot name -> the class a portal actually uses for it. */
export type ClassMap<Slot extends string> = Readonly<Partial<Record<Slot, string>>>;

/**
 * Escapes a value for interpolation into HTML text *or* an attribute value.
 *
 * All five characters, because a primitive cannot know which position its
 * caller will interpolate into, and artifact payloads are LLM-authored.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

/** A DOM-id-safe slug, also used for download filenames. */
export function slugifyDomId(value: unknown): string {
  return (
    String(value ?? 'artifact')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'artifact'
  );
}

/** Escapes a value for use inside a CSS attribute selector. */
export function cssEscape(value: unknown): string {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(text);
  }
  return text.replace(/["\\]/g, '\\$&');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolves a class slot against a portal's overrides.
 *
 * A primitive names its slots semantically — `message`, `typeBadge`,
 * `pendingText` — and a portal maps each to the class its own stylesheet
 * already targets. That is what lets causal, forecasting and predictive share
 * one implementation without any of them changing how they look. The kit
 * default is what a new portal gets from `create-scurve-portal`, and it is the
 * vocabulary `primitives.css` styles.
 */
export function resolveClasses<Slot extends string>(
  defaults: Readonly<Record<Slot, string>>,
  overrides: ClassMap<Slot> | undefined,
): Readonly<Record<Slot, string>> {
  if (!overrides) return defaults;
  const resolved = { ...defaults } as Record<Slot, string>;
  for (const [slot, value] of Object.entries(overrides) as [Slot, string | undefined][]) {
    if (typeof value === 'string') resolved[slot] = value;
  }
  return resolved;
}

/** `createElement` with a class and optional text, which is most of what the primitives do. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Scrolls a container to its end, which is what every message append does. */
export function scrollToEnd(container: HTMLElement | null | undefined): void {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

export interface HighlightOptions {
  /** A CSS property name, hyphenated: `outline`, `border-color`. */
  property?: string;
  value?: string;
  /**
   * What to put back when the highlight expires, as an explicit value rather
   * than a remembered one. `none` and `''` are not interchangeable: `''` drops
   * the inline declaration and lets the stylesheet apply again, `none`
   * suppresses it. Whichever the portal used before must be what it uses now.
   */
  restore?: string;
  durationMs?: number;
  block?: ScrollLogicalPosition;
}

/**
 * Scrolls an element into view and marks it briefly.
 *
 * Shared because the gesture is shared: an artifact chip in the conversation
 * points at a card in the artifact panel, and the operator needs to see which
 * one it landed on. causal outlines, forecasting recolours the border; the
 * property and value are the caller's, the timing is not.
 */
export function highlightElement(
  target: Element | null | undefined,
  options: HighlightOptions = {},
): void {
  if (!target) return;
  const node = target as HTMLElement;
  node.scrollIntoView({ behavior: 'smooth', block: options.block ?? 'center' });
  const property = options.property ?? 'outline';
  node.style.setProperty(property, options.value ?? '2px solid var(--accent)');
  window.setTimeout(() => {
    node.style.setProperty(property, options.restore ?? 'none');
  }, options.durationMs ?? 2000);
}
