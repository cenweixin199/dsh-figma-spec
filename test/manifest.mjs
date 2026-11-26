/**
 * Manifest and module sanity: the bundle must import cleanly with no external
 * dependencies, declare the files it ships, and expose valid locale metadata.
 *
 * Run: node test/manifest.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ''}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
  }
};

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

console.log('\n[1] Manifest');
check('name', pkg.name === 'dsh-figma-spec', pkg.name);
check('version valid', /^\d+\.\d+\.\d+/.test(pkg.version), pkg.version);
check('type module', pkg.type === 'module');
check('declares bundle patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
check('no dependencies', !pkg.dependencies && !pkg.devDependencies, 'zero-dep');
check('no install scripts', !pkg.scripts || !pkg.scripts.postinstall);

console.log('\n[2] Files listed actually exist');
for (const f of pkg.files) {
  const probe = f.replace('*', 'en');
  check(`files: ${f}`, existsSync(join(ROOT, probe)), probe);
}

console.log('\n[2b] Client half');
check('client export declared', pkg.exports['./client'] === './client.js');
check('dsh.client block', !!pkg.dsh?.client, JSON.stringify(pkg.dsh?.client ?? null));
check('client platform is web', pkg.dsh?.client?.platform === 'web');
// A client bundle must order itself after the slots service and the plugin
// manager that owns the detail page, or `plugins.bundle.config` never resolves.
const clientInject = pkg.dsh?.client?.inject ?? [];
check('injects ui-slots', clientInject.includes('@deepseek-ai/dsh-client-ui-slots'), clientInject.join(', '));
check('injects ui-plugin-manager', clientInject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
check('injects locale', clientInject.includes('@deepseek-ai/dsh-client-locale'));
check('client file exists', existsSync(join(ROOT, 'client.js')));
const clientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');
check('client registers a lazy factory', clientSrc.includes('__ModuleLoader__.load'));
check('factory id matches package', clientSrc.includes(`id: '${pkg.name}'`));
check('registers into the bundle detail page', clientSrc.includes('plugins.bundle.config'));
check('bundle config keyed by package name', /key:\s*NS/.test(clientSrc));
// The sidebar row exists but must be conditional: gated on the persisted
// setting, registered and disposed as it flips, never an always-on rail item.
check('sidebar row is conditional', clientSrc.includes('sidebar.panellist') && clientSrc.includes('applyPanel'));
check('sidebar row gated on the setting', /wanted\s*=\s*value\?\.sidebarPanel\s*===\s*true/.test(clientSrc));
check('sidebar row is disposed when off', clientSrc.includes('panelDisposer()'));
check('settings tab is rendered', clientSrc.includes('tabSettings'));
// The host renders the README (and the image inside it) above this slot, so
// this component must not draw either one again.
check('client does not render its own figure', !clientSrc.includes('fs-figure'));
check('client does not fetch the README', !clientSrc.includes('DETAIL_PATH'));
check('header has a logo', clientSrc.includes('fs-logo'));
check('header has a title', clientSrc.includes('fs-title'));
check('header has a subtitle', clientSrc.includes('fs-desc'));
check('header shows a status chip', clientSrc.includes('fs-chip'));
check('no standalone main page', !clientSrc.includes("inject('main'"));
check('no bare React import', !/^\s*import .*from 'react'/m.test(clientSrc));
check('client has cleanup effects', clientSrc.includes('ctx.effect'));

console.log('\n[2c] Licence and bilingual README');
check('LICENSE exists', existsSync(join(ROOT, 'LICENSE')));
const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
check('LICENSE is MIT', lic.includes('MIT License'));
check('LICENSE names holder', lic.includes('cenweixin199'));
const zhReadme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const enReadme = readFileSync(join(ROOT, 'README.en.md'), 'utf8');
check('README is Chinese (default)', /[\u4e00-\u9fff]/.test(zhReadme), 'contains CJK');
check('README links English', zhReadme.includes('README.en.md'));
check('English README exists and links back', enReadme.includes('README.md'));
check('manifest licence field', pkg.license === 'MIT', pkg.license);

console.log('\n[3] Locale metadata');
for (const loc of ['en', 'zh']) {
  const j = JSON.parse(readFileSync(join(ROOT, 'locale', `${loc}.json`), 'utf8'));
  check(`${loc} title`, typeof j.meta?.title === 'string' && j.meta.title.length > 0, j.meta?.title);
  check(`${loc} description`, (j.meta?.description?.length ?? 0) > 40, `${j.meta?.description?.length ?? 0} chars`);
}

console.log('\n[4] Icon');
const iconPath = join(ROOT, 'icon.svg');
check('icon exists', existsSync(iconPath));
const icon = readFileSync(iconPath, 'utf8');
const iconBytes = statSync(iconPath).size;
check('icon under 256 KiB', iconBytes < 256 * 1024, `${iconBytes} bytes`);
check('icon is SVG', icon.trimStart().startsWith('<svg'));
check('icon has paths', icon.includes('<path'));
check('no external refs', !/xlink:href|href="http/.test(icon));

console.log('\n[5] Detail document: README fallback');
// No meta.detail, so the host renders the package README in its own scroll
// region. The feature image must live inside that README, referenced by a path
// the host resolves through /api/plugin-manager/detail-file.
for (const loc of ['en', 'zh']) {
  const locale = JSON.parse(readFileSync(join(ROOT, 'locale', `${loc}.json`), 'utf8'));
  check(`${loc} omits meta.detail`, locale.meta?.detail === undefined, 'README fallback');
}
const readmeZh = readFileSync(join(ROOT, 'README.md'), 'utf8');
const readmeEn = readFileSync(join(ROOT, 'README.en.md'), 'utf8');
check('zh README embeds the feature image', /!\[[^\]]{8,}\]\(docs\/preview\.svg\)/.test(readmeZh));
check('en README embeds the feature image', /!\[[^\]]{8,}\]\(docs\/preview\.svg\)/.test(readmeEn));
check('preview image exists', existsSync(join(ROOT, 'docs', 'preview.svg')));
check('image is in files[]', pkg.files.includes('docs'));
check('no stale DETAIL.md left', !existsSync(join(ROOT, 'docs', 'DETAIL.md')));
check('no stale DETAIL.zh.md left', !existsSync(join(ROOT, 'docs', 'DETAIL.zh.md')));

console.log('\n[6] Module imports without dependencies');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'index.js')).href);
  check('default export', typeof mod.default?.apply === 'function');
  check('named exports', typeof mod.apply === 'function' && Array.isArray(mod.inject));
  check('no Config export (dependency-free)', mod.Config === undefined, 'validated in apply()');
} catch (err) {
  check('module imports', false, err.message);
}

console.log('\n[7] Skill body');
const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
check('has frontmatter', skill.startsWith('---'));
check('name matches package', /^name:\s*figma-spec$/m.test(skill));
check('has description', /^description:\s*\S/m.test(skill));
check('body non-trivial', skill.length > 1500, `${skill.length} chars`);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);