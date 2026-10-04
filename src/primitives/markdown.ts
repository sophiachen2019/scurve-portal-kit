/**
 * One renderer for the markdown an agent writes back.
 *
 * This is a primitive by the section 5a test: all three portals render agent
 * prose, and all three did it differently — causal leans on a `marked` CDN
 * script with a three-expression fallback, forecasting hand-rolls a block
 * renderer, predictive escapes and shows the asterisks. The same agent reply
 * therefore reads as prose in two portals and as source in the third, which is
 * exactly the kind of wrong implementation that confuses an operator who uses
 * both.
 *
 * The implementation here is forecasting's, because it is the most complete of
 * the three and needs no CDN. It escapes before it formats, so an agent reply
 * cannot smuggle markup through (standards section 7).
 */

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/**
 * Escapes the three characters that can open a tag.
 *
 * Deliberately not the five-character `escapeHtml`: this output is spliced
 * into element bodies, never into an attribute, and quoting `'` here would put
 * `&#39;` in front of an operator reading ordinary prose.
 */
function escapeText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(value: string): string {
  return escapeText(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export interface MarkdownOptions {
  /** Class for the scroll wrapper around a table. */
  tableClass?: string;
}

/**
 * Renders the markdown subset agents actually emit: headings, bullet lists,
 * pipe tables, bold, italic, inline code, and paragraphs with soft breaks.
 */
export function renderAgentMarkdown(text: unknown, options: MarkdownOptions = {}): string {
  if (!text) return '';
  const tableClass = options.tableClass ?? 'conv-table-scroll';
  const blocks: string[] = [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  const isSeparator = (line: string | undefined): boolean =>
    line !== undefined && TABLE_SEPARATOR.test(line);
  const startsTable = (at: number): boolean =>
    (lines[at] ?? '').includes('|') && isSeparator(lines[at + 1]);

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (startsTable(index)) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        const row = splitTableRow(lines[index] ?? '');
        if (row.length === headers.length) rows.push(row);
        index += 1;
      }
      const head = headers.map((cell) => `<th>${inline(cell)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('');
      blocks.push(
        `<div class="${tableClass}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+/.exec(line);
    if (heading) {
      // One level deeper than the source, because an agent reply sits inside a
      // page that already owns h1 and h2.
      const level = heading[1]!.length + 1;
      blocks.push(`<h${level}>${inline(line.replace(/^#{1,3}\s+/, ''))}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^#{1,3}\s+/.test(lines[index] ?? '') &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '') &&
      !startsTable(index)
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }

  return blocks.join('');
}

/** The shape of the `marked` CDN global, as much of it as we touch. */
interface MarkedGlobal {
  parse?: (text: string) => string;
}

/**
 * Uses the `marked` CDN script when the page has it, and this module's
 * renderer when it does not.
 *
 * causal loads `marked` from a CDN, so a blocked CDN must not blank the
 * agent's reply. Its own fallback covered bold, inline code and line breaks
 * and dropped everything else — a blocked CDN turned a results table into a
 * wall of pipes. Falling back to `renderAgentMarkdown` keeps the loaded path
 * byte-identical and makes the degraded path legible.
 */
export function renderMarkdownWithMarked(text: unknown, options: MarkdownOptions = {}): string {
  const marked = (globalThis as { marked?: MarkedGlobal }).marked;
  if (marked && typeof marked.parse === 'function') {
    return marked.parse(String(text ?? ''));
  }
  return renderAgentMarkdown(text, options);
}
