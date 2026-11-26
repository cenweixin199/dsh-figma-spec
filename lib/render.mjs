/**
 * Renderers: normalized records -> CSV, Markdown, tree, or a compact summary.
 *
 * Output is budgeted. A 1920x1200 dashboard frame normalizes to ~540 records;
 * dumping that as Markdown would flood the model context, so `summary` is the
 * default and the full table is opt-in.
 */

const CSV_COLUMNS = [
  'path',
  'depth',
  'type',
  'name',
  'x',
  'y',
  'w',
  'h',
  'fills',
  'strokes',
  'strokeWeight',
  'strokeSides',
  'radius',
  'effects',
  'opacity',
  'layout',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeightPx',
  'textAlign',
  'text',
];

function cell(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(' | ');
  // Keep one physical row per record: a real newline inside a quoted CSV field
  // is legal RFC 4180 but breaks row counting, grep, and spreadsheet paste.
  return String(v).replace(/\r\n|\r|\n/g, '\\n');
}

function csvEscape(v) {
  const s = cell(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(records) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of records) {
    lines.push(
      CSV_COLUMNS.map((c) => {
        if (c === 'x' || c === 'y' || c === 'w' || c === 'h') return cell(r.box?.[c]);
        return csvEscape(r[c]);
      }).join(','),
    );
  }
  return lines.join('\n');
}

const escapePipes = (s) => String(s ?? '').replaceAll('|', '\\|');
const tidyName = (s) => String(s ?? 'Figma node').trim().replace(/\s+/g, ' ');

export function toMarkdown(records, { limit = 200 } = {}) {
  const rows = records.slice(0, limit);
  const out = ['| # | Type | Name | Box (x,y,w x h) | Fill | Radius | Type scale |',
    '|---|---|---|---|---|---|---|'];
  rows.forEach((r, i) => {
    const box = r.box ? `${r.box.x},${r.box.y} ${r.box.w}x${r.box.h}` : '-';
    const type = r.type === 'TEXT' ? `${r.fontSize}px/${r.fontWeight}` : (r.layout ?? '');
    out.push(
      `| ${i + 1} | ${r.type} | ${escapePipes(r.name)} | ${box} | ${escapePipes(cell(r.fills))} | ${r.radius ?? ''} | ${type} |`,
    );
  });
  if (records.length > limit) {
    out.push(`| ... | | ${records.length - limit} more records omitted (use format=csv) | | | | |`);
  }
  return out.join('\n');
}

export function toTree(records, { maxDepth = 6 } = {}) {
  const out = [];
  for (const r of records) {
    if (r.depth > maxDepth) continue;
    const box = r.box ? `${r.box.w}x${r.box.h}@${r.box.x},${r.box.y}` : '';
    const bits = [r.type, `"${r.name}"`, box];
    if (r.fills.length) bits.push(`bg=${r.fills.join(',')}`);
    if (r.radius) bits.push(r.radius);
    if (r.layout) bits.push(r.layout);
    if (r.type === 'TEXT') {
      bits.push(`"${r.text.replace(/\n/g, '\\n')}"`, `${r.fontFamily}/${r.fontWeight}/${r.fontSize}px`, `lh=${r.lineHeightPx}`);
    }
    out.push(`${'| '.repeat(r.depth)}${bits.filter(Boolean).join('  ')}`);
  }
  return out.join('\n');
}

/** Compact, model-friendly digest. Deliberately bounded. */
export function toSummary(records, meta = {}) {
  const byType = new Map();
  for (const r of records) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);

  const root = records[0];

  // Colour usage, deduped, top N.
  const colourCount = new Map();
  for (const r of records) {
    for (const f of r.fills) colourCount.set(f, (colourCount.get(f) ?? 0) + 1);
  }
  const topColours = [...colourCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Type scale.
  const sizes = new Map();
  for (const r of records) {
    if (r.type !== 'TEXT') continue;
    const k = `${r.fontSize}/${r.fontWeight}`;
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  const typeScale = [...sizes.entries()]
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .map(([k, n]) => `${k} x${n}`);

  const radii = new Map();
  for (const r of records) {
    if (r.radius) radii.set(r.radius, (radii.get(r.radius) ?? 0) + 1);
  }

  const lines = [];
  lines.push(`# ${tidyName(meta.name ?? root?.name)} - spec summary`);
  if (root?.box) lines.push(`Frame: ${root.box.w}x${root.box.h}`);
  lines.push(`Records: ${records.length}`);
  lines.push('');
  lines.push(`Node types: ${[...byType.entries()].map(([t, n]) => `${t} ${n}`).join(' / ')}`);
  lines.push('');
  if (topColours.length) {
    lines.push('Colours (by usage):');
    for (const [c, n] of topColours) lines.push(`  ${c}  x${n}`);
    lines.push('');
  }
  if (typeScale.length) {
    lines.push('Type scale (size/weight x count):');
    for (const t of typeScale) lines.push(`  ${t}`);
    lines.push('');
  }
  if (radii.size) {
    const summary = [...radii.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${r} x${n}`)
      .join(' / ');
    lines.push(`Radii: ${summary}`);
    lines.push('');
  }

  // Top-level structure only.
  lines.push('Top-level structure:');
  for (const r of records.filter((x) => x.depth <= 2)) {
    const box = r.box ? `${r.box.w}x${r.box.h}` : '';
    lines.push(`  ${'  '.repeat(r.depth)}${r.type} "${r.name}" ${box}`);
  }

  lines.push('');
  lines.push('Use format=csv for the full per-node table, or format=tree for the hierarchy.');
  return lines.join('\n');
}

export function render(records, format, meta) {
  switch (format) {
    case 'csv':
      return toCsv(records);
    case 'markdown':
      return toMarkdown(records);
    case 'tree':
      return toTree(records);
    case 'summary':
    default:
      return toSummary(records, meta);
  }
}