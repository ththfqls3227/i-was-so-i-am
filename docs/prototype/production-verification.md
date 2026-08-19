# Production Journey Verification

Verified on 2026-08-17 against the authored route:

`crossing -> traceWeight -> handoff -> lastHold`

## Automated gates

- Unit/integration: 147 passed across 5 files.
- Production journey contract: stable manifest, four golden completions, absent-past and absent-present failures, canonical rerecord reset, Trace Weight two-beat gate, and Last Hold farewell invariant.
- Browser E2E: 53 passed across Chromium, Firefox, and WebKit; 10 intentional duplicate/evidence skips; 0 failed.
- Browser journey: separated title/start state, failure-safe local progress, four-room order, physically recorded past plus physically controlled present, live success transitions, ending copy, operational touch hold/release/reset, pause freeze/resume, locale settings, progress write/clear, and zero console/page/request errors.
- First-player tutorial: Crossing now teaches the two-pass rule before Trace Weight; achievement-driven prompts, gold world target, hold-specific copy, semantic checklist, readable 390×844 mobile layout, and a physical novice path all pass automated browser checks.
- Visual verdict: final Babylon humanoid/ancient-facility gameplay capture received an independent 90/100 PASS against the approved direction, with a reproducible 960x640 pixel-diff artifact (normalized delta 0.1220) retained only as secondary evidence.
- Determinism: all 100 replay tapes match Node at every tick in all three browser engines; golden routes match at 30, 60, and 144 Hz.
- Typecheck and lint: passed.
- Production build and `dist` smoke: root and `/game/` subpath passed with CSS, zero runtime raster assets, all four retired PNG names absent, and no production test APIs; latest primary JS is 1,378,698 bytes (333.18 kB gzip).
- License metadata audit: passed for 249 direct/transitive package entries; zero-runtime-raster declaration and four retained concept hashes passed provenance verification.
- Representative performance: with the E2E-only 8 Hz render throttle disabled and Babylon rendering every sampled frame, the WebGL2 180-frame cadence trace passed at 37.963 ms average, 41.7 ms p95, and 75.0 ms maximum while advancing 206 fixed simulation ticks with zero browser errors.

## Commands

```sh
npm test
npm run typecheck
npm run lint
npm run test:e2e
npm run build
npm run test:dist-smoke
npm run test:licenses
npm run test:visual-diff
npm run test:performance # while the local Vite server is running on 4173
```

The ten intentional E2E skips are the Firefox and WebKit copies of five Chromium-only receipts: Crossing keyboard completion, the four-room physical-key journey, the novice tutorial completion, the initial tutorial capture, and the Trace Weight cooperation capture. Cross-engine behavior remains covered by tutorial semantics, renderer readiness, golden paths, full-corpus parity, route/accessibility checks, operational touch/pause tests, and console/page/asset-error gates.
