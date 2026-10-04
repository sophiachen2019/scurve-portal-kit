/**
 * Renders an artifact's own content.
 *
 * This is the part of the artifact surface that is deliberately *not* in the
 * kit. `portal_ui_standards.md` section 5a: the practical test for membership
 * is whether two portals would both need it and a wrong implementation would
 * confuse an operator who uses both. Chart types, DAG editors and model cards
 * fail that test and stay local — they are the product.
 *
 * The kit owns the frame around this: the card, the type badge, collapse,
 * expand-to-modal, the counters and the resize handle.
 *
 * No network access (section 3), and every interpolated value is escaped
 * (section 7) — artifact payloads come from an LLM-authored agent response.
 */

import { escapeHtml, type Artifact } from '@scurve/portal-kit';

interface TablePayload {
  headers?: string[];
  rows?: unknown[][];
}

function renderTable(payload: TablePayload): string {
  const headers = payload.headers ?? [];
  const rows = payload.rows ?? [];
  if (headers.length === 0 && rows.length === 0) return '<p class="muted">Empty table.</p>';
  return (
    '<div class="table-wrap"><table><thead><tr>' +
    headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('') +
    '</tr></thead><tbody>' +
    rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(formatCell(cell))}</td>`).join('')}</tr>`)
      .join('') +
    '</tbody></table></div>'
  );
}

/** Trims float noise out of table cells without touching integers or text. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(2);
  return String(value);
}

/**
 * Fills a card body for one artifact.
 *
 * Add a branch per artifact type your platform returns. The fallback is
 * deliberately a readable dump rather than nothing: an artifact the portal has
 * no renderer for should still be inspectable, not invisible.
 */
export function renderArtifactBody(container: HTMLElement, artifact: Artifact): void {
  const payload = (artifact.payload ?? {}) as Record<string, unknown>;

  switch (artifact.type) {
    case 'table':
      container.innerHTML = renderTable(payload as TablePayload);
      return;
    case 'text':
      container.innerHTML = `<p>${escapeHtml(payload.content ?? '')}</p>`;
      return;
    case 'report':
      // Already HTML from the platform, so it is inserted as-is. If your
      // platform's reports are operator- or LLM-authored, sanitise first.
      container.innerHTML = String(payload.html ?? payload.content ?? '');
      return;
    default:
      container.innerHTML = `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
  }
}
