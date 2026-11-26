/**
 * Minimal Figma REST client.
 *
 * Two rules learned the hard way:
 *  1. Never parse a large node response with a JSON round-trip just to write it
 *     to disk. Read the raw bytes and write them. Parsing + pretty-printing
 *     turned a 1.6 MB response into 29.5 MB in an earlier session.
 *  2. Figma rate limits aggressively (429). Back off exponentially and honour
 *     Retry-After when present.
 */

const API = 'https://api.figma.com/v1';

export class FigmaError extends Error {
  constructor(message, { status, body, retryable = false, quota = null } = {}) {
    super(message);
    this.name = 'FigmaError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
    this.quota = quota;
  }
}

/**
 * Figma exposes its plan tier and remaining-quota signal in response headers.
 * A Starter (free) account can exhaust its REST quota and then be locked out
 * for tens of hours, so the client surfaces this instead of hiding it behind a
 * generic retry loop.
 */
export function readQuotaHeaders(headers) {
  const get = (k) => headers.get(k) ?? headers.get(k.toLowerCase()) ?? null;
  const retryAfter = get('retry-after');
  return {
    planTier: get('x-figma-plan-tier'),
    rateLimitType: get('x-figma-rate-limit-type'),
    retryAfterSeconds: retryAfter != null ? Number(retryAfter) : null,
    upgradeLink: get('x-figma-upgrade-link'),
  };
}

function quotaMessage(quota) {
  const hours = quota.retryAfterSeconds != null
    ? (quota.retryAfterSeconds / 3600).toFixed(1)
    : null;
  const tier = quota.planTier ? ` plan "${quota.planTier}"` : '';
  const wait = hours ? ` The quota unlocks in about ${hours} h.` : '';
  const up = quota.upgradeLink ? ` Quota details: ${quota.upgradeLink}` : '';
  return `Figma REST quota exhausted for this${tier} account.${wait}${up}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Issue one authenticated request and return the raw Response-like object.
 * `as: 'text' | 'json' | 'arrayBuffer'` decides how the body is consumed.
 */
export async function figmaRequest(path, { token, as = 'json', signal, fetchImpl = fetch } = {}) {
  if (!token) {
    throw new FigmaError(
      'No Figma personal access token configured. Add one in the Figma Spec plugin settings.',
      { status: 401 },
    );
  }

  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetchImpl(url, {
    headers: { 'X-Figma-Token': token, 'User-Agent': 'dsh-figma-spec' },
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const quota = readQuotaHeaders(res.headers);
    // A long Retry-After means the quota window is exhausted, not a burst
    // throttle: retrying is pointless and burns the user's time.
    const quotaExhausted = res.status === 429 && (quota.retryAfterSeconds ?? 0) > 300;
    const message = quotaExhausted ? quotaMessage(quota) : describeStatus(res.status, body);
    throw new FigmaError(message, {
      status: res.status,
      body,
      retryable: (res.status === 429 && !quotaExhausted) || res.status >= 500,
      quota,
    });
  }

  if (as === 'json') return res.json();
  if (as === 'text') return res.text();
  return res.arrayBuffer();
}

function describeStatus(status, body) {
  // Figma answers with {"status":401,"err":"Token has expired"}. Surfacing that
  // text is the difference between "you cannot debug this" and "your token
  // expired, mint a new one".
  let upstream = '';
  try {
    const parsed = JSON.parse(body || '{}');
    upstream = typeof parsed.err === 'string' ? parsed.err : '';
  } catch {
    upstream = (body || '').slice(0, 300).trim();
  }
  const expired = /expired/i.test(upstream);

  let hint;
  if (status === 401) {
    hint = expired
      ? 'This Figma token has expired. Create a new personal access token and save it here.'
      : 'Figma rejected this token. Check that it is current and not revoked.';
  } else {
    hint =
      {
        403: 'This token lacks access to the file, or the endpoint needs a higher Figma plan.',
        404: 'The file or node does not exist, or the token cannot see it.',
        429: 'Rate limited by Figma. Retry after a short wait.',
      }[status] ?? `Figma returned HTTP ${status}.`;
  }

  return upstream && upstream !== hint ? `${hint} (Figma said: ${upstream})` : hint;
}

/**
 * Fetch one or more node ids with a bounded number of retries.
 * `depth` is deliberately not defaulted: callers pass it when they want a
 * partial tree.
 */
export async function fetchNodes(fileKey, nodeIds, options = {}) {
  const {
    token,
    depth,
    geometry,
    signal,
    retries = 3,
    onRetry,
    fetchImpl = fetch,
  } = options;

  const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  const params = new URLSearchParams({ ids: ids.join(',') });
  if (depth != null) params.set('depth', String(depth));
  if (geometry) params.set('geometry', geometry);

  const path = `/files/${encodeURIComponent(fileKey)}/nodes?${params}`;

  let attempt = 0;
  for (;;) {
    try {
      return await figmaRequest(path, { token, as: 'json', signal, fetchImpl });
    } catch (err) {
      const canRetry = err instanceof FigmaError && err.retryable && attempt < retries;
      if (!canRetry) throw err;
      // Figma's rate limiter is per-token and unforgiving. Start at 2s and
      // quadruple, capped at 60s: 2s, 8s, 32s, 60s.
      const delay = Math.min(60_000, 2_000 * 4 ** attempt);
      attempt += 1;
      onRetry?.({ attempt, delay, status: err.status });
      await sleep(delay);
    }
  }
}

/**
 * Stream a response body straight to a file handle without materializing it as
 * a string. Used by the export/testing path.
 */
export async function fetchNodesRaw(fileKey, nodeIds, options = {}) {
  const { token, depth, geometry, signal, fetchImpl = fetch } = options;
  const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  const params = new URLSearchParams({ ids: ids.join(',') });
  if (depth != null) params.set('depth', String(depth));
  if (geometry) params.set('geometry', geometry);
  const url = `${API}/files/${encodeURIComponent(fileKey)}/nodes?${params}`;
  const res = await fetchImpl(url, {
    headers: { 'X-Figma-Token': token, 'User-Agent': 'dsh-figma-spec' },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const quota = readQuotaHeaders(res.headers);
    const quotaExhausted = res.status === 429 && (quota.retryAfterSeconds ?? 0) > 300;
    throw new FigmaError(quotaExhausted ? quotaMessage(quota) : describeStatus(res.status, body), {
      status: res.status,
      body,
      retryable: (res.status === 429 && !quotaExhausted) || res.status >= 500,
      quota,
    });
  }
  return res;
}

/** Verify a token and return the account it belongs to. */
export async function whoAmI({ token, signal, fetchImpl = fetch }) {
  return figmaRequest('/me', { token, as: 'json', signal, fetchImpl });
}