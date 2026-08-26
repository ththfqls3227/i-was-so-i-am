# I WAS, SO I AM

A browser-native, cinematic first-person single-player self-cooperation puzzle game. Record one past performance, end the recording, then work beside that input-driven afterimage in the same live world.

The current contest journey is ten rooms plus an ending corridor: `Awakening → Second Self → The Hand That Holds → Hand, Not Body → Two People's Worth → The One Who Stood a Long Time → The Hand That Gives Back → The Stacks Nobody Keeps → Silence → The Last Hold → The Long Gallery`. Each room adds or reinterprets one part of the same record-then-cooperate rule, ending in a farewell to the self who stayed behind. A chamber select on the title screen unlocks cleared rooms and the next room. `ECHOFOLD` was the planning codename; the public-facing title is `I WAS, SO I AM`.

## Play locally

```bash
npm install
npm run dev
```

Use WASD to move, the mouse to look, `Space` or `E` to act, `Enter` to end a recording, `R` to rerecord, `Esc` to pause, and `M` to mute. The current first-person campaign is desktop-only; touch-only devices receive an explanatory card instead of a broken game.

The presentation uses Babylon.js as a render-only adapter over the deterministic core. The Korean memory archive, wooden stacks, lattice-window light, paper doors, brass mechanisms, current self, and cyan afterimage are live 3D meshes with procedural materials and state-driven transforms. The renderer never feeds physics or positions back into the simulation.

## Validate

```bash
npm run validate
npm run test:e2e
npm run test:e2e:dist
npm run test:visual-diff
npm run gate:submission
```

The first command proves the pure-core, replay corpus, level, concept-art provenance, package-license, build, and served-`dist` gates, including the absence of retired flattened PNG art. The second compares the same 100 tapes at every tick in Chromium, Firefox, and WebKit, verifies the complete room-by-room journey and ending, and exercises real keyboard, touch, pause, resume, storage, and reset paths against the dev server. The third runs that same suite against a real build instead: the bundle that keeps the test API is built into `dist-e2e/` and served with `vite preview`, so the shipped `dist/` is never the tested one and never learns the test API — `npm run test:e2e:dist:all` widens it to all three engines. The fourth records a non-gating reference comparison alongside the independent 90/100 visual verdict. The last chains the first and third and then prints the gates that still need a hand-started server.

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

The MCP smoke connects through the protocol, discovers the server tools, records and replays both selves through every room using keyboard input, inspects the title, rooms, and ending through accessibility snapshots, checks golden paths at 30/144 Hz, verifies zero console errors, and stores a screenshot under the ignored `.playwright-mcp/` directory. The performance smoke disables the E2E-only 8 Hz render throttle for that run and records a 180-frame WebGL2 cadence trace while Babylon renders every frame; its JSON receipt is under `.omx/artifacts/visual-ralph/humanoid-redesign/`. See [the MCP verification record](docs/prototype/mcp-verification.md) and [concept-art provenance](docs/prototype/asset-provenance.md).
