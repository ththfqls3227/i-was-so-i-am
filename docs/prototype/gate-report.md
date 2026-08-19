# Four-Room Production Gate Report

Date: 2026-08-17 KST  
Scope: browser-playable title-to-ending route `Crossing -> TraceWeight -> Handoff -> LastHold`

## Toolchain lock

- Node.js `24.13.0`; npm `11.6.2`; pinned `package-lock.json` present.
- Babylon.js `9.21.1`; Vite `8.2.1`; TypeScript `5.9.3`; Vitest `4.1.10`; Playwright `1.62.1`.
- Automated browser binaries: Chromium `151.0.7922.34`, Firefox `153.0`, WebKit `26.5`.
- Static build has no remote asset, login, analytics, backend, or runtime API dependency.
- All 249 installed direct/transitive package entries expose license metadata: MIT 191, Apache-2.0 22, BSD-2-Clause 7, BSD-3-Clause 4, ISC 12, MPL-2.0 12, BlueOak-1.0.0 1.

## Automated verdict

| Gate | Result | Evidence |
| --- | --- | --- |
| Strict typecheck and lint | PASS | `npm run typecheck`, ESLint, forbidden pure-core dependency scan |
| Unit/level behavior | PASS | 147 tests; four-room route, cooperative golden paths, target lock/facing, single-actor impossibility, two-beat Trace Weight, Handoff redirect, and actor-specific Last Hold invariants |
| Canonical reset / one echo | PASS | full-duration transition restores canonical objects and creates exactly `past + present` |
| Invalid tape recovery | PASS | bad checksum returns to playable recording instead of trusting or crashing |
| Pure replay corpus | PASS | 100 seeded tapes; per-tick checksums identical under 30/60/144 Hz render scheduling |
| Browser replay corpus | PASS | the same 100 tapes match pure Node at every tick in Chromium, Firefox, and WebKit |
| Golden browser paths | PASS | All four rooms complete at 30/60/144 Hz in Chromium, Firefox, and WebKit; title-to-ending route succeeds |
| First-player tutorial | PASS | Crossing is first; title teaches the two passes; prompts advance on achievements; gold world marker, explicit long-hold language, checklist, mobile copy, and a physical novice completion are browser-verified |
| Real input adapters | PASS | Chromium keyboard Crossing plus full four-room journey; screen direction regression; pointer-held touch movement/release/reset and pause freeze/resume pass across all three engines |
| Production build | PASS | Vite static build; granular Babylon imports produce a 1,378,698-byte primary JS bundle (333.18 kB gzip); root and `/game/` subpath smoke load the procedural 3D game with no runtime raster art; all four retired PNG names return 404 and test-only APIs are absent from production |
| Dependency audit | PASS | `npm audit`: 0 info/low/moderate/high/critical vulnerabilities; lockfile license metadata complete |
| Concept-art provenance | PASS | Zero runtime raster assets; four retained concept references match recorded SHA-256 digests and are excluded from `public/` and `dist`; see `assets-manifest.json` |
| Playwright MCP | PASS | 24 tools discovered; title/four-room/ending accessibility snapshots; live Crossing keyboard completion; past and present physically driven through the full journey; 30/144 Hz golden paths; zero console errors |
| Representative render trace | PASS | E2E-only 8 Hz throttle disabled; Babylon renders every sampled frame: WebGL2, 180 frames, 206 simulation ticks, 37.963 ms average, 41.7 ms p95, 75.0 ms maximum, zero console/page/request errors at 1352×760 |
| Visual vertical slice | PASS | The approved thumbnail direction is realized as live procedural 3D at an independent 90/100 visual verdict; reference, final capture, and a non-gating 0.1220 normalized pixel-diff record are retained under `.omx/artifacts/visual-ralph/humanoid-redesign/` |

## Mechanic proof

- Trace Weight: the recorded past holds the winch so the present crosses and latches the bridge; the past then joins at the weight, which moves only with two aligned contributions.
- Crossing: the past sustains the bridge while the present traverses the route.
- Handoff: the past carries and stages the memory core at the junction; only the present can receive and deliver it.
- Last Hold: success freezes while the past remains credited behind the threshold and the present exits alone.
- The tape stores input bitmasks, versions, duration, and checksum—not positions, rendered animation, or object mutations.

## Open gates that automation cannot claim

The complete automated route is machine-green but not contest-release green until the planned fresh-player cohorts validate comprehension, execution ease, pacing, and the intended wistful/self-accepting ending.

Real Safari/iOS/Android physical-input journeys, public primary/backup hosting, original audio polish, fresh-player evidence, and the immutable release/submission package remain open.

The MCP invocation details and reproducible command are recorded in [mcp-verification.md](mcp-verification.md). Generated-art lineage and its bounded rights caveat are recorded in [asset-provenance.md](asset-provenance.md).
