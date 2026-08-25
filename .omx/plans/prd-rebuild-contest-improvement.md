# PRD — Rebuild Contest-Readiness Improvement

Status: DRAFT FOR RALPLAN REVIEW
Branch: `codex/rebuild-improvement-pass`
Context: `.omx/context/rebuild-contest-improvement-20260825T225314Z.md`

## 1. Outcome

Turn the current first-person ten-room campaign into a better-proven contest build without destabilizing its deterministic simulation or replacing the owner's recent UX work. The first delivery closes the verified middle-campaign browser-test gap; subsequent changes are admitted only when browser evidence or fresh-player evidence identifies a concrete failure.

The stop condition is a clean candidate commit on the Codex branch with:

- rooms 00-09 plus the ending corridor proven in the built browser path;
- rooms 04-08 covered by submission-gated Playwright assertions;
- current tutorial/prompt semantics protected where the recent changes landed;
- current commit, build, screenshots, and receipts referring to the same tree;
- no regression in deterministic checksums, 373 existing unit tests, cross-engine browser behavior, or the ending.

## 2. Requirements summary

### Must preserve

- The runtime boundary in which Babylon/HUD consume simulation state and never feed physics back into the deterministic core (`src/sim/simulation.ts:59-180`, `src/fp/scene.ts:2336-2391`).
- Ten rooms plus ending corridor in the authoritative roster (`src/world/roster.ts:24-36`).
- Record -> fold -> replay-with-past-self core loop and final emotional structure.
- Desktop browser delivery, current controls, Korean archive art direction, `잔상` terminology, effects-on/music-off intent.
- Existing owner changes and untracked deliverables; Codex commits must not absorb unrelated documentation or generated output accidentally.

### Must improve

- Built-bundle browser confidence for rooms 04-08, which sit between opening coverage (`e2e/fp-campaign.spec.ts:21-125`) and direct finale coverage (`e2e/fp-finale.spec.ts:15-166`).
- Regression protection for the changed 03/04/06/07 instructions and replay-duty rules (`src/world/chambers.ts:250-254`, `src/world/chambers-04-07.ts:204-221,542-550,645-653`, `src/fp/hud.ts:410-420`).
- Release evidence truthfulness: a gate receipt must identify the exact commit/tree it proves.
- Persistence/Continue coverage around the bookmark logic in `src/fp-main.ts:69-127`.
- Final candidate evidence for Chromium, Firefox, WebKit, WebGL performance, MCP smoke, and the complete campaign.

### Must not do in the first slice

- No simulation redesign, mechanic rebalancing, new rooms, new dependency, art-direction replacement, save-system expansion, mobile support, or broad refactor of the 3,000-line scene adapter.
- No copy rewrite based only on taste. Copy changes require a reproduced incorrect instruction, overlap, or fresh-player failure.

## 3. RALPLAN-DR

### Principles

1. Protect the game the owner is actively shaping; isolate Codex work and never overwrite unrelated dirty state.
2. Prove the judge's real browser path before adding polish.
3. Keep the deterministic simulation authoritative and renderer-independent.
4. Change player-facing behavior only against a reproduced failure and lock the fix with a regression.
5. Freeze one exact commit/artifact/receipt set; never borrow evidence from an older candidate.

### Decision drivers

1. Contest failure impact: a broken or misleading middle room prevents judges reaching the emotional finale.
2. Regression risk: recent work touched branchy HUD/tutorial and multi-stage rooms, while unit tests alone cannot prove rendered/browser interaction.
3. Time-to-confidence: existing browser helpers and journey code make test coverage cheaper and safer than speculative game redesign.

### Viable options

#### Option A — Evidence-first contest hardening (recommended)

Add middle-campaign built-browser coverage, then use its failures and a fresh-eyes run to admit only targeted UX fixes.

