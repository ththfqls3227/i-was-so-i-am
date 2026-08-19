# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-17
- Primary product surfaces: browser title screen, four-room puzzle journey, contextual tutorial, pause/settings, farewell ending
- Evidence reviewed: `README.md`, `.omx/context/expand-four-room-game-20260813T132556Z.md`, `.omx/context/babylon-humanoid-redesign-20260814T102841Z.md`, `src/main.ts`, `src/style.css`, `src/content/*`, `src/game/MemoryScene.ts`, `e2e/*`, and the approved Visual Ralph artifacts

## Brand
- Personality: solemn, humane, wistful, quietly hopeful
- Trust signals: controls behave literally, every prompt describes the next possible action, mechanisms visibly respond, failure always explains recovery
- Avoid: abstract developer terminology, hidden timing requirements, passive tutorial waits, neon arcade clutter, solution dumps, and instructions that contradict the visible world

## Product goals
- Goals: teach a two-pass self-cooperation loop without prior genre knowledge; make every room readable from the live 3D scene; end with gratitude toward the past self
- Non-goals: reflex-heavy action, precision platforming, multiple echoes, physics simulation, login, or long exposition
- Success signals: a first-time player can explain “first I record, then I cooperate” before moving; completes the tutorial room without external help; knows `R` is safe recovery

## Personas and jobs
- Primary personas: browser players with no time-loop puzzle experience; keyboard and touch players; Korean-first contest judges
- User jobs: understand the loop, identify the current target, perform one clear action, recover from a failed recording, and feel the past self become a visible partner
- Key contexts of use: immediate no-login judging, desktop keyboard, mobile/touch, muted playback

## Information architecture
- Primary navigation: title → tutorial room → three escalating rooms → ending → title
- Core routes/screens: title, Crossing tutorial, Trace Weight, Handoff, Last Hold, pause/settings, ending
- Content hierarchy: current pass (“1회차 기록” or “2회차 협동”) → one immediate objective → one input → optional short reason

## Design principles
- One new idea per room: Crossing teaches recording/replay; Trace Weight adds planning and shared force; Handoff adds role transfer; Last Hold resolves separation
- One target, one verb: the tutorial highlights only the object relevant now and names only the input required now
- Immediate confirmation: a tutorial hold may teach the verb, but must confirm within about one second; never make the player wait out the full tape to prove understanding
- Explain causality after visible response: first show the bridge react, then explain why the echo matters
- Honest recovery: when the plan cannot succeed, say what failed and show `R 다시 기록` immediately
- Tradeoffs: tutorial clarity outranks mystery in the first room; later rooms progressively remove guidance

## Visual language
- Color: amber is the controlled present, cyan is recorded memory, white is exit/completion, gold is tutorial guidance only
- Typography: cinematic serif for identity and room names; plain sans-serif for instructions and controls
- Spacing/layout rhythm: tutorial content stays in one compact panel and never covers the active target
- Shape/radius/elevation: stone/bronze world silhouettes; restrained rounded DOM panels; no flat illustration plates
- Motion: slow pulse on the single active target; no distracting global motion; reduced-motion removes pulse
- Imagery/iconography: live Babylon geometry only; procedural marker ring/arrow; no runtime raster art

## Components
- Existing components to reuse: title screen, tutorial card, mission/tape bar, success card, pause/settings, touch controls
- New/changed components: two-pass explainer on title; pass badge; three-item contextual checklist; input verb label; live 3D target marker
- Variants and states: recording, replay, recover, success; keyboard and touch copy; Korean and English
- Token/component ownership: `src/style.css` owns presentation tokens; `src/main.ts` owns tutorial copy/state derivation; `MemoryScene` owns render-only markers

## Accessibility
- Target standard: WCAG 2.1 AA where applicable to the browser UI
- Keyboard/focus behavior: all gameplay actions have keyboard equivalents; prompts use literal keys; pause remains reachable with Escape
- Contrast/readability: tutorial text remains visible on dark gameplay; state is communicated by words and shape, not color alone
- Screen-reader semantics: tutorial stage changes use one polite live region; do not announce every simulation tick
- Reduced motion and sensory considerations: disable marker pulse and decorative animation while retaining target visibility

## Responsive behavior
- Supported breakpoints/devices: desktop Chromium/Firefox/WebKit plus narrow/coarse-pointer layouts
- Layout adaptations: mobile keeps the instruction body visible and moves the checklist above touch controls
- Touch/hover differences: `ACT 누르고 있기/손 떼기` replaces keyboard-only `Space` wording; no hover-dependent information

## Interaction states
- Loading: title remains usable while renderer readiness resolves
- Empty: not applicable
- Error: identify the missing recorded role and offer `R`/touch rerecord
- Success: remove instruction noise and direct only toward the exit or next memory
- Disabled: hidden controls are not focusable
- Offline/slow network: game remains a static local build with no runtime asset/API dependency

## Content voice
- Tone: direct first, poetic second
- Terminology: “1회차 · 과거 행동 기록”, “2회차 · 과거와 협동”, “청록색 과거의 나”, “현재의 나”, “다시 기록”
- Microcopy rules: start with a verb; one sentence per action; never use “타임라인”, “비트마스크”, “위상”, or unexplained English; state whether to tap, hold, or release

## Implementation constraints
- Framework/styling system: Vite + vanilla TypeScript + CSS; Babylon.js is render-only
- Design-token constraints: extend the existing cyan/gold/dark palette; no new design-system dependency
- Performance constraints: preserve the representative render gate and deterministic 30 Hz core
- Compatibility constraints: no core Simulation authority may move into Babylon; no login/backend/runtime raster assets
- Test/screenshot expectations: Playwright must prove title explanation, tutorial stage transitions, real input, target marker visibility, three-engine journey, zero console errors, and the existing visual/performance gates

## Open questions
- [ ] Fresh-player cohort must confirm the revised Crossing tutorial is understandable without verbal help / product owner / release gate
- [ ] Physical iOS and Android touch wording and safe-area layout need device validation / QA / release gate
- [ ] Original audio cues for hold-complete and time-fold remain unimplemented / audio / polish
