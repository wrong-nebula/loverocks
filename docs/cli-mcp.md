# CLI and MCP budget comparisons

Both interfaces call the same Wasm source generator, LOD reducer and independent 16-camera GPU opening validator as the studio. They measure geometry quality and return replayable JSON; GLB baking/export remains in the studio. All four Fjord forms are supported. The experimental skeleton and the strict 128-pixel acceptance limits are unchanged.

## Setup

From the repository, using Node.js 22.12 or newer:

```sh
npm ci
npx playwright install chromium
node automation/cli.js --help
```

Keep development dependencies installed: the local runner uses Vite and Playwright. It starts a temporary loopback server and headless Chromium with SwiftShader, makes no remote API calls, and cleans up the browser/server/cache on completion, cancellation or timeout. No API key is required. The runner works from any current directory when invoked using an absolute script path.

## CLI

```sh
# Discover supported forms, methods, limits and acceptance policy.
node automation/cli.js catalog

# Compare custom budgets; all methods use the same source.
node automation/cli.js curve --form 1 --seed fjord-2168 --resolution 54 \
  --budgets 300,600,1200 --method skeleton --priority budget \
  --size 128 --out curve.json

# Reproduce a curve exported from the UI, or change its budgets.
node automation/cli.js curve --input rock-quality-budget-curve.json \
  --budgets 500,1000,2000 --detail full --out replay.json

# Fail CI when any budget misses the 128-pixel opening acceptance contract.
node automation/cli.js curve --input request.json --require-pass > result.json
```

`npm run cli -- ...` is an interactive convenience. Use `node automation/cli.js` directly when stdout must contain only JSON. The package also declares `loverocks` and `loverocks-mcp` bin entries for environments that install/link the repository.

JSON goes to stdout unless `--out` is supplied. Progress and errors go to stderr; `--quiet` suppresses progress. Existing output files require `--force` to replace them. Ctrl-C cancels. Exit codes: 0 completed comparison, 1 invalid input/runtime failure, 2 failed acceptance with `--require-pass`, 130 cancelled. Quality failures are measured results and do not produce a runtime error by default. Diagnostic sizes and no-visible-region results cannot satisfy `--require-pass`.

The input file may be a schema-1 UI/CLI curve export or an automation request:

```json
{
  "source": {"form": 1, "seed": "fjord-2168", "resolution": 54, "fracture": 0.12, "years": 180},
  "budgets": [500, 750, 1000, 2000],
  "method": "skeleton",
  "priority": "budget",
  "tolerance": 0.03,
  "features": 1,
  "size": 128,
  "detail": "summary",
  "timeoutMs": 600000
}
```

`source` accepts preset settings (`form`, `seed`, `resolution`, `years`, `climate`, `weather`, `fracture`, `carving`, `moss`, `wet`, `lichen`) or the exact `source.job` object from an exported curve. Exact jobs preserve the procedural options, weather and moss settings. CLI source overrides are rejected for exact-job replays to prevent mixing a different seed with old procedural parameters. Preset defaults match the studio, except that source detail defaults to 54 for a practical headless run.

Budgets: 1–12 integers, 24–50,000, sorted/deduplicated. Methods: `skeleton`, `anchors-off`, `anchors`, `strict`, `off`. Landmark/strict modes enforce quality priority and may exceed the target. Tolerance ranges from .001 to .5 and feature emphasis from 0 to 3. Source resolution ranges from 16 to 256. Timeout ranges from 1 second to 30 minutes, default 10 minutes. Invalid/unknown values are rejected rather than clamped.

## MCP

Start the local stdio server directly:

```sh
node /absolute/path/to/loverocks/automation/mcp.js
```

Do not use ordinary `npm run mcp` as a host's command: npm's banner can interfere with protocol stdout. A typical MCP host configuration is:

```json
{
  "mcpServers": {
    "loverocks": {
      "command": "node",
      "args": ["/absolute/path/to/loverocks/automation/mcp.js"]
    }
  }
}
```

The server uses the [official TypeScript SDK's stdio transport](https://ts.sdk.modelcontextprotocol.io/server#stdio). Configuration syntax varies by host; no host configuration is modified automatically.

- `rock_catalog`: forms, methods, budgets, source limits and fixed acceptance policy; no browser needed.
- `rock_budget_curve`: accepts the same request fields as the JSON example and returns the measurements in `structuredContent`, plus a compact text summary. Pass an exported curve's `source.job` as `source` to reproduce it. This tool returns results rather than writing arbitrary filesystem paths.

The server accepts one comparison at a time and returns a clear busy error for overlapping calls. It sends MCP progress notifications when the caller supplies a progress token, handles request cancellation, and stops active work when the transport closes. Set the host's tool timeout high enough for the requested source detail; SDK clients can use a 10-minute timeout and `resetTimeoutOnProgress`. The request's own `timeoutMs` remains an independent hard deadline.

## Result semantics and validation

Summary results include source identity, normalized settings, requested/actual counts, simplifier error, sampled deviation, CPU estimates, GPU metrics and explicit verdicts. `detail: "full"` adds per-camera observations and failure lists. Only size 128 can receive a pass; 64/256 remain diagnostic. A met triangle budget or a CPU pass cannot override a GPU failure. GPU checks cover geometry only, not texture bake fidelity, collisions or every possible viewing direction.

`npm test` checks validation, replay settings and MCP discovery/schema/cancellation behavior. `npm run test:automation` runs the real CLI and stdio MCP server against a saved UI fixture: requested 600 → actual 592, 90 failed region/view checks in all three interfaces. It also checks quality-gate exit status, full diagnostics, timeout cleanup and cancellation. `npm run build` verifies the shared generator still builds for the studio.
