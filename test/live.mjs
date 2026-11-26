/**
 * P1: end-to-end against the live Figma REST API.
 * Verifies URL parsing, auth, rate-limit backoff, and that normalized output
 * matches the cached-node baseline.
 *
 * Run: FIGMA_TOKEN=... node test/live.mjs
 */
import { resolveTarget } from '../lib/resolve-url.mjs';
import { fetchNodes, whoAmI, FigmaError } from '../lib/figma-api.mjs';
import { normalize } from '../lib/normalize.mjs';
import { toSummary } from '../lib/render.mjs';
import { readFileSync } from 'node:fs';

const URL_UNDER_TEST =
  'https://www.figma.com/design/EFsZ25RLMFQRXi5y7ranS8/%E5%BC%80%E5%8F%91%E9%A1%B9%E7%9B%AE1?node-id=7116-6093';

const token = process.env.FIGMA_TOKEN;
if (!token) {
  console.error('FIGMA_TOKEN is not set');
  process.exit(2);
}

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
  }
};

const t0 = Date.now();

console.log('\n[1] Token');
try {
  const me = await whoAmI({ token });
  check('authenticated', !!me?.handle, `${me.handle} <${me.email}>`);
} catch (err) {
  check('authenticated', false, err.message);
  process.exit(1);
}

console.log('\n[2] URL -> target');
const target = resolveTarget(URL_UNDER_TEST);
check('file key', target.fileKey === 'EFsZ25RLMFQRXi5y7ranS8', target.fileKey);
check('node id colon form', target.nodeId === '7116:6093', target.nodeId);

console.log('\n[3] Live fetch with backoff');
let doc;
try {
  doc = await fetchNodes(target.fileKey, target.nodeId, {
    token,
    retries: 5,
    onRetry: ({ attempt, delay, status }) =>
      console.log(`       retry #${attempt} after ${delay}ms (HTTP ${status})`),
  });
  check('response received', !!doc.nodes, `${Date.now() - t0}ms`);
} catch (err) {
  if (err instanceof FigmaError && err.quota?.retryAfterSeconds > 300) {
    // Not a defect in the plugin: the account's quota window is closed.
    console.log('\n[!] QUOTA LOCKED — this is an account state, not a code failure');
    console.log(`    plan tier      : ${err.quota.planTier}`);
    console.log(`    rate limit type: ${err.quota.rateLimitType}`);
    console.log(`    retry after    : ${err.quota.retryAfterSeconds}s (${(err.quota.retryAfterSeconds / 3600).toFixed(1)} h)`);
    console.log(`    message        : ${err.message}`);
    console.log('\n    Falling back to the cached payload to verify normalize+render.');
    const cached = JSON.parse(readFileSync('D:/demo/figma/api/node_7116-6093.json', 'utf8').replace(/^\uFEFF/, ''));
    const node = cached.nodes[target.nodeId];
    const records = normalize(node.document);
    check('cached fallback record count', records.length === 538, `${records.length}`);
    check('cached fallback text count', records.filter((r) => r.type === 'TEXT').length === 146,
      `${records.filter((r) => r.type === 'TEXT').length}`);
    console.log('\nINCONCLUSIVE — live path blocked by quota; normalizer verified on cache.');
    process.exit(3); // distinct code: blocked, not broken
  }
  check('response received', false, err instanceof FigmaError ? `${err.status}: ${err.message}` : err.message);
  process.exit(1);
}

const node = doc.nodes[target.nodeId];
check('node present', !!node, target.nodeId);
if (!node) process.exit(1);

const root = node.document;
check('frame size', `${root.absoluteBoundingBox.width}×${root.absoluteBoundingBox.height}` === '1920×1200',
  `${root.absoluteBoundingBox.width}×${root.absoluteBoundingBox.height}`);

console.log('\n[4] Normalize live payload');
const records = normalize(root);
check('record count matches baseline', records.length === 538, `${records.length}`);
check('text count matches baseline', records.filter((r) => r.type === 'TEXT').length === 146,
  `${records.filter((r) => r.type === 'TEXT').length}`);

console.log('\n[5] Summary render');
const summary = toSummary(records, { name: root.name });
check('summary bounded', summary.length < 4000, `${summary.length} bytes`);
check('summary has frame', summary.includes('1920×1200'), '');

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`} — ${Date.now() - t0}ms`);
process.exit(failures === 0 ? 0 : 1);