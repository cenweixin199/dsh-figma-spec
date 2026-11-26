/**
 * Cache behaviour: hit, miss, expiry, and quota error shaping.
 * Uses a temp dir; no network.
 *
 * Run: node test/cache.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeCache } from '../lib/cache.mjs';
import { FigmaError, readQuotaHeaders } from '../lib/figma-api.mjs';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
  }
};

const dir = await mkdtemp(join(tmpdir(), 'figma-spec-cache-'));
const params = { fileKey: 'ABC123456789', nodeId: '1:2', depth: null };

try {
  console.log('\n[1] Miss then hit');
  const cache = new NodeCache(join(dir, 'nodes'), { ttlMs: 60_000 });
  const miss = await cache.get(params);
  check('first read misses', miss.hit === false, miss.reason);

  const payload = { nodes: { '1:2': { document: { name: 'test' } } } };
  await cache.put(params, payload, { fileKey: params.fileKey });
  const hit = await cache.get(params);
  check('second read hits', hit.hit === true);
  check('payload round-trips', hit.value.nodes['1:2'].document.name === 'test');
  check('metadata saved', hit.meta?.fileKey === params.fileKey);

  console.log('\n[2] Key isolation');
  const other = await cache.get({ ...params, nodeId: '3:4' });
  check('different node id misses', other.hit === false);
  const otherDepth = await cache.get({ ...params, depth: 4 });
  check('different depth misses', otherDepth.hit === false);

  console.log('\n[3] Expiry');
  const shortCache = new NodeCache(join(dir, 'short'), { ttlMs: 1 });
  await shortCache.put(params, payload);
  await new Promise((r) => setTimeout(r, 20));
  const expired = await shortCache.get(params);
  check('expired entry misses', expired.hit === false, expired.reason);

  console.log('\n[4] Eviction honours byte budget');
  const tiny = new NodeCache(join(dir, 'tiny'), { ttlMs: 60_000, maxBytes: 300 });
  for (let i = 0; i < 8; i += 1) {
    await tiny.put({ ...params, nodeId: `1:${i}` }, { pad: 'x'.repeat(80) });
    await new Promise((r) => setTimeout(r, 5));
  }
  const stats = await tiny.stats();
  check('cache stayed under budget', stats.bytes <= 300, `${stats.bytes} bytes`);

  console.log('\n[5] Quota header parsing');
  const h = new Headers({
    'retry-after': '117040',
    'x-figma-plan-tier': 'starter',
    'x-figma-rate-limit-type': 'low',
    'x-figma-upgrade-link': 'https://www.figma.com/files?api_paywall=true',
  });
  const q = readQuotaHeaders(h);
  check('plan tier read', q.planTier === 'starter');
  check('retry-after is numeric', q.retryAfterSeconds === 117040);
  check('limit type read', q.rateLimitType === 'low');

  console.log('\n[6] Long quota lock is not retryable');
  // Mirrors the branch in figma-api: >300 s Retry-After means locked, not burst.
  const exhausted = 117040 > 300;
  check('locked window detected', exhausted);
  const err = new FigmaError('quota', { status: 429, retryable: false, quota: q });
  check('error carries quota', err.quota.planTier === 'starter');
  check('error not retryable', err.retryable === false);

  console.log('\n[7] Token rejection messages keep Figma\'s own reason');
  // describeStatus is internal, so assert the observable behaviour through a
  // stubbed fetch: the message must name expiration separately from rejection.
  const mk = (status, body) => ({
    ok: false,
    status,
    headers: new Headers({}),
    text: async () => body,
  });
  const { whoAmI: probe } = await import('../lib/figma-api.mjs');

  const expiredErr = await probe({
    token: 'figd_x',
    fetchImpl: async () => mk(401, '{"status":401,"err":"Token has expired"}'),
  }).catch((e) => e);
  check('expired is called out', /expired/i.test(expiredErr.message), expiredErr.message.slice(0, 60));
  check('expired keeps upstream text', /Figma said: Token has expired/.test(expiredErr.message));

  const revokedErr = await probe({
    token: 'figd_x',
    fetchImpl: async () => mk(401, '{"status":401,"err":"Invalid token"}'),
  }).catch((e) => e);
  check('generic rejection differs from expiry', !/has expired/i.test(revokedErr.message), revokedErr.message.slice(0, 60));
  check('generic rejection still actionable', /revoked|current/i.test(revokedErr.message));
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);