# I WAS, SO I AM

A browser-native, cinematic 2.5D single-player self-cooperation puzzle game. Record one past performance, reset the chamber, then work beside that input-driven echo in the live shared world.

The protected four-room contest journey is playable from title to ending: `Crossing → Trace Weight → Handoff → Last Hold`. Crossing is the dedicated one-mechanic tutorial; later rooms build on the same record-then-cooperate rule. `ECHOFOLD` was the planning codename; the public-facing title is `I WAS, SO I AM`.

## Play locally

```bash
npm install
npm run dev
```

Use the arrow keys or WASD to move, `Space` or `E` to act, and `R` to rerecord. Recording waits for the player's first meaningful input. Touch controls appear on coarse-pointer and narrow screens.

The presentation uses Babylon.js as a render-only adapter over the deterministic core. The ancient vault, chasm, bridge, winch, movable weight, nested exit, articulated human, and cyan echo are live 3D meshes with procedural materials and state-driven transforms. No background plate or character/prop sprite is loaded or shipped, and the renderer never feeds physics or positions back into the simulation.

## Validate

```bash
npm run validate
npm run test:e2e
npm run test:e2e:dist
npm run test:visual-diff
npm run gate:submission
```

The first command proves the pure-core, replay corpus, level, concept-art provenance, package-license, build, and served-`dist` gates, including the absence of retired flattened PNG art. The second compares the same 100 tapes at every tick in Chromium, Firefox, and WebKit, verifies the complete four-room journey and ending, and exercises real keyboard, touch, pause, resume, storage, and reset paths against the dev server. The third runs that same suite against a real build instead: the bundle that keeps the test API is built into `dist-e2e/` and served with `vite preview`, so the shipped `dist/` is never the tested one and never learns the test API — `npm run test:e2e:dist:all` widens it to all three engines. The fourth records a non-gating reference comparison alongside the independent 90/100 visual verdict. The last chains the first and third and then prints the gates that still need a hand-started server.

See [the production gate report](docs/prototype/gate-report.md) for the exact evidence and remaining human gates.

## Playwright MCP inspection

This trusted repository contains a project-scoped Playwright MCP server in `.codex/config.toml`. Its repository-relative launcher resolves the installed Playwright Chromium unless `PLAYWRIGHT_MCP_EXECUTABLE_PATH` is supplied, uses the pinned local package and an isolated headless profile, and permits browser requests only to the local Vite origins on port 4173.

After `npm install`, restart Codex or open a new Codex conversation from this repository so MCP tools are reloaded. `codex mcp list` should show `playwright` as enabled.

For the reproducible MCP smoke, run these in separate terminals:

```bash
npm run dev -- --host 127.0.0.1 --port 4173
npm run test:mcp
npm run test:performance
```

The MCP smoke connects through the protocol, discovers the server tools, records and replays both selves through all four rooms using keyboard input, inspects the title, rooms, and ending through accessibility snapshots, checks golden paths at 30/144 Hz, verifies zero console errors, and stores a screenshot under the ignored `.playwright-mcp/` directory. The performance smoke disables the E2E-only 8 Hz render throttle for that run and records a 180-frame WebGL2 cadence trace while Babylon renders every frame; its JSON receipt is under `.omx/artifacts/visual-ralph/humanoid-redesign/`. See [the MCP verification record](docs/prototype/mcp-verification.md) and [concept-art provenance](docs/prototype/asset-provenance.md).