- Pros: closes a verified gap; smallest simulation risk; produces reusable release evidence; aligns with the submission deadline.
- Cons: immediate visible game changes may be small; long serial E2E can increase gate time and flake risk.

#### Option B — UX-first polish pass

Immediately revise tutorial copy, lighting, cues, and room flow from 04 onward, then add tests afterward.

- Pros: more visible short-term improvement; directly targets player perception.
- Cons: latest UX changes are still unmeasured; risks conflicting with owner work and introducing new prompt contradictions.

#### Option C — Architecture-first refactor

Split `src/fp/scene.ts` and `src/fp/hud.ts` before further content changes.

- Pros: may improve long-term maintainability.
- Cons: highest regression surface, lowest contest payoff, and no current evidence that file size is causing judge-facing failure.

### Decision

Choose Option A. Option B becomes a controlled second stage driven by recorded browser/fresh-player failures. Option C is deferred until after candidate freeze unless a concrete bug cannot be fixed safely without boundary repair.

## 4. Improvement workflow

### Phase 0 — Preserve and baseline

1. Stay on `codex/rebuild-improvement-pass`; record base `709abff`, `EXPECTED_HEAD`, and the simultaneously observed `feat/rebuild` ref.
2. Recheck the Codex branch against `EXPECTED_HEAD` immediately before every edit, staging operation, commit, and release gate. Refresh `EXPECTED_HEAD` only after a verified self-authored commit. If the Codex ref moved unexpectedly, stop the slice, inspect the new commit and overlapping paths, then replan; never reset, rebase, or force-update it.
3. Track the owner branch independently with `OBSERVED_OWNER_HEAD`. When `feat/rebuild` moves, capture `OLD_OWNER_HEAD` and `NEW_OWNER_HEAD`, inspect `git diff --name-status OLD_OWNER_HEAD..NEW_OWNER_HEAD`, and record overlap with the current slice. Do not automatically merge/cherry-pick owner commits into the Codex branch. Non-overlapping owner work is recorded for later integration; overlapping or scope-invalidating work stops the slice for an explicit integration decision.
4. If a later owner-requested integration is performed, require a clean index, explicit overlap review, a normal merge commit, and conflict escalation. No reset/rebase/force operation is permitted, and `feat/rebuild` is never updated from the Codex lane.
5. Snapshot `git status`, distinguish owner artifacts from Codex-owned files, and never stage with a broad catch-all.
6. Do not touch the existing `.git/worktrees/playtest-wt`; reserve a newly created disposable detached worktree for final candidate proof.
7. Run typecheck, lint/pure-core boundary, and unit tests before behavior changes.

Exit: current tree is identified and baseline evidence is green or failures are documented before any edit.

### Phase 1 — Middle-campaign built-browser confidence

1. Add `e2e/fp-middle-campaign.spec.ts` using existing helpers from `e2e/support/fp.ts` and proven drive logic from `scripts/fp-journey.mjs:257+`.
2. Drive rooms 04 -> 08 serially against the built bundle. Do not use direct success mutation; physical/test API actions must traverse the same runtime state transitions as the shipped build.
3. Assert each room's defining contract:
   - 04: past holds `ground-grip`, present climbs, `gallery-grip` latches `way-out`, and the changed replay cues appear in the correct order.
   - 05: recorded standing opens `way-in`, continuation opens `way-on`, and the room completes.
   - 06: present performs the replay-duty plate action; the HUD never coaches a tape-killing plate recording.
   - 07: same replay-duty honesty, plus delivery/exit completion.
   - 08: recording is disabled, fold/rerecord guidance is absent, two-actor archival cooperation opens the route, and completion advances to 09.
4. Capture `console.error`, `pageerror`, and failed asset requests for the entire serial run.
5. If common drive logic must be shared, extract only the smallest stable helper into `e2e/support/fp.ts`; do not couple Playwright specs to a free-running CLI process.
6. Ensure `test:e2e:dist` discovers the new spec. Keep the submission gate command shape unless the spec is not naturally included.

