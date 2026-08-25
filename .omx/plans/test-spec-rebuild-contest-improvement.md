# Test Specification — Rebuild Contest Improvement

Companion PRD: `.omx/plans/prd-rebuild-contest-improvement.md`

## A. Baseline invariants

1. TypeScript compiles with no errors.
2. ESLint and the pure-core browser/import boundary pass.
3. All existing Vitest tests pass without snapshot/checksum updates unless a deliberately approved simulation change explains them.
4. `src/sim/corpus-checksums.json` remains unchanged in the first execution slice.

## B. Middle-campaign built-browser suite

Create `e2e/fp-middle-campaign.spec.ts` and run it against the built bundle.

### B1. Harness contract

- Start from the title through `startGame(page)`.
- Switch to room 04 only once at setup or advance from 03; then use real `advanceChamber()` transitions through 08.
- Drive input through existing press/release/look/fold helpers; no direct state mutation.
- Collect `console.error`, `pageerror`, and unexpected `requestfailed` before navigation.
- After every transition, wait for the expected chamber ID and renderer readiness.
- Set an explicit serial-test timeout of at least 300 seconds.

### B2. Room 04 — Two People's Worth

- Recording pass reaches and holds `ground-grip`.
- `upper-door` opens from that hold.
- After fold, the past actor is credited for `ground-grip`.
- Present reaches the upper deck without teleport/success mutation.
- HUD/replay cue instructs stairs/climb first, then the gallery grip; it never references a removed/incorrect route.
- Present activates `gallery-grip`; `way-out` latches.
- Room reaches success and advances to 05.

### B3. Room 05 — Long Standing

- Recording guidance appears in authored order: move to the first/left plate, remain long enough to record standing duration, move to the second/right plate, then end the recording (`src/world/chambers-04-07.ts:407-417`).
- Replay guidance appears in authored order: enter while the first hold opens the near door, then wait inside for the continuation opened by the second recorded stand (`src/world/chambers-04-07.ts:418-422`).
- The recorded position/time opens `way-in` during replay.
- Present gets inside while that condition holds.
- The authored continuation opens `way-on`.
- Room reaches success and advances to 06.

### B4. Room 06 — Giving Back

- Recording-phase tutorial does not instruct the player to perform the replay-duty plate action.
- After fold, present is instructed to take the plate duty.
- The correct actor/mechanism relationship opens the route.
- Room reaches success and advances to 07.

### B5. Room 07 — Unkept

- Same duty-honesty invariant as 06.
- Transfer/delivery mechanism changes state in the authored order.
- Room reaches success and advances to 08.

### B6. Room 08 — Silence

- `recordingEnabled`/equivalent view contract is false.
- Fold and rerecord controls/prompts are absent or disabled.
- Both authored actors/plates are required; removing either contribution does not open the route in the core test layer.
- The browser journey completes and advances to 09.

### B7. Error gate

- Zero page errors.
- Zero console errors.
- Zero unexpected asset request failures.
- Exactly one visible game canvas with non-zero bounds while each room is active.

## C. Tutorial/prompt regression tests

- Protect the latest 03 wording: it identifies the right plate as the second-pass player's duty.
- Protect 04 prompt order: ground hold -> stairs -> gallery grip -> exit.
- Protect 06/07 `plateDutyInReplay` semantics in both unit and browser presentation.
- Suppress pointer-lock fallback copy while the archivist subtitle is visibly active; show it after the subtitle yields if drag-look remains unlearned.
- Prefer semantic fragments/action roles to full sentence equality unless exact wording was the bug.

## D. Persistence and recovery

1. Advancing to a non-first room writes `i-was-so-i-am:chamber:v1`.
2. Reload displays `이어하기 — {number} {name}` for a valid saved non-ending room.
3. Continue switches to the saved chamber and starts/resumes the scene.
4. Unknown IDs are ignored without console/page errors.
5. The ending corridor is not offered as a cold Continue target.
6. Rerecord clears transient failure copy and returns to tick zero/recording where supported.
7. Escape/pointer-lock recovery clears held movement/action input before resuming.

The valid-resume case must click the visible `#continue-button`; direct `switchChamber` alone is insufficient evidence for the HUD/storage integration.

## E. Determinism and cross-engine

- Historical `src/core` replay cadence and current FP `src/sim` corpus are reported separately.
- The current FP built bundle returns the committed `src/sim` corpus checksums in Chromium, Firefox, and WebKit.
- `scripts/fp-cross-engine.mjs` must exit nonzero/incomplete if any of the three engines is unavailable; an aggregate PASS requires three named engine PASS results.
- Renderer readiness is semantic (`renderer.ready`, WebGL1/2), not pixel equality.
- No renderer or HUD change writes into simulation state.

## F. Performance and protocol smoke

- Before these commands count as FP evidence, `scripts/performance-smoke.mjs` must use `__I_WAS_SO_I_AM_FP__`, `#start-button`, current FP movement, and the active FP canvas instead of the historical API/selectors.
- Migrated `npm run test:performance` passes its frame/cadence thresholds and records the exact candidate SHA plus FP chamber/renderer data.
- Before this command counts as FP evidence, `scripts/mcp-browser-smoke.mjs` must remove historical API names, room IDs, and `/src/content/golden.ts` imports.
- Migrated `npm run test:mcp` reaches the FP title, a representative middle room, and finale/corridor accessibility snapshots with zero errors.
- Both harnesses start their own candidate build/server through `startGameServer()` or equivalent, consume the returned dynamic URL, tear it down in `finally`, and record the current SHA.
- Release-receipt mode rejects an externally supplied `GAME_URL`; such a URL is local-iteration evidence only.
- Any failure is fixed only if reproducible on the candidate commit; environment-only gaps are recorded explicitly.

## G. Candidate receipt

The final receipt must be produced from a newly created detached clean worktree at the frozen candidate SHA and record:

- branch and exact commit SHA;
- whether the working tree contains known non-candidate artifacts;
- Node/npm/browser versions;
- every gate command and exit status;
- artifact/screenshot paths;
- public URL and no-login verification status;
- human fresh-eyes result;
- unresolved P2 issues, if any.

No receipt from an older hash may be cited as proof for the new candidate.
