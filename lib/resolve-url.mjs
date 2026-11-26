/**
 * Figma URL / node-id resolution.
 *
 * Accepts:
 *   https://www.figma.com/design/<key>/<name>?node-id=7116-6093&t=...
 *   https://www.figma.com/file/<key>/<name>?node-id=7116%3A6093
 *   https://www.figma.com/design/<key>/branch/<branchKey>/<name>?node-id=1-2
 *   <key> + "7116:6093"  (explicit form)
 *
 * Figma URLs write node ids with a hyphen; the REST API expects a colon.
 */

const NODE_ID_RE = /^\d+[:-]\d+$/;

export function toApiNodeId(raw) {
  if (typeof raw !== 'string') throw new Error('node id must be a string');
  let v = raw.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep literal */
  }
  if (!NODE_ID_RE.test(v)) {
    throw new Error(
      `invalid node id "${raw}": expected <number>:<number> or <number>-<number>`,
    );
  }
  return v.replace('-', ':');
}

export function fromApiNodeId(nodeId) {
  return nodeId.replace(':', '-');
}

/**
 * Resolve a Figma design URL (or explicit key/node pair) into
 * { fileKey, nodeId, branchKey, raw }.
 */
export function resolveTarget(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('a Figma URL or file key is required');
  }
  const text = input.trim();

  // Explicit "<fileKey>#<nodeId>" shorthand.
  const hash = text.match(/^([A-Za-z0-9]{10,})#(.+)$/);
  if (hash) {
    return {
      fileKey: hash[1],
      nodeId: toApiNodeId(hash[2]),
      branchKey: null,
      raw: text,
    };
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    // Bare file key with no node id is not enough for a spec lookup.
    if (/^[A-Za-z0-9]{10,}$/.test(text)) {
      throw new Error(
        `"${text}" looks like a file key but has no node id; pass <fileKey>#<nodeId> or a URL with ?node-id=`,
      );
    }
    throw new Error(`not a Figma URL: ${text}`);
  }

  const host = url.hostname.toLowerCase();
  if (!/(^|\.)figma\.com$/.test(host)) {
    throw new Error(`not a figma.com URL: ${host}`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // design | file | proto | board
  const kindIdx = parts.findIndex((p) =>
    ['design', 'file', 'proto', 'board'].includes(p),
  );
  if (kindIdx === -1) {
    throw new Error(
      'URL does not contain a /design/ or /file/ segment; open the file in Figma and copy the share link',
    );
  }
  if (parts[kindIdx] === 'proto') {
    throw new Error(
      'prototype links have no REST node spec; use the /design/ link for the same frame',
    );
  }

  const fileKey = parts[kindIdx + 1];
  if (!fileKey) throw new Error('URL is missing the file key');

  let branchKey = null;
  if (parts[kindIdx + 2] === 'branch') {
    branchKey = parts[kindIdx + 3];
    if (!branchKey) throw new Error('branch URL is missing the branch key');
  }

  const nodeParam = url.searchParams.get('node-id');
  if (!nodeParam) {
    throw new Error(
      'URL has no ?node-id= parameter; select the frame or group in Figma and copy its link',
    );
  }

  return {
    // On a branch URL the branch key is the file key the API expects.
    fileKey: branchKey ?? fileKey,
    nodeId: toApiNodeId(nodeParam),
    branchKey,
    raw: text,
  };
}