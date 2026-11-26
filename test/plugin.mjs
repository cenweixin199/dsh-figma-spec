/**
 * Plugin contract test: call apply() with a mock context and assert it
 * registers the four tools and one skill with the shapes the Loader requires.
 *
 * This is the closest verification available without a live agent step, and it
 * catches the two failures that actually broke activation earlier:
 *   - a missing `render` beside `output.schema`
 *   - any import of a package that is not resolvable from this directory
 *
 * Run: node test/plugin.mjs
 */
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
  }
};

const mod = await import(pathToFileURL(join(ROOT, 'index.js')).href);

// ---------------------------------------------------------------- mock context
const tools = [];
const skills = [];
const effects = [];
const services = new Map();

const ctx = {
  tools: { register: (def) => tools.push(def) },
  get: (name) => services.get(name),
  effect: (fn) => effects.push(fn),
  // Optional-service injection: the real context calls the callback only when
  // the named services exist. The mock simply does not provide them, so the
  // settings routes stay unregistered here.
  inject: (names, cb) => {
    if (names.every((n) => services.has(n))) cb(ctx);
  },
};

// The real profile provides a skills registry; without this mock the plugin
// correctly skips skill registration, so the mock must supply it.
services.set('skills', {
  register: (def) => {
    skills.push(def);
    return () => {}; // disposer
  },
});

console.log('\n[1] Apply registers everything');
mod.apply(ctx, { maxRecords: 250 });

check('4 tools registered', tools.length === 4, tools.map((t) => t.name).join(', '));
check('1 skill registered', skills.length === 1, skills.map((s) => s.name).join(', '));
check('skill name is figma-spec', skills[0]?.name === 'figma-spec');
check('skill is model-invocable', skills[0]?.modelInvocable === true);
check('skill body loaded', typeof skills[0]?.body === 'string' && skills[0].body.length > 1000, `${skills[0]?.body?.length ?? 0} chars`);

console.log('\n[2] Tool names');
const names = tools.map((t) => t.name).sort();
check('exact tool set', JSON.stringify(names) === JSON.stringify([
  'figma_diff_nodes',
  'figma_get_palette',
  'figma_get_spec',
  'figma_get_typography',
]), names.join(', '));

console.log('\n[3] Every tool satisfies the Loader contract');
for (const t of tools) {
  const out = t.output;
  check(`${t.name}: has output`, !!out);
  check(`${t.name}: has output.schema`, !!out?.schema);
  check(`${t.name}: has output.render`, typeof out?.render === 'function');
  check(`${t.name}: has execute`, typeof t.execute === 'function');
  check(`${t.name}: has description`, typeof t.description === 'string' && t.description.length > 30);
  check(`${t.name}: has parameters`, !!t.parameters && Object.keys(t.parameters).length > 0);
}

console.log('\n[4] Required parameters declared');
const req = (n) => Object.entries(tools.find((t) => t.name === n).parameters)
  .filter(([, v]) => v.required).map(([k]) => k).sort();
check('figma_get_spec requires url', JSON.stringify(req('figma_get_spec')) === '["url"]');
check('figma_get_typography requires url', JSON.stringify(req('figma_get_typography')) === '["url"]');
check('figma_get_palette requires url', JSON.stringify(req('figma_get_palette')) === '["url"]');
check('figma_diff_nodes requires left,right', JSON.stringify(req('figma_diff_nodes')) === '["left","right"]');

console.log('\n[5] render() produces content blocks');
const spec = tools.find((t) => t.name === 'figma_get_spec');
const blocks = spec.output.render({}, '# hello');
check('render returns array', Array.isArray(blocks));
check('render block is text', blocks[0]?.type === 'text');
check('render carries value', blocks[0]?.text === '# hello');
check('render tolerates undefined', spec.output.render({}, undefined)[0].text === '');

console.log('\n[6] Missing token produces an actionable error');
// No credentials service -> the tool must explain how to configure.
services.delete('credentials');
try {
  await spec.execute({ url: 'https://www.figma.com/design/ABCDEFGHIJKLMNOP/name?node-id=1-2' }, {});
  check('throws without a token', false, 'it returned instead');
} catch (err) {
  const msg = String(err?.message ?? '');
  check('throws without a token', true);
  check('message names FIGMA_TOKEN', msg.includes('FIGMA_TOKEN'), msg.split('\n')[0]);
  check('message is actionable', msg.includes('figma.com/settings'));
}

console.log('\n[7] Bad URL rejected before any network call');
try {
  await spec.execute({ url: 'https://example.com/not-figma' }, {});
  check('rejects non-figma host', false);
} catch (err) {
  check('rejects non-figma host', /figma\.com/.test(String(err.message)));
}
try {
  await spec.execute({ url: 'https://www.figma.com/design/ABCDEFGHIJKLMNOP/name' }, {});
  check('rejects URL without node-id', false);
} catch (err) {
  check('rejects URL without node-id', /node-id/.test(String(err.message)));
}

console.log('\n[8] Default cache directory');
// A `!!js` cacheDir in cordis.patch.yml is evaluated before DSH_HOME exists, so
// the default must come from the environment at activation time. Resolving to a
// drive root (C:\figma-spec-cache) was a real bug.
const savedHome = process.env.DSH_HOME;
process.env.DSH_HOME = 'C:\\Users\\test\\.dsh';
const mod2 = await import(pathToFileURL(join(ROOT, 'index.js')).href + `?v=${Date.now()}`);
let dirSeen = null;
mod2.apply(
  {
    tools: { register: () => {} },
    get: () => undefined,
    effect: () => {},
    inject: () => {},
  },
  {},
);
// The cache is constructed eagerly inside apply; assert via the patch instead.
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
check('patch does not pin cacheDir with !!js', !/cacheDir:\s*!!js/.test(patch), 'env-visible at runtime');
if (savedHome === undefined) delete process.env.DSH_HOME;
else process.env.DSH_HOME = savedHome;

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);