Exit: the new middle-campaign spec is sensitivity-proven by existing negative mechanic assertions or, if mutation testing is used, only in an isolated disposable checkout; it passes on current behavior and runs as part of `npm run test:e2e:dist`.

### Phase 2 — Judge-path UX evidence and targeted fixes

1. Run the complete 00 -> ending built-browser journey and collect prompt/phase snapshots at the first decision in rooms 03-08.
2. Perform one fresh-eyes playtest without solution coaching. Record room reached, retries, time-to-understand, misleading instruction text, and failure reason.
3. Rank issues:
   - P0: crash, soft lock, impossible room, corrupted Continue, missing input.
   - P1: instruction asks for an invalid/losing action, critical interaction invisible, judge cannot recover.
   - P2: polish/readability that does not block progress.
4. Fix P0/P1 only, one reproduced issue at a time. Add a failing test first when automation can express it; otherwise store a manual reproduction and before/after capture.
5. Re-run the smallest room spec after every fix, then the serial middle-campaign spec.

Exit: no reproduced P0/P1 remains in the judge path; any P2 backlog is written down rather than mixed into the candidate.

### Phase 3 — Continuity and recovery

1. Add browser coverage for the chamber bookmark and Continue path implemented in `src/fp-main.ts:69-127`:
   - advancing writes the current non-ending chamber;
   - reload offers the correct Continue label;
   - Continue restores that chamber and resumes play;
   - corrupt/unknown storage falls back safely;
   - ending corridor is never offered as a cold resume target.
2. Verify `R`, Escape/pointer-lock recovery, and mute state do not leak held input or alter replay checksums.

Exit: an interrupted judge can resume without replaying the opening, and malformed storage cannot block startup.

### Phase 4 — Migrate current-build browser harnesses

1. Update `scripts/performance-smoke.mjs` from the historical `__I_WAS_SO_I_AM__`, `#play-button`, Arrow-key, and `#game canvas` contract to the FP `__I_WAS_SO_I_AM_FP__`, `#start-button`, WASD, and active FP canvas contract.
2. Make performance evidence identify the active chamber, renderer readiness/context, simulation cadence, frame distribution, GL renderer, exact commit SHA, and zero browser/asset errors.
3. Update `scripts/mcp-browser-smoke.mjs` to navigate the FP title, use current accessible names/selectors, exercise a representative current room through real input, inspect at least one middle room and the finale/corridor, and eliminate all historical room IDs/golden imports.
4. Harden `scripts/fp-cross-engine.mjs`: three named browser passes are required for a release PASS. Missing browsers produce INCOMPLETE/nonzero, not a successful aggregate.
5. Make both migrated harnesses own the build/server lifecycle via `scripts/support/serve.mjs:startGameServer()` or an equivalent candidate-owned helper. Use its returned dynamic URL, always tear the server down in `finally`, and record `git rev-parse HEAD`. Release-receipt mode must reject/ignore `GAME_URL`; an externally supplied server is allowed only for local iteration and cannot produce a release PASS.
6. Keep current `src/sim` corpus evidence distinct from historical `src/core` cadence evidence in output and documentation.

Exit: all three scripts target the production FP entry and fail closed when their claimed browser evidence is absent.

### Phase 5 — Candidate freeze and receipts

1. Freeze `CANDIDATE_SHA`, create a new detached clean temporary worktree at that SHA, and run release verification there. The active dirty worktree remains untouched.
2. Run targeted gates, then `npm run gate:submission` inside the detached candidate worktree.
3. Run `npm run test:fp-cross-engine`, migrated performance/MCP smoke, and `test:e2e:dist:all` in the same detached tree.
4. Run `npm run test:fp-journey` against its self-owned built bundle; repeat once if the first run shows timing variance.
5. Record commit SHA, tree cleanliness, command, exit status, all three named engines, artifact path, and timestamp in a candidate receipt.
6. Refresh submission notes only after the exact candidate passes; never promote earlier hashes or receipts.
7. Remove only the temporary worktree created by this workflow after receipts are copied to an explicitly tracked artifact location.

