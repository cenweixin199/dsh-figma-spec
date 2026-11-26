/**
 * P0 regression: normalize the cached node JSON and compare key facts against
 * values measured in the earlier session. Any mismatch fails the build.
 *
 * Run: node test/regression.mjs [path-to-node-json]
 */
import { readFileSync } from 'node:fs';
import { normalize, palette, typography } from '../lib/normalize.mjs';
import { toSummary, toCsv } from '../lib/render.mjs';
import { resolveTarget } from '../lib/resolve-url.mjs';

const DEFAULT_JSON = 'D:/demo/figma/api/node_7116-6093.json';
const jsonPath = process.argv[2] ?? DEFAULT_JSON;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok   ${label} = ${JSON.stringify(actual)}`);
  }
};

// ---------------------------------------------------------------- URL parsing
console.log('\n[1] URL resolution');
check(
  'design url',
  resolveTarget(
    'https://www.figma.com/design/EFsZ25RLMFQRXi5y7ranS8/%E5%BC%80%E5%8F%91%E9%A1%B9%E7%9B%AE1?node-id=7116-6093&t=fYQuFYvuqoGvwdoN-0',
  ),
  {
    fileKey: 'EFsZ25RLMFQRXi5y7ranS8',
    nodeId: '7116:6093',
    branchKey: null,
    raw: 'https://www.figma.com/design/EFsZ25RLMFQRXi5y7ranS8/%E5%BC%80%E5%8F%91%E9%A1%B9%E7%9B%AE1?node-id=7116-6093&t=fYQuFYvuqoGvwdoN-0',
  },
);
check('encoded colon', resolveTarget('https://figma.com/file/ABC123456789/name?node-id=7116%3A6093').nodeId, '7116:6093');
check('branch key wins', resolveTarget('https://figma.com/design/F/branch/BR123456789/name?node-id=1-2').fileKey, 'BR123456789');

// ---------------------------------------------------------------- normalization
console.log('\n[2] Normalize cached node');
const raw = readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
const doc = JSON.parse(raw);
const root = doc.nodes['7116:6093'].document;
const records = normalize(root);

check('record count', records.length, 538);
check('text record count', records.filter((r) => r.type === 'TEXT').length, 146);
check('root size', [records[0].box.w, records[0].box.h], [1920, 1200]);
check('root fill', records[0].fills, ['#EAEDF1']);
check('root radius', records[0].radius, 'r=3');

// ---------------------------------------------------------------- spot checks
console.log('\n[3] Spot checks against measured truth');

// Page title 工作台: 20px / 500 / lh 28 / #333333
const title = records.find((r) => r.type === 'TEXT' && r.text === '工作台' && r.fontSize === 20);
check('page title exists', !!title, true);
if (title) {
  check('page title weight', title.fontWeight, 500);
  check('page title lineHeight', title.lineHeightPx, 28);
  check('page title fill', title.fills, ['#333333']);
}

// KPI value 28 -> 28px, and its unit 批 -> 12px #8B9098
const kpiLabel = records.find((r) => r.type === 'TEXT' && r.text === '批次数量');
check('kpi label size', kpiLabel?.fontSize, 14);
check('kpi label fill', kpiLabel?.fills, ['#666666']);
const unit = records.find((r) => r.type === 'TEXT' && r.text === '批');
check('kpi unit size', unit?.fontSize, 12);
check('kpi unit fill', unit?.fills, ['#8B9098']);

// Hairline header: bottom-only inside stroke on the 我的常用 header container
const header = records.find((r) => r.name === 'Container' && r.box?.h === 56 && r.strokeSides === 'bottom:1');
check('header bottom stroke found', !!header, true);
check('header stroke colour', header?.strokes, ['#EDF0F2']);
check('header stroke align', header?.strokeAlign, 'INSIDE');

// Shortcut tile: 30x30 r=6 with a linear gradient
const tile = records.find((r) => r.box?.w === 30 && r.box?.h === 30 && r.radius === 'r=6');
check('shortcut tile found', !!tile, true);
check('shortcut tile gradient starts linear', tile?.fills[0]?.startsWith('linear('), true);

// Donut arcs: innerRadius 0.67
const arcs = records.filter((r) => r.arc);
check('donut arc count', arcs.length, 8);
check('donut innerRadius', arcs[0]?.arc.innerRadius, 0.667);

// Bar chart: per-corner radii [1,1,0,0]
const bars = records.filter((r) => r.radius === 'r4=1/1/0/0');
check('bar count', bars.length, 12);

// ---------------------------------------------------------------- aggregates
console.log('\n[4] Aggregates');
const pal = palette(records);
check('brand green present', pal.fills.some((f) => f.value === '#3EBA55'), true);
const typo = typography(records);
const sizes = [...new Set(typo.map((t) => t.fontSize))].sort((a, b) => a - b);
check('type sizes', sizes, [11, 12, 14, 15, 16, 18, 20, 28]);
check('single font family', [...new Set(typo.map((t) => t.fontFamily))], ['PingFang SC']);

// ---------------------------------------------------------------- renderers
console.log('\n[5] Renderers');
const csv = toCsv(records);
check('csv line count', csv.split('\n').length, 539);
const summary = toSummary(records, { name: root.name });
check('summary mentions frame size', summary.includes('1920x1200'), true);
check('summary is bounded', summary.length < 4000, true);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);