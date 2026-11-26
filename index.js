/**
 * dsh-figma-spec - Host plugin entry.
 *
 * Registers four model-facing tools and one skill. No MCP server, no build
 * step, no runtime dependencies: everything imports from this package.
 *
 * Credential handling: the Figma personal access token is stored through the
 * harness credentials service under FIGMA_TOKEN. It is never read from plugin
 * configuration and never logged.
 */
import { resolveTarget } from './lib/resolve-url.mjs';
import { fetchNodes, whoAmI, FigmaError } from './lib/figma-api.mjs';
import { normalize, palette, typography, diffRecords } from './lib/normalize.mjs';
import { render } from './lib/render.mjs';
import { NodeCache } from './lib/cache.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The skill body is read once at activation rather than imported: Node has no
 * text-module loader for .md, and bundling it into JS would make the file
 * harder to review.
 */
function loadSkillBody() {
  try {
    return readFileSync(join(HERE, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
}

export const name = 'figma-spec';

/** Optional services: the plugin stays inert where they are absent. */
export const inject = ['tools'];

/**
 * No `Config` export on purpose.
 *
 * A Config schema must be a schemastery instance, and schemastery ships inside
 * the harness rather than this package. A locally-linked bundle resolves
 * modules from its real path, not from the profile's hoisted node_modules, so
 * importing the harness copy here breaks activation for directory installs.
 * Config is optional in the Loader, so the options are validated defensively in
 * `apply` instead - which also keeps the package dependency-free for git
 * installs.
 */
const DEFAULTS = {
  cacheDir: '',
  maxRecords: 600,
  cacheTtlHours: 168,
};

function resolveConfig(raw) {
  const cfg = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return cfg;
  if (typeof raw.cacheDir === 'string') cfg.cacheDir = raw.cacheDir;
  const num = (v, fallback, min, max) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  cfg.maxRecords = num(raw.maxRecords, DEFAULTS.maxRecords, 1, 20000);
  cfg.cacheTtlHours = num(raw.cacheTtlHours, DEFAULTS.cacheTtlHours, 0, 24 * 365);
  return cfg;
}

/**
 * Tool output contract: the Loader requires `render` beside `schema`, and
 * render returns the ordered content blocks the model reads. These tools all
 * produce one Markdown/CSV text block.
 */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
};

const NOT_CONFIGURED = [
  'No Figma personal access token is configured.',
  '',
  'To configure it:',
  '  Open Settings > Plugins > Figma spec reader and paste a token, or',
  '  create one at https://www.figma.com/settings (Personal access tokens)',
  '  and save it as FIGMA_TOKEN in the harness credential store.',
  '',
  'The token needs read access to the file you are inspecting.',
].join('\n');

const TOKEN_KEY = 'FIGMA_TOKEN';

/**
 * Resolve a credential reference.
 *
 * The harness exposes `credentialRef()` to brand a plain variable name. That
 * helper lives in `@deepseek-ai/dsh-credentials`, which a directory-installed
 * bundle cannot always resolve, so fall back to the bare string — the store
 * accepts it and the branding is a compile-time convenience only.
 */
async function credentialRefLazy(key) {
  try {
    const mod = await import('@deepseek-ai/dsh-credentials');
    if (typeof mod.credentialRef === 'function') return mod.credentialRef(key);
  } catch {
    /* fall through to the plain string */
  }
  return key;
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config);
  const cacheDir = cfg.cacheDir || defaultCacheDir();
  const cache = new NodeCache(cacheDir, { ttlMs: cfg.cacheTtlHours * 3600_000 });

  async function readToken() {
    const store = ctx.get('credentials');
    if (!store) return null;
    try {
      const ref = await credentialRefLazy('FIGMA_TOKEN');
      // `resolve` answers { value, source }; older stores expose `read`.
      if (typeof store.resolve === 'function') {
        const hit = await store.resolve(ref);
        const v = typeof hit === 'string' ? hit : hit?.value;
        return typeof v === 'string' && v.length > 0 ? v : null;
      }
      const value = await store.read(ref);
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a design URL to normalized records, using the cache first so a
   * read costs zero REST quota when the frame has been seen before.
   */
  async function loadRecords(input, exec) {
    const target = resolveTarget(input);
    const params = { fileKey: target.fileKey, nodeId: target.nodeId, depth: null };

    const cached = await cache.get(params);
    if (cached.hit) {
      const node = cached.value?.nodes?.[target.nodeId];
      if (node?.document) {
        return {
          target,
          root: node.document,
          records: normalize(node.document),
          fromCache: true,
          savedAt: cached.meta?.savedAt ?? null,
        };
      }
    }

    const token = await readToken();
    if (!token) throw new FigmaError(NOT_CONFIGURED, { status: 401 });

    const doc = await fetchNodes(target.fileKey, target.nodeId, {
      token,
      signal: exec?.signal,
    });
    const node = doc?.nodes?.[target.nodeId];
    if (!node?.document) {
      throw new FigmaError(`Figma returned no document for node ${target.nodeId}.`, { status: 404 });
    }
    await cache.put(params, doc, { fileKey: target.fileKey, nodeId: target.nodeId });
    return {
      target,
      root: node.document,
      records: normalize(node.document),
      fromCache: false,
      savedAt: Date.now(),
    };
  }

  const sourceNote = (r) => {
    if (!r.fromCache) return '\n\n_source: live Figma REST response_';
    const when = r.savedAt ? ` (saved ${new Date(r.savedAt).toISOString()})` : '';
    return `\n\n_source: cached payload${when} - no REST quota used_`;
  };

  // ------------------------------------------------------------------ tools
  ctx.tools.register({
    name: 'figma_get_spec',
    description:
      "Read a Figma frame's real style data and render it as a spec. Returns every node's box, fills, strokes (including per-side weights), gradients, effects, radii, arc data, grid gaps, and typography. Use this when the user asks for a design's actual colors, sizes, spacing, radii, or a complete style specification - not when they want code generated from a design.",
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'A Figma design URL containing ?node-id=..., or <fileKey>#<nodeId>.',
      },
      format: {
        type: 'string',
        enum: ['summary', 'csv', 'markdown', 'tree'],
        description: 'summary (default) is a bounded digest; csv is the full table.',
      },
      maxRecords: {
        type: 'number',
        description: 'Cap on returned records for csv/markdown/tree. Defaults to the plugin config.',
      },
    },
    output: textOutput,
    async execute(args, exec) {
      const loaded = await loadRecords(args.url, exec);
      const format = args.format ?? 'summary';
      const records = loaded.records;

      if (format === 'csv') {
        const cap = args.maxRecords ?? cfg.maxRecords;
        const sliced = records.slice(0, cap);
        const box = loaded.root.absoluteBoundingBox ?? {};
        const header = `# ${loaded.root.name} - ${box.width}x${box.height}\n`;
        const truncated =
          records.length > cap ? `\n# truncated: ${records.length - cap} more records` : '';
        return header + render(sliced, 'csv') + truncated;
      }
      return render(records, format, { name: loaded.root.name }) + sourceNote(loaded);
    },
  });

  ctx.tools.register({
    name: 'figma_get_typography',
    description:
      "List the type scale of a Figma frame: every font family, size, weight, and line height combination, with how many nodes use it and example copy. Use this to build a typography token sheet or verify a UI's text styles match a design.",
    parameters: {
      url: { type: 'string', required: true, description: 'Figma design URL or <fileKey>#<nodeId>.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const loaded = await loadRecords(args.url, exec);
      const rows = typography(loaded.records);
      const lines = [`# Type scale - ${loaded.root.name}`, ''];
      lines.push('| Family | Size | Weight | Line height | Nodes | Examples |');
      lines.push('|---|---|---|---|---|---|');
      for (const t of rows) {
        const lh = t.lineHeights.map((l) => `${l.px}`).join(' / ') || '-';
        const examples = t.examples.map((e) => `\`${e}\``).join('<br>');
        lines.push(
          `| ${t.fontFamily} | ${t.fontSize}px | ${t.fontWeight} | ${lh} | ${t.count} | ${examples} |`,
        );
      }
      const families = [...new Set(rows.map((t) => t.fontFamily))];
      const sizes = [...new Set(rows.map((t) => t.fontSize))].sort((a, b) => a - b);
      lines.push(
        '',
        `Font families: ${families.join(', ') || 'none'}`,
        `Distinct sizes: ${sizes.join(', ')}`,
      );
      return lines.join('\n') + sourceNote(loaded);
    },
  });

  ctx.tools.register({
    name: 'figma_get_palette',
    description:
      'List every distinct fill, stroke, gradient, and effect used in a Figma frame, ordered by how often each appears, with example node paths. Use this to derive color tokens, audit inconsistent colors, or confirm a design uses a single brand color.',
    parameters: {
      url: { type: 'string', required: true, description: 'Figma design URL or <fileKey>#<nodeId>.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const loaded = await loadRecords(args.url, exec);
      const pal = palette(loaded.records);
      const section = (title, rows) => {
        if (!rows.length) return [`## ${title}`, '_none_', ''];
        const out = [`## ${title}`, '| Value | Uses | Examples |', '|---|---|---|'];
        for (const r of rows) {
          const names = r.examples.map((e) => e.split('/').pop()).join(', ');
          out.push(`| ${r.value} | ${r.count} | ${names} |`);
        }
        out.push('');
        return out;
      };
      const lines = [`# Palette - ${loaded.root.name}`, ''];
      lines.push(...section('Fills', pal.fills));
      lines.push(...section('Strokes', pal.strokes));
      lines.push(...section('Effects', pal.effects));
      return lines.join('\n') + sourceNote(loaded);
    },
  });

  ctx.tools.register({
    name: 'figma_diff_nodes',
    description:
      'Compare the styles of two Figma nodes and report per-property differences (box, fills, strokes, radii, effects, opacity, layout, typography, text). Use this to check whether an implemented screen still matches its design, or to see what changed between two revisions.',
    parameters: {
      left: {
        type: 'string',
        required: true,
        description: 'Figma design URL or <fileKey>#<nodeId> for the baseline.',
      },
      right: {
        type: 'string',
        required: true,
        description: 'Figma design URL or <fileKey>#<nodeId> for the comparison.',
      },
      limit: { type: 'number', description: 'Maximum changed nodes to list. Defaults to 100.' },
    },
    output: textOutput,
    async execute(args, exec) {
      const left = await loadRecords(args.left, exec);
      const right = await loadRecords(args.right, exec);
      const diff = diffRecords(left.records, right.records);
      const limit = args.limit ?? 100;

      const lines = [
        '# Node diff',
        '',
        `left : ${left.root.name} (${left.records.length} records)`,
        `right: ${right.root.name} (${right.records.length} records)`,
        '',
        `changed ${diff.changed.length} / only-left ${diff.onlyLeft.length} / only-right ${diff.onlyRight.length}`,
        '',
      ];

      if (diff.changed.length) {
        lines.push('## Changed', '| Node | Property | Left | Right |', '|---|---|---|---|');
        for (const c of diff.changed.slice(0, limit)) {
          for (const d of c.deltas) {
            lines.push(
              `| ${c.name} | ${d.field} | ${JSON.stringify(d.left)} | ${JSON.stringify(d.right)} |`,
            );
          }
        }
        if (diff.changed.length > limit) {
          lines.push(`| ... | ${diff.changed.length - limit} more nodes omitted | | |`);
        }
        lines.push('');
      }
      if (diff.onlyLeft.length) {
        lines.push('## Only in left');
        for (const r of diff.onlyLeft.slice(0, limit)) {
          lines.push(`- ${r.type} "${r.name}"`);
        }
        lines.push('');
      }
      if (diff.onlyRight.length) {
        lines.push('## Only in right');
        for (const r of diff.onlyRight.slice(0, limit)) {
          lines.push(`- ${r.type} "${r.name}"`);
        }
        lines.push('');
      }
      return lines.join('\n') + sourceNote(left) + sourceNote(right);
    },
  });

  // ------------------------------------------------------------------- skill
  const skills = ctx.get('skills');
  const skillBody = loadSkillBody();
  if (skills?.register && skillBody) {
    const disposer = skills.register({
      name: 'figma-spec',
      description:
        "Read a Figma frame's real style data through the REST API and turn it into a spec, type scale, palette, or diff. Use when the user supplies a Figma link and asks for the design's actual colors, font sizes, spacing, radii, or a complete style sheet.",
      body: skillBody,
      modelInvocable: true,
      userInvocable: true,
    });
    if (typeof disposer === 'function') ctx.effect(() => disposer);
  }

  // ------------------------------------------------------- settings endpoints
  /**
   * The settings page is a Client plugin; these routes are the only way it can
   * touch the credential store. All three are same-origin and never return the
   * token itself:
   *   GET  /plugins/dsh-figma-spec/token  -> { configured, source, masked? }
   *   POST /plugins/dsh-figma-spec/token  -> save + validate, returns the handle
   *   DEL  /plugins/dsh-figma-spec/token  -> remove
   */
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer');
    if (!server || typeof server.register !== 'function') return;

    const json = (res, status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
      });
      res.end(text);
    };

    const sameOrigin = (req) => {
      // Reject cross-origin writes: the route mutates a stored secret.
      const origin = req.headers.origin;
      if (!origin) return true; // same-origin fetches may omit it
      const host = req.headers.host;
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    };

    const readBody = (req, limit = 8192) =>
      new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
          size += c.length;
          if (size > limit) {
            reject(new Error('request body too large'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });

    const dispose = server.register({
      kind: 'exact',
      path: '/plugins/dsh-figma-spec/token',
      handler: async (req, res) => {
        const store = ctx.get('credentials');
        if (!store) {
          json(res, 503, { error: 'No credential store is mounted in this profile.' });
          return;
        }
        const ref = await credentialRefLazy(TOKEN_KEY);

        if (req.method === 'GET' || req.method === 'HEAD') {
          try {
            const info = typeof store.describe === 'function' ? await store.describe(ref) : null;
            // Cross-check with resolve: a token is only usable if a value
            // actually comes back. `describe` alone can report a source for a
            // key the store cannot hand out.
            let hasValue = false;
            try {
              if (typeof store.resolve === 'function') {
                const hit = await store.resolve(ref);
                // `resolve` answers { value, source }; a miss may still return
                // an object with an undefined value, which must not count as
                // configured. Only a non-empty string is a usable token.
                const v = typeof hit === 'string' ? hit : hit?.value;
                hasValue = typeof v === 'string' && v.length > 0;
              } else if (typeof store.read === 'function') {
                const v = await store.read(ref);
                hasValue = typeof v === 'string' && v.length > 0;
              }
            } catch {
              hasValue = false;
            }
            // `describe` alone can report a source for a key that yields no
            // value, so the resolved value decides.
            const configured = hasValue;
            json(res, 200, {
              configured,
              source: configured ? (info?.source ?? null) : null,
              masked: configured ? (info?.masked ?? null) : null,
              writable: info?.writable !== false,
              applied: hasValue,
              // Presence-only diagnostics: helps tell "the harness launch
              // environment supplies FIGMA_TOKEN" from "the file does".
              envPresent: typeof process.env[TOKEN_KEY] === 'string' && process.env[TOKEN_KEY].length > 0,
              describeKeys: info == null ? null : Object.keys(info),
            });
          } catch (err) {
            json(res, 500, { error: String(err?.message ?? err) });
          }
          return;
        }

        if (!sameOrigin(req)) {
          json(res, 403, { error: 'Cross-origin request rejected.' });
          return;
        }

        if (req.method === 'DELETE') {
          try {
            await store.unset(ref);
            json(res, 200, { configured: false });
          } catch (err) {
            json(res, 500, { error: String(err?.message ?? err) });
          }
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, HEAD, POST, DELETE' });
          res.end();
          return;
        }

        let token;
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          token = typeof body.token === 'string' ? body.token.trim() : '';
        } catch {
          json(res, 400, { error: 'Expected a JSON body: { "token": "figd_..." }' });
          return;
        }
        if (!token) {
          json(res, 400, { error: 'Token is empty.' });
          return;
        }
        if (!/^figd_[A-Za-z0-9_-]{10,}$/.test(token)) {
          json(res, 400, {
            error: 'That does not look like a Figma personal access token (expected figd_...).',
          });
          return;
        }

        // Validate before storing so a typo never replaces a working token.
        let account;
        try {
          account = await whoAmI({ token });
        } catch (err) {
          const status = err instanceof FigmaError ? err.status : 0;
          // `err.message` already carries Figma's own explanation, including
          // the difference between an expired token and a rejected one.
          json(res, status === 401 ? 401 : 502, {
            error: status === 401 ? err.message : `Could not reach Figma to validate the token: ${err.message}`,
            reason: status === 401 ? 'rejected' : 'unreachable',
          });
          return;
        }

        try {
          await store.set(ref, token);
        } catch (err) {
          json(res, 500, { error: `Figma accepted the token but it could not be saved: ${err.message}` });
          return;
        }

        json(res, 200, {
          configured: true,
          handle: account?.handle ?? null,
          email: account?.email ?? null,
        });
      },
    });

    if (typeof dispose === 'function') ctx.effect(() => dispose);

    /**
     * UI settings, persisted next to the node cache.
     *
     * The page registers `sidebar.panellist` only while this flag is on, so the
     * flag has to survive a reload. It is deliberately not in
     * `cordis.patch.yml`: that file belongs to the user's profile, and a
     * checkbox must not rewrite it.
     */
    const settingsPath = join(cacheDir, 'settings.json');

    const readSettings = () => {
      try {
        const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
        return { sidebarPanel: raw?.sidebarPanel === true };
      } catch {
        return { sidebarPanel: false };
      }
    };

    const writeSettings = (next) => {
      try {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ sidebarPanel: next.sidebarPanel === true }), 'utf8');
        return true;
      } catch {
        return false;
      }
    };

    const disposeSettings = server.register({
      kind: 'exact',
      path: '/plugins/dsh-figma-spec/settings',
      handler: async (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          json(res, 200, readSettings());
          return;
        }
        if (!sameOrigin(req)) {
          json(res, 403, { error: 'Cross-origin request rejected.' });
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, HEAD, POST' });
          res.end();
          return;
        }
        let patch;
        try {
          patch = JSON.parse((await readBody(req)) || '{}');
        } catch {
          json(res, 400, { error: 'Expected a JSON body.' });
          return;
        }
        const next = { ...readSettings() };
        if (typeof patch.sidebarPanel === 'boolean') next.sidebarPanel = patch.sidebarPanel;
        if (!writeSettings(next)) {
          json(res, 500, { error: 'The settings file could not be written.' });
          return;
        }
        json(res, 200, next);
      },
    });

    if (typeof disposeSettings === 'function') ctx.effect(() => disposeSettings);
  });
}

function defaultCacheDir() {
  const home = process.env.DSH_HOME || `${process.env.USERPROFILE || process.env.HOME || '.'}/.dsh`;
  return `${home}/figma-spec-cache`;
}

export default { name, inject, apply };