Exit: one exact commit is demonstrably playable without login from title through ending and all automated gates are green, or the remaining human/public-URL gate is explicitly marked as external.

## 5. Acceptance criteria

1. `git branch --show-current` returns `codex/rebuild-improvement-pass`; `feat/rebuild` remains at its original ref unless the owner changes it separately.
2. Existing `npm run typecheck`, `npm run lint`, pure-core boundary, and all 373 current Vitest tests remain green.
3. A checked-in Playwright spec covers rooms 04, 05, 06, 07, and 08 sequentially against `dist-e2e`.
4. The middle-campaign spec asserts at least one mechanic invariant and one instruction/honesty invariant per changed room, not merely `phase === success`.
5. The room-04 test proves both distinct grips and the vertical transition; it cannot pass by direct chamber-success mutation.
6. Rooms 06 and 07 never instruct the recording pass to stand on a replay-duty plate.
7. Room 08 exposes no recording/fold/rerecord action and still completes through its authored cooperative rule.
8. The serial browser run records zero `console.error`, zero `pageerror`, and zero unexpected asset request failures.
9. Continue persistence is covered for valid, corrupt, and ending-corridor storage cases.
10. The visible `#continue-button` path, not only direct test APIs, proves valid resume; corrupt and ending-corridor values safely fall back.
11. Pointer-lock fallback copy does not overlap an active archivist subtitle and appears afterward when still needed.
12. Rerecord clears transient copy and returns to a clean recording state; Escape/pointer-lock recovery clears held input before resuming.
13. Historical `src/core` cadence tests and current `src/sim` corpus tests remain green without conflating their evidence.
14. `npm run test:fp-cross-engine` reports explicit PASS for Chromium, Firefox, and WebKit; missing engines make the candidate incomplete.
15. `npm run gate:submission`, `npm run test:e2e:dist:all`, `npm run test:fp-journey`, migrated `npm run test:performance`, and migrated `npm run test:mcp` pass in a detached clean worktree at the same candidate SHA.
16. Final receipts name the exact commit SHA and do not cite `6fd0c48`, `6272d87`, or any other older candidate as proof for the new tree.
17. No unrelated user documentation, captures, or generated artifacts are deleted or silently included in Codex implementation commits.
18. The 04-08 serial spec has an explicit long-test budget of at least 300 seconds and uses monotonic state waits rather than fixed-duration movement guesses.

## 6. Risks and mitigations

- Serial E2E becomes slow/flaky. Mitigation: wait on monotonic simulation facts, keep generous room-level timeouts, avoid fixed sleeps except authored dramatic timing, and reuse the hardened helpers in `e2e/support/fp.ts`.
- Test API proves a path the player cannot perform. Mitigation: use key press/release and look actions that enter the shipped input adapter; ban direct state/success mutation in journey specs.
- New prompt assertions overfit exact prose. Mitigation: assert the action/duty concept and critical token where possible; exact-copy assertions only for known misleading regressions.
- Owner work and Codex work mix. Mitigation: record the pre-existing status, stage explicit paths only, keep one concern per commit, and never reset shared changes.
- Deadline pressure encourages unbounded polish. Mitigation: P0/P1 admission gate and explicit P2 deferral after the complete journey is green.
- Cross-engine GPU differences create false failures. Mitigation: assert renderer readiness, interaction state, errors, and semantic UI; do not require pixel equality across engines.

## 7. Verification sequence

