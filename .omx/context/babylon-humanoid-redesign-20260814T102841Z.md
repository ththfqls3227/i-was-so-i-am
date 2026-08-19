# Ralph Context — Babylon Humanoid Redesign

## Task statement

Replace the abstract Phaser prototype presentation with a game-like, browser-native 3D presentation approved by the user. Use the approved concept image at `.omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png` as the visual source of truth.

## Desired outcome

- A playable title-to-ending browser game that preserves the deterministic past-self replay puzzle core.
- Babylon.js 3D rendering instead of abstract Phaser Canvas primitives.
- Readable full-body present and past-self humanoids with distinct material, silhouette, trails, and procedural movement/action animation.
- Functional-looking time well, winch, bridge, stone weight, handoff device, doors, platforms, rails, lighting, and camera composition.
- First-room onboarding that reveals the plan in small contextual steps and makes the initial action obvious without prior knowledge.
- Screenshot match against the approved reference with a Visual Ralph score of at least 90, plus recorded secondary diff evidence.
- Existing deterministic, replay, level, browser, accessibility, and journey gates remain green.

## Known facts / evidence

- Approved reference: `.omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png`.
- Current stack: TypeScript, Vite, Phaser 3.90, deterministic pure-core simulation, Playwright and MCP browser checks.
- Current protected route: `traceWeight -> crossing -> handoff -> lastHold`.
- Current pre-migration evidence: 147 unit tests, 100 replay cases, 6 level gates, 32 E2E passes with 4 intentional skips, MCP complete journey, zero console errors.
- The user explicitly approved the new visual direction and accepted the recommendation to use Babylon.js rather than Unreal Engine.
- Browser-immediate play and no-login access remain contest constraints.

## Constraints

- Preserve the pure deterministic simulation, tape format, chamber IDs, route, and ending semantics.
- Do not add Unreal, a backend, login, remote runtime assets, or a server dependency.
- Keep the build deployable as static browser files.
- Keep controls: arrows/WASD, Space/E, R, Esc, and touch controls.
- Avoid unlicensed external character or environment assets; procedural geometry/materials are acceptable.
- Do not claim photorealism; target a polished stylized 3D vertical slice with the same composition and emotional language as the reference.
- Implementation is incomplete until architect approval, mandatory changed-file deslop, and post-deslop verification pass.

## Unknowns / risks

- Babylon bundle size and cross-browser WebGL behavior may require selective imports and performance tuning.
- A procedurally built humanoid must remain readable at the gameplay camera distance.
- Existing browser test hooks depend on the current scene API and must be preserved or compatibly adapted.
- Visual scoring may need multiple lighting, camera, material, and UI iterations.

## Likely codebase touchpoints

- `package.json`, `package-lock.json`
- `src/main.ts`, `src/style.css`
- `src/game/EchofoldScene.ts` or a Babylon replacement under `src/game/`
- `src/core/*` only if a renderer-neutral adapter gap is found
- `src/content/chambers.ts`, `src/content/manifests.ts`
- `e2e/*`, `scripts/mcp-browser-smoke.mjs`, `playwright.config.ts`
- `README.md`, `docs/prototype/*`
- `.omx/artifacts/visual-ralph/humanoid-redesign/*`

## Stop condition

Stop only after the approved direction is implemented, the first room is materially more understandable, the Visual Ralph verdict is at least 90, all relevant automated gates pass, an architect approves, the changed-file deslop pass is complete, and post-deslop regressions are green.
