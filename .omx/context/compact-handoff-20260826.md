# Compact Handoff — I WAS, SO I AM — 2026-08-26

## Resume here

- CWD: `/Users/sol/Desktop/Projects/echofold`
- Branch: `feat/rebuild`
- HEAD before documentation edits: `6fd0c48` (`04's two doors become real, and the room says what the grab did`)
- Current product: desktop browser first-person single-player self-cooperation puzzle, 10 rooms + ending corridor.
- Public title: `I WAS, SO I AM`; old planning codename: `ECHOFOLD`.
- Current entry: `index.html` → `src/boot.ts` → `src/fp-main.ts`.
- Historical Codex 4-room build: `legacy.html` → `src/main.ts`.

## Canonical product idea

Record the first run, end it with Enter, then cooperate with the cyan afterimage replaying that exact input. The player must plan what the future self will need. Portal-like staged puzzles lead to a farewell: the past self holds the last door so the present self can leave. Message: “Because the past me existed, I am here now.” Desired ending feelings: achievement, relief, wistfulness, gratitude, desire to continue.

Campaign order in `src/world/roster.ts`: Awakening, Second Self, Holding Hand, Hand Not Body, Two of Us, Long Standing, Giving Back, Unkept, Silence, Last Hold, ending corridor. Master design: `docs/story-campaign.md`.

Visual identity: Korean memory archive inspired by Janggyeonggak — dark wood stacks, memory blocks, lattice-window light, hanji doors/signs, brass, cyan afterimage, amber present, red seal. Art source: `docs/art-janggyeonggak.md`. Music is intentionally disabled; SFX remain.

## What the user decided

- Browser game, single-player but impossible alone.
- First play leaves a past self; second play cooperates with it in real time.
- Future-planning brain puzzle, staged like Portal.
- Human-shaped character and real game-like environment, not abstract geometry or pasted illustration.
- Emotional self-discovery journey and wistful goodbye to the past self.
- Final title/direction, FP rebuild, Korean archive identity, `잔상` terminology, music-off submission direction.

## What Codex directly did

- Deep interview and precedent research for 2D time-loop/recorded-self puzzles.
- Initial PRD/test spec and browser Trace+Weight prototype.
- Deterministic 30Hz core, bitmask input, tape replay, FNV checksums, 100-tape corpus, 30/60/144Hz parity.
- Four-room vertical slice and Babylon.js migration.
- imagegen concept art with provenance hashes.
- Playwright MCP configuration and real keyboard self-play through the four rooms; accessibility, console-zero, cross-engine, performance checks.
- Documentation/receipts and preserved `legacy.html` build.

Honesty boundary: the current FP 10-room campaign was later rebuilt with Claude-based multi-agent collaboration. It inherits Codex architecture/testing; do not claim Codex wrote the entire current campaign. Submission copy: `docs/codex-collaboration.md`.

## Current architecture

- `src/sim/`: deterministic FP sim and tape/checksum rules.
- `src/world/`: current chambers/registry/ending.
- `src/fp/`: Babylon render/input/HUD/tutorial/presentation.
- `src/audio/`: effects and mute/music state.
- `src/core/`, `src/main.ts`: historical Codex prototype.
- `tests/`, `e2e/`, `scripts/`: unit, replay, browser, deployment, journey, capture gates.

## Latest fresh evidence

Run on 2026-08-26 at HEAD `6fd0c48` before these documentation-only edits:

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- pure-core boundary (`src/core`, `src/sim`): PASS
- `npm test -- --reporter=dot`: 19 test files, 373/373 PASS

Full submission freeze evidence applies to older candidate `6272d87`, which passed lint/unit/build/dist-smoke/e2e-dist/10-room journey twice. HEAD `6fd0c48` includes later room-04 changes and is not a new frozen candidate until full gates rerun.

## Curated deliverables

- Index: `docs/deliverables-index.md`
- Handoff: `docs/project-handoff-2026-08-26.md`
- Submission notes/copy: `docs/submission-notes.md`
- Codex explanation: `docs/codex-collaboration.md`
- Primary thumbnail: `captures/submission/thumb-1-last-window.png` (3200×1800, emotional/dark)
- Alternate: `captures/submission/07-echo-face.png` (3200×1800, clearer gameplay; recapture without FPS if selected)
- Current OG: `public/og-image.jpg` (candidate 1 crop/downsize)
- Stills: `captures/submission/01-title.png` through `10-success.png`
- Demo: `captures/submission/video/demo-draft.mp4` (2:20, silent)
- Codex prototype visuals: `.omx/artifacts/visual-ralph/humanoid-redesign/`

## Open gates, in order

1. Decide whether frozen `6272d87` remains candidate or current `6fd0c48` supersedes it.
2. If current HEAD is candidate, run `npm run gate:submission` plus final dist/browser journey and record receipts.
3. Choose thumbnail. Candidate 1 is currently wired; candidate 2 needs FPS-free recapture.
4. Decide demo spoiler scope and whether silent video is acceptable.
5. Deploy public + backup URLs; verify no-login full playthrough on deployed build.
6. Owner full play with SFX and at least one fresh-eye playtest.
7. Fill contest form using `docs/submission-notes.md` and `docs/codex-collaboration.md`.

## Do not redo / do not confuse

- Do not restart from the old Trace+Weight/4-room plan; it is historical and lives at `legacy.html`.
- Do not describe current game as 2.5D or 7 rooms; it is first-person, 10 rooms + ending.
- Do not delete user captures or generated evidence without explicit scope.
- Do not claim full current-HEAD submission verification from the 373 unit tests alone.
- Do not claim Codex authored the full FP rebuild.
- Do not silently replace thumbnail/meta copy without the owner choosing the variant.

## Best next action after compact

Inspect `git diff -- docs README.md .omx/context/compact-handoff-20260826.md`, then choose/freeze the candidate. If HEAD `6fd0c48` is kept, run `npm run gate:submission`; fix only P0/P1 failures, then deploy and perform a real no-login browser playthrough.