1. Targeted changed-room Vitest files and new browser spec.
2. `npm run typecheck`
3. `npm run lint`
4. `npm test -- --reporter=dot`
5. `npm run build:e2e`
6. targeted built-bundle Playwright spec
7. `npm run test:e2e:dist`
8. `npm run gate:submission`
9. `npm run test:fp-cross-engine` with three named PASS results
10. `npm run test:e2e:dist:all`
11. `npm run test:fp-journey`
12. migrated candidate-owned `npm run test:performance`
13. migrated candidate-owned `npm run test:mcp`
14. human fresh-eyes/public-URL gates
15. `git diff --check`, exact `git rev-parse HEAD`, and clean `git status` inside the detached candidate worktree

## 8. ADR

### Decision

Use an evidence-first improvement sequence: middle-campaign built-browser coverage first, then targeted UX fixes, continuity coverage, and an exact-commit candidate freeze.

### Drivers

- A middle-room failure blocks the emotional payoff.
- Recent HUD/content changes outpace built-browser coverage.
- The core is already deterministic and well tested; contest value now comes from proving and refining the playable path.

### Alternatives considered

- UX-first polish without new browser evidence.
- Architecture-first split/refactor of the scene and HUD.
- Freeze the current build without further changes.

### Why chosen

It produces the highest confidence gain with the smallest gameplay risk and uses existing helpers/journey logic rather than creating a parallel test system.

### Consequences

- The first commit may be mostly tests and receipts.
- Submission gate duration increases.
- Later visible polish is smaller but better justified.
- Large scene/HUD refactoring remains technical debt after freeze.

### Follow-ups

- Revisit scene/HUD modularization after submission with behavior locked by the expanded browser suite.
- Decide whether manual cross-engine/performance/MCP checks should become fully owned by `gate:submission` after stabilizing their server lifecycle.

## 9. Execution staffing guidance

Available relevant roles: `explore`, `executor`, `test-engineer`, `designer`, `debugger`, `verifier`, `code-reviewer`, `architect`, `critic`, `git-master`.

- Default durable execution: `$ultragoal` owns the checkpoint ledger and exact candidate evidence.
- Parallel path when authorized: Phase 1 remains sequential. Start one `test-engineer` lane for 04-08 evidence first. Only after it reproduces a P0/P1 may an `executor`/`designer` lane receive that bounded fix. A `verifier` may independently inspect evidence but stays read-only until a candidate exists. Shared files must be assigned explicitly; the verifier must not author the changes it approves.
- Suggested reasoning: test-engineer medium, executor medium, designer high, verifier high, code-reviewer high.
- Ralph fallback: use `$ralph` only if the owner explicitly chooses a single persistent implementation/fix loop after this plan is authorized.

### Team launch hints (future receipt-authorized execution only)

```text
$ultragoal .omx/plans/prd-rebuild-contest-improvement.md
$team 3 implement .omx/plans/prd-rebuild-contest-improvement.md using .omx/plans/test-spec-rebuild-contest-improvement.md
```

Team proves targeted room behavior, migrated FP harness behavior, full built-browser coverage, and independent verification before shutdown. Ultragoal checkpoints the exact commit, detached-worktree receipt set, unresolved human gates, and candidate status. `$autoresearch-goal` is not appropriate because this is implementation/readiness work; `$performance-goal` is appropriate only if the migrated performance receipt exposes a measurable regression.

## 10. Planning handoff state

Planning artifacts:

- `.omx/plans/prd-rebuild-contest-improvement.md`
- `.omx/plans/test-spec-rebuild-contest-improvement.md`

Ralplan lifecycle evidence and final consensus state will be appended after the sequential Architect and Critic reviews.

## Changelog

- 2026-08-26: Initial evidence-first draft created from current HEAD and repository discovery.
- 2026-08-26: Architect iteration applied: added concurrent-HEAD guards, detached candidate verification, FP harness migration, strict cross-engine evidence, complete acceptance mapping, and sequential evidence-first staffing.
- 2026-08-26: Critic iteration applied: fixed candidate-owned server proof, made owner-branch drift record-only by default, added room-05 instruction assertions, and named the complete journey command.
