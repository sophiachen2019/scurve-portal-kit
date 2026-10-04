/*
 * A normalized DOM signature, for proving a refactor changed nothing.
 *
 * `portal_ui_standards.md` section 9 step 5 moves three shipped portals onto
 * shared primitives, and the only acceptable outcome is that all three render
 * exactly as they did. Screenshots catch a layout shift but not a changed
 * class name that happens to be unstyled today and styled tomorrow, and a
 * Node-side DOM stub proves nothing about a real browser (see the 5a block in
 * `verify.mjs`). This runs in the page, against the real stylesheet.
 *
 * It is a plain browser script with no dependencies and no build step, so it
 * can be evaluated in a dev-server page or a built `dist/` preview:
 *
 *     // before the change
 *     const before = scurveDomSnapshot(document.body);
 *     // after the change, in the same page state
 *     scurveDomDiff(before, scurveDomSnapshot(document.body));
 *
 * `scurveDomSnapshot` also records the computed styles that decide layout, so
 * a change that keeps the markup and moves the pixels is caught too.
 *
 * Not shipped: `scripts/` is outside the package `files` list.
 */

(function attach(global) {
  /*
   * Values that legitimately differ between two loads of the same page and
   * would otherwise swamp the diff. Everything here is replaced by a token,
   * not dropped, so a *missing* id is still a difference.
   */
  const VOLATILE = [
    // Session, run, job, dataset and artifact identifiers.
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
    [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
    // Epoch-ish numbers, e.g. forecast_1738000000000.
    [/\b\d{10,}\b/g, '<epoch>'],
    // ISO timestamps and dates.
    [/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<timestamp>'],
    // Vite's content-hashed asset names.
    [/-[A-Za-z0-9_-]{8}\.(js|css|png|svg|woff2?)/g, '-<hash>.$1'],
  ];

  /** Computed properties that decide whether something moved or changed colour. */
  const STYLE_PROPERTIES = [
    'display',
    'position',
    'flex-direction',
    'grid-template-columns',
    'gap',
    'width',
    'height',
    'margin',
    'padding',
    'border-width',
    'border-radius',
    'border-color',
    'background-color',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'text-transform',
    'white-space',
    'opacity',
    'visibility',
    'overflow',
    'z-index',
  ];

  /** Attributes that change what an element *is*, rather than what it holds. */
  const STRUCTURAL_ATTRIBUTES = [
    'type',
    'role',
    'hidden',
    'disabled',
    'inert',
    'open',
    'aria-pressed',
    'aria-expanded',
    'aria-busy',
    'aria-label',
    'aria-live',
    'placeholder',
    'alt',
    'for',
    'name',
    'value',
    'checked',
    'colspan',
    'data-mode',
    'data-step',
    'data-phase',
    'data-action',
    'data-nav',
    'data-artifact-id',
    'data-group',
  ];

  function normalizeText(value) {
    let text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    for (const [pattern, token] of VOLATILE) text = text.replace(pattern, token);
    return text;
  }

  function classSignature(element) {
    // Sorted, because class order is not meaningful to CSS and a primitive is
    // free to assemble it differently.
    return Array.from(element.classList).sort().join('.');
  }

  function attributeSignature(element) {
    const parts = [];
    for (const name of STRUCTURAL_ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      parts.push(`${name}=${normalizeText(element.getAttribute(name))}`);
    }
    return parts.join(' ');
  }

  function styleSignature(element, includeStyles) {
    if (!includeStyles) return '';
    const computed = getComputedStyle(element);
    const parts = [];
    for (const property of STYLE_PROPERTIES) {
      parts.push(`${property}:${computed.getPropertyValue(property)}`);
    }
    return parts.join(';');
  }

  /**
   * Walks an element into a line-per-node signature.
   *
   * Line-per-node rather than a tree dump, so a plain text diff points at the
   * node that changed instead of reflowing everything after it.
   */
  function snapshot(root, options) {
    const settings = Object.assign({ styles: true, maxDepth: 40 }, options);
    const lines = [];

    function walk(node, depth) {
      if (depth > settings.maxDepth) return;

      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const text = normalizeText(child.nodeValue);
          // Whitespace-only text nodes are dropped: they are formatting, and
          // in a flex container they do not generate boxes at all. That is
          // exactly the difference between markup built by `innerHTML` with
          // newlines and the same markup built by `createElement`.
          if (text) lines.push(`${'  '.repeat(depth)}"${text}"`);
          continue;
        }
        if (child.nodeType !== 1) continue;

        // Script and style content is not rendered.
        const tag = child.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;

        const classes = classSignature(child);
        const attributes = attributeSignature(child);
        const styles = styleSignature(child, settings.styles);
        lines.push(
          `${'  '.repeat(depth)}<${tag}${classes ? '.' + classes : ''}` +
            `${attributes ? ' [' + attributes + ']' : ''}>` +
            `${styles ? '  {' + styles + '}' : ''}`,
        );
        walk(child, depth + 1);
      }
    }

    walk(root, 0);
    return lines.join('\n');
  }

  /** The first differing lines, with context, or an empty array when identical. */
  function diff(before, after, context) {
    const limit = context == null ? 12 : context;
    const a = String(before).split('\n');
    const b = String(after).split('\n');
    const differences = [];
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if (a[index] === b[index]) continue;
      differences.push({
        line: index + 1,
        before: a[index] === undefined ? '<absent>' : a[index],
        after: b[index] === undefined ? '<absent>' : b[index],
      });
      if (differences.length >= limit) break;
    }
    return differences;
  }

  global.scurveDomSnapshot = snapshot;
  global.scurveDomDiff = diff;
})(typeof window === 'undefined' ? globalThis : window);
