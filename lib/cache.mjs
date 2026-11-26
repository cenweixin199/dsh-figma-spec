/**
 * Disk cache for node payloads.
 *
 * Motivation is concrete: a Starter-plan token can be locked out of
 * /files/:key/nodes for over a day after a handful of calls (observed
 * retry-after 117040 s). Re-reading the same frame must never cost a request.
 *
 * Keyed by fileKey + nodeId + depth. Entries are stored as raw JSON bytes,
 * which is also the cheapest way to round-trip them (no parse/serialize cost).
 */
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a design's spec rarely changes hourly
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

function cacheKey({ fileKey, nodeId, depth }) {
  return createHash('sha256')
    .update(`${fileKey}|${nodeId}|${depth ?? 'full'}`)
    .digest('hex')
    .slice(0, 32);
}

export class NodeCache {
  constructor(rootDir, { ttlMs = DEFAULT_TTL_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.rootDir = rootDir;
    this.ttlMs = ttlMs;
    this.maxBytes = maxBytes;
  }

  async ensure() {
    await mkdir(this.rootDir, { recursive: true });
  }

  async pathFor(params) {
    const key = cacheKey(params);
    return { key, file: join(this.rootDir, `${key}.json`), meta: join(this.rootDir, `${key}.meta.json`) };
  }

  /** Returns { hit, value, meta } — a miss is not an error. */
  async get(params) {
    const { file, meta } = await this.pathFor(params);
    try {
      const info = await stat(file);
      if (Date.now() - info.mtimeMs > this.ttlMs) {
        return { hit: false, reason: 'expired' };
      }
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      let metadata = null;
      try {
        metadata = JSON.parse(await readFile(meta, 'utf8'));
      } catch {
        /* metadata is optional */
      }
      return { hit: true, value: parsed, meta: metadata, bytes: info.size };
    } catch (err) {
      if (err.code === 'ENOENT') return { hit: false, reason: 'absent' };
      if (err instanceof SyntaxError) return { hit: false, reason: 'corrupt' };
      throw err;
    }
  }

  async put(params, value, metadata = {}) {
    await this.ensure();
    const { file, meta } = await this.pathFor(params);
    // Write compact JSON: pretty-printing a 1.6 MB response produced a 29.5 MB
    // file in an earlier session for no benefit.
    await writeFile(file, JSON.stringify(value), 'utf8');
    await writeFile(meta, JSON.stringify({ ...metadata, savedAt: Date.now() }), 'utf8');
    await this.evictIfNeeded();
    return file;
  }

  /** Drop oldest entries until the cache fits its byte budget. */
  async evictIfNeeded() {
    let names;
    try {
      names = await readdir(this.rootDir);
    } catch {
      return;
    }
    const files = [];
    for (const n of names) {
      if (!n.endsWith('.json') || n.endsWith('.meta.json')) continue;
      const p = join(this.rootDir, n);
      try {
        const s = await stat(p);
        files.push({ p, size: s.size, mtime: s.mtimeMs });
      } catch {
        /* vanished */
      }
    }
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= this.maxBytes) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= this.maxBytes) break;
      try {
        await unlink(f.p);
        await unlink(f.p.replace(/\.json$/, '.meta.json')).catch(() => {});
        total -= f.size;
      } catch {
        /* ignore */
      }
    }
  }

  async stats() {
    let names = [];
    try {
      names = await readdir(this.rootDir);
    } catch {
      return { entries: 0, bytes: 0 };
    }
    let bytes = 0;
    let entries = 0;
    for (const n of names) {
      if (!n.endsWith('.json') || n.endsWith('.meta.json')) continue;
      try {
        bytes += (await stat(join(this.rootDir, n))).size;
        entries += 1;
      } catch {
        /* ignore */
      }
    }
    return { entries, bytes };
  }
}