# Context Snapshot — Rebuild Contest Improvement

- Captured: 2026-08-25T22:53:14Z (2026-08-26 KST)
- Repository: `/Users/sol/Desktop/Projects/echofold`
- Branch: `codex/rebuild-improvement-pass`
- Base branch: `feat/rebuild`
- Base at branch creation: `709abff`
- HEAD at initial baseline: `5b78992` (`The judges' round: 06 and 07 stop coaching the tape-killing move`)
- HEAD after Architect audit: `7285bcf` (`The second-pass plate gets called by its bearing, not by pointing`)
- Concurrency fact: both `codex/rebuild-improvement-pass` and `feat/rebuild` moved while planning was in progress. No plan or receipt may assume the branch ref stays fixed between two commands.

## Task statement

Inspect the actively developed `feat/rebuild` game, preserve the original branch, create a separate Codex branch, design a disciplined improvement workflow, and improve contest readiness without discarding or overwriting the owner's ongoing work.

## Desired outcome

Produce a bounded, evidence-driven improvement program for the current first-person ten-room browser game. The first implementation slice should close the most consequential verified release-confidence gap, then use fresh browser evidence to prioritize player-facing UX fixes rather than speculative rewrites.

## Known facts and evidence

- The production runtime is `index.html -> src/boot.ts -> src/fp-main.ts -> FirstPersonScene/Hud/FpAudioAdapter`; the deterministic simulation lives under `src/sim/` and remains renderer-independent (`src/fp-main.ts:1-15`, `src/sim/simulation.ts:59-180`).
- Campaign order is ten rooms plus the ending corridor (`src/world/roster.ts:24-36`).
- Existing built-bundle Playwright campaign coverage plays rooms 00-03 sequentially (`e2e/fp-campaign.spec.ts:17-125`).
- Finale coverage jumps directly to room 09 and the ending corridor (`e2e/fp-finale.spec.ts:13-166`).
- A standalone browser journey already contains 04-08 drive logic (`scripts/fp-journey.mjs:257+`), but `gate:submission` runs only `validate` and Chromium `test:e2e:dist` (`scripts/submission-gate.mjs:12-25`).
- Cross-engine, performance, and MCP browser checks are explicitly outside the unattended submission gate (`scripts/submission-gate.mjs:27-38`).
- `scripts/performance-smoke.mjs` and `scripts/mcp-browser-smoke.mjs` still target the historical `__I_WAS_SO_I_AM__` API and old selectors/room IDs; they are not valid evidence for the current FP entry until migrated.
- `scripts/fp-cross-engine.mjs` targets the current FP corpus, but currently treats missing browsers as skips and can still print an overall PASS. A release receipt must require three named engine passes.
- Current HEAD includes prompt/honesty fixes for 03, 04, 05, 06, and 07; those semantics are not yet protected by an equivalent middle-campaign built-browser spec (`src/world/chambers.ts:250-254`, `src/world/chambers-04-07.ts:204-221,542-550,645-653`, `src/fp/hud.ts:410-420`).
- Fresh baseline on `7285bcf` is green: immediately before and after the run, `git rev-parse HEAD` returned `7285bcf7747a51ff2cd350358e5e52f11f756aea`; `npm run typecheck`, `npm run lint`, pure-core boundary, and `npm test -- --reporter=dot` all passed; Vitest reported 19 files and 373/373 tests (2026-08-26 08:05 KST).
- The working tree still contains documentation edits and generated/untracked artifacts that predate this planning pass. They must be preserved and kept separate from Codex implementation commits.

## Constraints

- Work only on `codex/rebuild-improvement-pass`; do not mutate `feat/rebuild`.
- Treat both refs as concurrently mutable. The Codex branch does not automatically merge owner commits from `feat/rebuild`: record owner ref movement and compare it at slice boundaries, but keep each Codex slice based on its captured snapshot unless the owner explicitly requests synchronization.
- Preserve current game identity, ten-room structure, deterministic 30 Hz simulation, replay/checksum contracts, Korean memory-archive art direction, and intentional music-off decision.
- Do not redesign the whole game or replace proven mechanics without fresh player/browser evidence.
- Do not delete user captures, generated artifacts, or unrelated dirty documentation.
- Do not touch or reuse the existing `.git/worktrees/playtest-wt`; final verification gets a newly created disposable detached worktree at the frozen candidate SHA.
- Prefer existing helpers and scripts; add no dependency unless explicitly required.
- Every player-facing change must have a concrete browser regression or a documented manual fresh-eyes receipt.

## Unknowns / open questions

- Whether the current HEAD or an earlier frozen candidate will ultimately be submitted.
- Whether rooms 04-08 currently have any browser-only timing, copy, pointer-lock, or renderer regressions not visible to Vitest.
- Which remaining usability issue causes the largest fresh-player failure rate after the latest 03/04/05/06/07 prompt changes.
- Whether the owner wants a later architecture simplification pass; this is intentionally not part of the first slice.

## Likely touchpoints

- `e2e/fp-middle-campaign.spec.ts` (new)
- `e2e/support/fp.ts`
- `scripts/fp-journey.mjs`
- `scripts/performance-smoke.mjs`
- `scripts/mcp-browser-smoke.mjs`
- `scripts/fp-cross-engine.mjs`
- `scripts/e2e-dist.mjs`
- `scripts/submission-gate.mjs`
- `src/fp/hud.ts`
- `src/fp/scene.ts`
- `src/world/chambers-04-07.ts`
- `src/world/chambers-08-09.ts`
- `docs/submission-notes.md`
- `.omx/artifacts/` receipt output

## Evidence boundary

The repository proves deterministic and unit-level correctness at the captured HEAD. It does not yet prove, through the submission-gated built-browser suite, that rooms 04-08 remain playable and honestly instructed. The standalone journey is relevant evidence but is not currently part of the gate that claims release readiness.
