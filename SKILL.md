---
name: figma-spec
description: Read a Figma frame's real style data over the REST API and turn it into a spec table, type scale, palette, or node diff. Use when the user supplies a Figma link and asks for the design's actual colors, font sizes, spacing, radii, or a complete style sheet — not when they want code generated from the design.
---

# Figma spec extraction

The `figma_get_spec`, `figma_get_typography`, `figma_get_palette`, and
`figma_diff_nodes` tools return real values read from Figma's REST API. Every
number is measured from the design file, never inferred from a screenshot.

## Which tool to call

| The user wants | Call |
|---|---|
| "what's in this page and what are the styles" | `figma_get_spec` with `format: summary` |
| a full table to import or diff | `figma_get_spec` with `format: csv` |
| a design-token / CSS-variable sheet | `figma_get_palette` + `figma_get_typography` |
| to check an implementation matches the design | `figma_diff_nodes` |

Start with `summary`. A 1920×1200 dashboard is ~540 nodes; dumping the full
table wastes context and buries the answer. Read `csv` only when the user needs
per-node values.

## Facts about the data you must not get wrong

1. **`absoluteBoundingBox` is absolute, not frame-relative.** The tools already
   subtract the root node's origin, so reported `x`/`y` start at 0,0 for the
   frame. Do not subtract again.

2. **A "divider" is usually a stroke, not a rectangle.** Card headers carry a
   bottom-only inside stroke: `strokeSides: "bottom:1"` with
   `strokeAlign: "INSIDE"`. Looking for a 1px rectangle will not find it. Read
   `strokeSides` before claiming a line exists.

3. **Per-corner radii only appear on some nodes.** `radius: "r4=1/1/0/0"` means
   the top two corners are rounded and the bottom two are square — typical for
   bar charts. `radius: "r=8"` is a uniform radius. These are mutually
   exclusive fields in Figma.

4. **Grid auto-layout spacing is not `itemSpacing`.** A GRID frame reports
   `itemSpacing: null`; its gaps live in `gridColumnGap` / `gridRowGap`. The
   tools surface both as `grid=<col>x<row>` plus `cols=` / `rows=` sizing.

5. **Donut charts use `arcData`.** The ring ratio is `arcData.innerRadius`
   (e.g. `0.667` → ring thickness is ~33% of the radius). A full circle still
   carries `arcData` with `innerRadius: 0`; the tools suppress that so only
   real arcs appear.

6. **Gradient direction lives in `gradientHandlePositions`,** not in the colour
   stops. The tools render stops as `linear(#a:0.00|#b:1.00)`; ask for the raw
   node if a caller needs the handle coordinates.

7. **Font weight is numeric** (`400`, `500`), and line height is absolute
   pixels (`lineHeightPx`), not a multiplier. Do not convert to `1.5` style
   ratios unless the user asks.

8. **`styles` and `boundVariables` are references, not names.** A node may
   report `boundVariables: ["fills"]` or a `styles` id. Resolving those to
   variable *names* requires a Figma plan that exposes the Variables REST API;
   a Starter account gets HTTP 403 there. Report the id as a reference rather
   than inventing a token name.

## Quota: this matters more than it looks

Figma rate-limits the REST API per token and per plan tier. The response
headers carry the truth:

| Header | Meaning |
|---|---|
| `x-figma-plan-tier` | `starter`, `professional`, `organization`, `enterprise` |
| `x-figma-rate-limit-type` | `low` on Starter |
| `retry-after` | seconds until the window reopens |

A **Starter** token can be locked out for **more than a day** after a handful
of `/files/:key/nodes` calls. Two consequences for how you work:

- **Never re-fetch a frame you already read.** The plugin caches node payloads
  under `$DSH_HOME/figma-spec-cache` and reports `_source: cached payload_`
  with the save time. Trust it; a second read costs no quota.
- **Do not retry a long lock.** A `retry-after` above 300 s means the quota
  window is closed, not a burst throttle. The plugin surfaces the plan tier and
  the wait instead of looping.

If a call fails with a quota message, tell the user the tier and roughly how
long the lock lasts. Do not silently downgrade to screenshot sampling and call
the result a spec.

## Endpoints that need more than a token

| Endpoint | Requirement |
|---|---|
| `GET /v1/files/:key/nodes` | any token with file access |
| `GET /v1/files/:key` | any token with file access |
| `GET /v1/files/:key/variables/local` | **Enterprise** plan; 403 otherwise |
| `GET /v1/files/:key/styles` | works, but returns only published styles |

The official Figma MCP server (`https://mcp.figma.com/mcp`) is a **separate
product** with OAuth auth. A personal access token returns 401 there; it
authenticates `api.figma.com` only. Do not conflate the two.

## Reporting style

Give the user values, then their meaning. Prefer:

- tokens first (colours, radii, type scale) because they are reusable
- then per-region geometry
- then a note on anything the API could not resolve (variable names, hidden
  layers, components from unpublished libraries)

State the plan tier when quota blocked a read. Never present a cached payload
as a fresh measurement without saying so.