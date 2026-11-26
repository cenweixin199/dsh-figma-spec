/**
 * Normalize a Figma node tree into flat, comparable style records.
 *
 * The field choices come from real gaps a pixel-sampling approach could not
 * close:
 *   - individualStrokeWeights: which *side* a hairline border is on. A card
 *     header's "divider" is a bottom-only inside stroke, not a separate rect.
 *   - rectangleCornerRadii: per-corner radii (bar charts are [1,1,0,0]).
 *   - gridColumnGap / gridRowGap: GRID auto-layout spacing lives here, not in
 *     itemSpacing, which is null for grid frames.
 *   - arcData.innerRadius: the donut ring ratio, which cannot be measured
 *     reliably from a screenshot.
 *   - gradientHandlePositions: the real gradient direction.
 */

/** Container / vector nodes that carry no style authority of their own. */
export const SKIP_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION']);

export function rgbaToHex(c) {
  const to = (v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255);
  const h = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(to(c.r))}${h(to(c.g))}${h(to(c.b))}`;
}

function paintToString(p) {
  const type = p.type ?? '';
  if (type === 'SOLID') {
    const op = p.opacity ?? 1;
    return op < 1 ? `${rgbaToHex(p.color)}@${op.toFixed(2)}` : rgbaToHex(p.color);
  }
  if (type.includes('GRADIENT')) {
    const kind = type.includes('LINEAR') ? 'linear' : type.includes('RADIAL') ? 'radial' : 'gradient';
    const stops = (p.gradientStops ?? [])
      .map((s) => `${rgbaToHex(s.color)}:${s.position.toFixed(2)}`)
      .join('|');
    return `${kind}(${stops})`;
  }
  if (type === 'IMAGE') return 'image';
  if (type === 'VIDEO') return 'video';
  return type ? type.toLowerCase() : '';
}

export function paintsOf(list = []) {
  const out = [];
  for (const p of list) {
    if (p.visible === false) continue;
    const s = paintToString(p);
    if (s) out.push(s);
  }
  return out;
}

export function effectsOf(list = []) {
  const out = [];
  for (const e of list) {
    if (e.visible === false) continue;
    const parts = [e.type.toLowerCase()];
    if (e.color) parts.push(rgbaToHex(e.color));
    if (e.color?.a != null && e.color.a < 1) parts.push(`a=${e.color.a.toFixed(2)}`);
    if (e.offset && (e.offset.x || e.offset.y)) parts.push(`offset=${e.offset.x},${e.offset.y}`);
    if (e.radius) parts.push(`r=${e.radius}`);
    if (e.spread) parts.push(`spread=${e.spread}`);
    out.push(parts.join(' '));
  }
  return out;
}

function strokeSides(node) {
  const w = node.individualStrokeWeights;
  if (!w) return null;
  const sides = [];
  for (const k of ['top', 'right', 'bottom', 'left']) {
    if (w[k]) sides.push(`${k}:${w[k]}`);
  }
  return sides.length ? sides.join('/') : null; // no visible side -> null
}

function layoutOf(node) {
  const mode = node.layoutMode;
  if (!mode) return null;
  const parts = [mode === 'HORIZONTAL' ? 'H' : mode === 'VERTICAL' ? 'V' : mode];
  if (node.itemSpacing != null) parts.push(`gap=${node.itemSpacing}`);
  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(
    (v) => v ?? 0,
  );
  if (pad.some((v) => v)) parts.push(`pad=${pad.join('/')}`);
  if (node.counterAxisSpacing != null) parts.push(`cgap=${node.counterAxisSpacing}`);
  if (node.gridColumnGap != null || node.gridRowGap != null) {
    parts.push(`grid=${node.gridColumnGap ?? 0}x${node.gridRowGap ?? 0}`);
    if (node.gridColumnsSizing) parts.push(`cols=${node.gridColumnsSizing.trim()}`);
    if (node.gridRowsSizing) parts.push(`rows=${node.gridRowsSizing.trim()}`);
  }
  if (node.primaryAxisAlignItems) parts.push(`main=${node.primaryAxisAlignItems}`);
  if (node.counterAxisAlignItems) parts.push(`cross=${node.counterAxisAlignItems}`);
  if (node.layoutSizingHorizontal) {
    parts.push(`size=${node.layoutSizingHorizontal}/${node.layoutSizingVertical ?? '?'}`);
  }
  return parts.join(' ');
}

function radiusOf(node) {
  // Figma reports some radii as derived floats (0.5333333611488342). Round to
  // 2 decimals and drop trailing zeros so the table stays readable.
  const tidy = (v) => {
    const r = Math.round(v * 100) / 100;
    return String(r);
  };
  const r4 = node.rectangleCornerRadii;
  if (Array.isArray(r4) && r4.some((v) => v)) {
    const present = r4.map(tidy).join('/');
    const uniform = r4.every((v) => Math.abs(v - r4[0]) < 1e-6);
    return uniform ? `r=${tidy(r4[0])}` : `r4=${present}`;
  }
  if (node.cornerRadius) return `r=${tidy(node.cornerRadius)}`;
  return null;
}

function textOf(node) {
  const s = node.style ?? {};
  return {
    text: node.characters ?? '',
    fontFamily: s.fontFamily ?? null,
    fontStyle: s.fontStyle ?? null,
    fontWeight: s.fontWeight ?? null,
    fontSize: s.fontSize ?? null,
    lineHeightPx: s.lineHeightPx != null ? round(s.lineHeightPx, 1) : null,
    letterSpacing: s.letterSpacing || null,
    textAlign: s.textAlignHorizontal ?? null,
  };
}

const FULL_TURN = 2 * Math.PI;

function arcOf(node) {
  const a = node.arcData;
  if (!a) return null;
  const inner = a.innerRadius ?? 0;
  const sweep = (a.endingAngle ?? 0) - (a.startingAngle ?? 0);
  const isFullCircle = Math.abs(Math.abs(sweep) - FULL_TURN) < 1e-3;
  if (isFullCircle && inner === 0) return null;
  return {
    start: round(a.startingAngle, 3),
    end: round(a.endingAngle, 3),
    innerRadius: round(inner, 3),
  };
}

export const round = (v, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

function boxOf(node, origin) {
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  return {
    x: round(b.x - origin.x),
    y: round(b.y - origin.y),
    w: round(b.width),
    h: round(b.height),
  };
}

/**
 * @param {object} root      node document
 * @param {object} [options]
 * @param {'absolute'|'page'} [options.origin] offset to subtract; defaults to root's own box
 */
export function normalize(root, options = {}) {
  const rb = root.absoluteBoundingBox ?? { x: 0, y: 0 };
  const origin = options.origin ?? { x: rb.x ?? 0, y: rb.y ?? 0 };
  const records = [];

  const walk = (node, path, depth, parentName) => {
    const isSkipped = SKIP_TYPES.has(node.type);
    if (!isSkipped) {
      const rec = {
        path,
        depth,
        parent: parentName,
        type: node.type,
        name: node.name,
        box: boxOf(node, origin),
        fills: paintsOf(node.fills),
        strokes: paintsOf(node.strokes),
        strokeWeight: node.strokeWeight ?? null,
        strokeSides: strokeSides(node),
        strokeAlign: node.strokeAlign ?? null,
        radius: radiusOf(node),
        effects: effectsOf(node.effects),
        opacity: node.opacity != null && node.opacity < 1 ? round(node.opacity, 2) : null,
        blendMode: node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL'
          ? node.blendMode
          : null,
        layout: layoutOf(node),
        clips: node.clipsContent === true ? true : null,
        // Figma emits arcData on every ellipse, including full circles
        // (0 → 2π, innerRadius 0). Only a partial arc or a real ring is
        // meaningful, so plain circles stay null.
        arc: arcOf(node),
        boundVariables: node.boundVariables ? Object.keys(node.boundVariables) : null,
        styleRefs: node.styles ? Object.keys(node.styles) : null,
      };
      if (node.type === 'TEXT') Object.assign(rec, textOf(node));
      records.push(rec);
    }

    for (const child of node.children ?? []) {
      walk(child, `${path}/${child.name.replaceAll('/', '·')}`, depth + 1, node.name);
    }
  };

  walk(root, root.name, 0, null);
  return records;
}

/** Distinct colours and effects, with a count and a few exemplar paths. */
export function palette(records) {
  const fills = new Map();
  const strokes = new Map();
  const effects = new Map();

  const bump = (map, key, path) => {
    if (!key) return;
    const e = map.get(key) ?? { value: key, count: 0, examples: [] };
    e.count += 1;
    if (e.examples.length < 3) e.examples.push(path);
    map.set(key, e);
  };

  for (const r of records) {
    for (const f of r.fills) bump(fills, f, r.path);
    for (const s of r.strokes) bump(strokes, s, r.path);
    for (const e of r.effects) bump(effects, e, r.path);
  }

  const of = (m) =>
    [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    fills: of(fills),
    strokes: of(strokes),
    effects: of(effects),
  };
}

/** Aggregate typography by (fontSize, fontWeight) with the copy that uses it. */
export function typography(records) {
  const byKey = new Map();
  for (const r of records) {
    if (r.type !== 'TEXT') continue;
    const key = `${r.fontFamily}|${r.fontSize}|${r.fontWeight}`;
    const e = byKey.get(key) ?? {
      fontFamily: r.fontFamily,
      fontSize: r.fontSize,
      fontWeight: r.fontWeight,
      lineHeights: new Map(),
      count: 0,
      examples: [],
    };
    e.count += 1;
    if (r.lineHeightPx != null) {
      e.lineHeights.set(r.lineHeightPx, (e.lineHeights.get(r.lineHeightPx) ?? 0) + 1);
    }
    if (e.examples.length < 3 && r.text) e.examples.push(truncate(r.text, 24));
    byKey.set(key, e);
  }

  return [...byKey.values()]
    .map((e) => ({
      ...e,
      lineHeights: [...e.lineHeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([px, n]) => ({ px, count: n })),
    }))
    .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || (a.fontWeight ?? 0) - (b.fontWeight ?? 0));
}

export function truncate(s, n) {
  const flat = String(s).replace(/\s*\n\s*/g, ' / ');
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

/** Compare two record sets by structural path. */
export function diffRecords(left, right) {
  const norm = (recs) => {
    const m = new Map();
    for (const r of recs) m.set(`${r.type}|${r.name}|${r.box?.x},${r.box?.y}`, r);
    return m;
  };
  const L = norm(left);
  const R = norm(right);
  const keys = new Set([...L.keys(), ...R.keys()]);
  const changed = [];
  const onlyLeft = [];
  const onlyRight = [];

  const FIELDS = [
    'box',
    'fills',
    'strokes',
    'strokeWeight',
    'strokeSides',
    'radius',
    'effects',
    'opacity',
    'layout',
    'fontSize',
    'fontWeight',
    'lineHeightPx',
    'text',
  ];

  for (const k of keys) {
    const a = L.get(k);
    const b = R.get(k);
    if (!a) {
      onlyRight.push(b);
      continue;
    }
    if (!b) {
      onlyLeft.push(a);
      continue;
    }
    const deltas = [];
    for (const f of FIELDS) {
      const va = JSON.stringify(a[f] ?? null);
      const vb = JSON.stringify(b[f] ?? null);
      if (va !== vb) deltas.push({ field: f, left: a[f] ?? null, right: b[f] ?? null });
    }
    if (deltas.length) changed.push({ path: a.path, name: a.name, type: a.type, deltas });
  }

  return { changed, onlyLeft, onlyRight };
}