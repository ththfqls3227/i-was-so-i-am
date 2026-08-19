import "./style.css";
import { Simulation, simulationConstants } from "./core/simulation";
import { SIMULATION_VERSION, TICK_RATE, type ActorId, type ChamberId, type FailureCode, type SimulationState, type Tape } from "./core/types";
import { CHAMBERS } from "./content/chambers";
import { goldenFor } from "./content/golden";
import { FOUR_ROOM_ROUTE } from "./content/manifests";
import { MemoryScene } from "./game/MemoryScene";

interface BrowserRun {
  checksums: string[];
  success: boolean;
  state: Readonly<SimulationState>;
}

declare global {
  interface Window {
    __I_WAS_SO_I_AM__: {
      state: Readonly<SimulationState> | null;
      checksum: string;
      versions: { build: string; simulation: string; renderer: string; babylon: string };
      renderer: { name: "babylon"; ready: boolean; context: "webgl1" | "webgl2"; error?: string };
      switchChamber: (id: ChamberId) => void;
      rerecord: () => void;
      loadGolden: (id: ChamberId) => void;
      runGolden: (id: ChamberId, cadence: number) => BrowserRun;
      runTape: (id: ChamberId, tape: Tape, presentFrames: number[]) => BrowserRun;
      actorScreenPosition: (id: ActorId) => { x: number; y: number } | null;
    };
  }
}

type Locale = "ko" | "en";
const ROUTE: ChamberId[] = [...FOUR_ROOM_ROUTE];
const FIRST_ROOM: ChamberId = ROUTE[0] ?? "crossing";
const BUILD_ID = "production-journey-20260814";
const PROGRESS_KEY = "i-was-so-i-am:progress:v1";
const EXPOSE_TEST_API = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";
const SHOW_DEBUG_DETAILS = import.meta.env.VITE_PRESENTATION === "true";
const roomNames: Record<ChamberId, { ko: string; en: string }> = {
  traceWeight: { ko: "무게의 흔적", en: "Trace Weight" },
  crossing: { ko: "건너는 기억", en: "Crossing" },
  handoff: { ko: "이어받은 마음", en: "Handoff" },
  lastHold: { ko: "마지막 붙듦", en: "Last Hold" },
};
// The core reports failures as structured codes; only this map turns them into copy.
const failureCopyMap: Partial<Record<FailureCode, { ko: string; en: string }>> = {
  "echo-faded": { ko: "메아리가 사라졌습니다 — R로 다시 기록하세요.", en: "The echo has faded. Rerecord with R." },
  "door-closed": { ko: "다리가 닫혔습니다 — R로 다시 기록하고, 윈치를 잡은 채 ⏎로 접으세요.", en: "The bridge closed. Rerecord with R and fold with ⏎ while gripping the winch." },
  "hold-released-early": { ko: "문이 닫혔습니다 — 과거가 손잡이를 놓쳤어요. 붙든 채로 시간을 접으세요.", en: "The door closed — your past let go of the handle. Fold time while still holding." },
  "carrier-not-staged": { ko: "기억 상자가 접점에 도착하지 못했습니다 — 1회차에 상자를 접점까지 옮기세요.", en: "The memory carrier never reached the junction. Carry it there in pass 1." },
  "delivery-gate-closed": { ko: "전달구가 닫혀 있습니다 — 1회차에서 개폐기를 더 오래 붙드세요.", en: "The delivery gate is closed. Hold the switch longer in pass 1." },
  "block-not-bridged": { ko: "틈이 그대로입니다 — 돌덩이를 끝까지 밀어야 해요.", en: "The gap remains. Push the block all the way." },
};

function failureCopy(code: FailureCode | null): string | null {
  if (!code) return null;
  const entry = failureCopyMap[code];
  if (entry) return entry[locale];
  return locale === "ko" ? "기록을 불러올 수 없습니다 — R로 다시 기록하세요." : "The recording could not be loaded. Rerecord with R.";
}

const debugDetails = SHOW_DEBUG_DETAILS
  ? '<details class="debug"><summary>결정성 정보</summary><code id="debug-value"></code></details>'
  : "";
const copy = {
  ko: {
    eyebrow: "과거의 나와 함께하는 1인 협동 퍼즐",
    intro: "같은 방을 두 번 플레이합니다. 먼저 과거의 행동을 남기고, 다음에는 그 행동을 반복하는 과거의 나와 협동하세요.",
    firstPass: "1회차 · 행동 기록",
    firstPassBody: "내 움직임과 행동이 그대로 저장됩니다.",
    secondPass: "2회차 · 과거와 협동",
    secondPassBody: "청록색 과거가 저장된 행동을 반복합니다.",
    play: "기억 속으로 들어가기",
    continue: "다음 기억으로",
    ending: "과거는 문을 붙들고 남았다.",
    endingBody: "그 흔적이 사라진 것은 아니다. 나는 그것을 지나왔기에, 지금 여기에 있다.",
    title: "I WAS, SO I AM",
    controls: "방향키 / WASD 이동 · Space / E 행동 · ⏎ 시간 접기 · R 다시 기록 · Esc 일시정지",
    foldPrompt: "시간 접기 — 지금 행동을 유지한 채 남은 시간을 접습니다",
    foldFlash: "시간이 접힙니다",
    passBanner: "청록색 과거가 당신의 기록을 재생합니다 — 이제 현재를 움직이세요",
    passRecordBadge: "1회차 · 기록",
    passCooperateBadge: "2회차 · 협동",
    passRerecordBadge: "↺ 다시 기록",
    recording: "RECORDING · 미래의 나에게 역할을 남기세요",
    replay: "TOGETHER · 과거의 나와 지금 함께 움직이세요",
    success: "MEMORY FOLDED · 둘이서 길을 만들었습니다",
    rerecord: "ECHO FADED · 계획을 고쳐 다시 기록하세요",
    pause: "기억이 멈췄습니다",
    resume: "계속하기",
  },
  en: {
    eyebrow: "A single-player co-op puzzle with your past self",
    intro: "You play each room twice. First leave a recording, then cooperate with the cyan past self that repeats it.",
    firstPass: "PASS 1 · RECORD",
    firstPassBody: "Your movement and actions are saved exactly.",
    secondPass: "PASS 2 · COOPERATE",
    secondPassBody: "The cyan past self repeats what you saved.",
    play: "Enter the memory",
    continue: "Next memory",
    ending: "The past stayed behind, holding the door.",
    endingBody: "It did not disappear. I am here because I moved through it.",
    title: "I WAS, SO I AM",
    controls: "Arrows / WASD move · Space / E act · ⏎ fold time · R rerecord · Esc pause",
    foldPrompt: "Fold time — keep this action and fold the rest of the recording",
    foldFlash: "Time folds",
    passBanner: "Your cyan past replays the recording — now move your present self",
    passRecordBadge: "PASS 1 · RECORD",
    passCooperateBadge: "PASS 2 · COOPERATE",
    passRerecordBadge: "↺ RERECORD",
    recording: "RECORDING · Leave a role for your future self",
    replay: "TOGETHER · Move beside the self you were",
    success: "MEMORY FOLDED · Two selves made a way",
    rerecord: "ECHO FADED · Rethink the plan and record again",
    pause: "The memory is paused",
    resume: "Resume",
  },
} as const;

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("App root is missing");
root.innerHTML = `
  <section class="shell">
    <header class="topbar">
      <div><p class="eyebrow" id="eyebrow"></p><h1>I WAS, SO I AM</h1></div>
      <div class="header-actions">
        <p class="room-progress"><span id="room-ordinal">01 / 04</span><i><b id="route-fill"></b></i></p>
        <button class="icon-button" id="pause-button" aria-label="일시정지">Ⅱ</button>
      </div>
    </header>
    <main class="stage">
      <div id="game" aria-label="I WAS, SO I AM 게임 화면"></div>
      <div class="tutorial-card" id="tutorial-card" role="status" aria-live="polite">
        <div class="tutorial-meta"><span id="tutorial-pass"></span><em id="tutorial-step"></em></div>
        <div class="tutorial-instruction"><strong id="tutorial-title"></strong><p id="tutorial-copy"></p><ol class="tutorial-checklist" id="tutorial-checklist"><li></li><li></li><li></li></ol></div>
        <div class="tutorial-action"><kbd id="tutorial-key"></kbd><small id="tutorial-action-label"></small></div>
      </div>
      <span class="pass-badge" id="pass-badge"></span>
      <button class="fold-prompt" id="fold-prompt" hidden><kbd aria-hidden="true">⏎</kbd><span id="fold-prompt-label"></span></button>
      <div class="pass-banner" id="pass-banner" role="status" hidden></div>
      <div class="fold-flash" id="fold-flash" aria-hidden="true" hidden></div>
      <div class="screen intro-screen" id="intro-screen">
        <p class="screen-kicker">A GAME ABOUT BECOMING</p>
        <h2 aria-hidden="true">I WAS,<br><em>SO I AM</em></h2>
        <p id="intro-copy"></p>
        <div class="loop-explainer" aria-label="두 번 플레이하는 방법">
          <div><b>1</b><strong id="first-pass-title"></strong><span id="first-pass-copy"></span></div>
          <i aria-hidden="true">→</i>
          <div><b>2</b><strong id="second-pass-title"></strong><span id="second-pass-copy"></span></div>
        </div>
        <button class="primary" id="play-button"></button>
        <small id="intro-controls"></small>
      </div>
      <div class="screen pause-screen" id="pause-screen" hidden>
        <p class="screen-kicker">PAUSED</p><h2 id="pause-title"></h2>
        <button class="primary" id="resume-button"></button>
        <div class="settings" aria-label="설정">
          <button data-setting="mute" aria-pressed="false">SOUND <span>ON</span></button>
          <button data-setting="motion" aria-pressed="false">MOTION <span>ON</span></button>
          <button data-setting="contrast" aria-pressed="false">CONTRAST <span>OFF</span></button>
          <button data-setting="locale" aria-pressed="false">LANG <span>KO</span></button>
        </div>
      </div>
      <div class="screen ending-screen" id="ending-screen" hidden>
        <p class="screen-kicker">THE ECHO REMAINS</p><h2 id="ending-title"></h2>
        <p id="ending-copy"></p><div class="ending-mark">I WAS <i></i> SO I AM</div>
        <button class="primary" id="title-button">처음으로</button>
        <small>Created for the echoes that carried us here.</small>
      </div>
      <div class="success-card" id="success-card" hidden>
        <span id="success-ordinal"></span><h3 id="success-title"></h3><p id="success-copy"></p>
        <button class="primary" id="next"></button>
      </div>
    </main>
    <aside class="mission" aria-live="polite">
      <div class="mission-copy"><p id="phase-label" class="phase"></p><h2 id="chamber-title"></h2><p id="chamber-subtitle"></p></div>
      <div class="tape-panel"><div class="tape-copy"><span id="tape-label">기록 남은 시간</span><strong id="tape-time"></strong></div><div class="tape-track"><i id="tape-fill"></i><b class="tape-mark tape-mark-one"></b><b class="tape-mark tape-mark-two"></b></div></div>
      <button class="rerecord" id="rerecord">↺ <span>다시 기록</span> <kbd>R</kbd></button>
      ${debugDetails}
    </aside>
    <nav class="touch-controls" aria-label="터치 게임 조작">
      <div class="dpad"><button data-control="up" aria-label="위">↑</button><button data-control="left" aria-label="왼쪽">←</button><button data-control="down" aria-label="아래">↓</button><button data-control="right" aria-label="오른쪽">→</button></div>
      <button class="touch-action" data-control="action" aria-label="행동 버튼, 길게 누르기">길게<br>누르기</button><button class="touch-fold" id="touch-fold" aria-label="시간 접기">⏎</button><button class="touch-reset" id="touch-rerecord" aria-label="다시 기록">↺</button>
    </nav>
  </section>`;

const gameHost = document.querySelector<HTMLElement>("#game");
if (!gameHost) throw new Error("Game surface is missing");
const scene = new MemoryScene(gameHost);

function queryElement<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

let locale: Locale = "ko";
let currentId: ChamberId = FIRST_ROOM;
let started = false;
let paused = false;
let successShownFor: ChamberId | null = null;

interface SavedProgress {
  nextRoom: ChamberId;
  locale: Locale;
}

function readProgress(): SavedProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedProgress>;
    if (!ROUTE.includes(value.nextRoom as ChamberId) || (value.locale !== "ko" && value.locale !== "en")) return null;
    return value as SavedProgress;
  } catch {
    return null;
  }
}

function writeProgress(nextRoom: ChamberId): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ nextRoom, locale } satisfies SavedProgress));
  } catch {
    // Progress is optional; storage denial must never block play.
  }
}

function clearProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // Progress is optional; storage denial must never block play.
  }
}

function setText(selector: string, value: string): void {
  const node = queryElement(selector);
  if (node && node.textContent !== value) node.textContent = value;
}

function phaseCopy(phase: SimulationState["phase"]): string {
  return copy[locale][phase];
}

interface TutorialMessage {
  stage: string;
  pass: string;
  step: string;
  title: string;
  body: string;
  key: string;
  action: string;
  checklist: Array<{ text: string; state: "done" | "active" | "next" }>;
}

// ---------------------------------------------------------------------------
// Tutorial stages are derived from simulation state only (phase, targetId,
// hold/door/forceObject/handoff flags, failure codes). Every threshold below
// comes from chamber data or core constants — never from magic tick or
// distance numbers.
// ---------------------------------------------------------------------------

const MIN_FOLD_TICKS = simulationConstants.minTapeTicks;

function canFoldNow(state: Readonly<SimulationState>): boolean {
  return state.phase === "recording" && state.tapeTick >= MIN_FOLD_TICKS;
}

function distanceToPoint(actor: SimulationState["actors"][number], x: number, y: number): number {
  return Math.hypot(actor.x - x, actor.y - y);
}

function recordingActor(state: Readonly<SimulationState>): SimulationState["actors"][number] | null {
  return state.actors[0] ?? null;
}

function presentActor(state: Readonly<SimulationState>): SimulationState["actors"][number] | null {
  return state.actors.find((candidate) => candidate.id === "present") ?? null;
}

/**
 * Ticks the Trace Weight winch must stay held so the present self can walk
 * from spawn to the latch line in pass 2 — derived from chamber geometry and
 * core movement speed, with the grace window as reaction margin.
 */
function traceRequiredHoldTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const latchX = chamber.door?.latchWhenPresentBeyondX ?? chamber.spawn.x;
  return Math.ceil((latchX - chamber.spawn.x) / simulationConstants.movePerTick) + simulationConstants.graceTicks;
}

/**
 * Ticks of rightward walking the Trace Weight recording needs after releasing
 * the winch so the replayed past can travel winch→weight through the latched
 * bridge. Derived from chamber geometry, not tuned by hand.
 */
function traceRequiredTravelTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const holdX = chamber.hold?.x ?? chamber.spawn.x;
  const weightX = chamber.forceObject?.x ?? holdX;
  return Math.ceil((weightX - holdX) / simulationConstants.movePerTick) + simulationConstants.graceTicks;
}

// Signals accumulated from the state stream during a recording (state history,
// still no magic numbers): how long the hold has been gripped and, for Trace
// Weight, whether it was held long enough and when it was released.
let lastRecordingTick = 0;
let holdActiveSinceTick: number | null = null;
let traceHeldLongEnough = false;
let traceReleaseTick: number | null = null;

function resetTutorialSignals(): void {
  lastRecordingTick = 0;
  holdActiveSinceTick = null;
  traceHeldLongEnough = false;
  traceReleaseTick = null;
}

function trackTutorialSignals(state: Readonly<SimulationState>): void {
  if (state.phase !== "recording") {
    holdActiveSinceTick = null;
    return;
  }
  if (state.tapeTick < lastRecordingTick) resetTutorialSignals();
  lastRecordingTick = state.tapeTick;
  if (state.hold?.active) {
    if (holdActiveSinceTick === null) holdActiveSinceTick = state.tapeTick;
    if (state.chamberId === "traceWeight" && state.tapeTick - holdActiveSinceTick >= traceRequiredHoldTicks()) {
      traceHeldLongEnough = true;
    }
  } else {
    holdActiveSinceTick = null;
    if (state.chamberId === "traceWeight" && traceHeldLongEnough && traceReleaseTick === null) {
      traceReleaseTick = state.tapeTick;
    }
  }
}

function inputLabel(kind: "move" | "act" | "release" | "reset" | "fold"): { key: string; action: string } {
  const touch = navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
  const korean = locale === "ko";
  if (kind === "move") return { key: touch ? (korean ? "방향 버튼" : "D-PAD") : (korean ? "방향키 / WASD" : "ARROWS / WASD"), action: korean ? "이동" : "Move" };
  if (kind === "act") return { key: touch ? "ACT" : "SPACE / E", action: korean ? "누르고 있기" : "Hold" };
  if (kind === "release") return { key: touch ? "ACT" : "SPACE / E", action: korean ? "손 떼기" : "Release" };
  if (kind === "fold") return { key: touch ? (korean ? "시간 접기" : "FOLD") : "⏎ ENTER", action: korean ? "시간 접기" : "Fold time" };
  return { key: touch ? "↺" : "R", action: korean ? "처음부터 다시 기록" : "Rerecord from the start" };
}

function tutorialInput(kind: "move" | "act" | "release" | "reset" | "fold"): Pick<TutorialMessage, "key" | "action"> {
  return inputLabel(kind);
}

function passLabels(korean: boolean): { record: string; cooperate: string } {
  return {
    record: korean ? "1회차 · 과거 행동 기록" : "PASS 1 · RECORD",
    cooperate: korean ? "2회차 · 과거와 협동" : "PASS 2 · COOPERATE",
  };
}

function rerecordMessage(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  return {
    stage: `${state.chamberId}-rerecord`,
    pass: korean ? "다시 기록이 필요합니다" : "RERECORD NEEDED",
    step: korean ? "복구" : "RECOVER",
    title: korean ? "기록을 고쳐야 합니다" : "Fix the recording",
    body: failureCopy(state.lastError) ?? (korean ? "R을 눌러 처음부터 더 나은 행동을 기록하세요." : "Press R and record a better plan from the start."),
    ...tutorialInput("reset"),
    checklist: [
      { text: korean ? "R로 즉시 다시 기록" : "Rerecord now with R", state: "active" },
    ],
  };
}

function crossingTutorial(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  const pass = passLabels(korean);
  const hold = state.hold;
  if (state.phase === "recording") {
    const pilot = recordingActor(state);
    const gripping = hold?.active === true;
    const foldReady = canFoldNow(state);
    const checklist: TutorialMessage["checklist"] = [
      { text: korean ? "윈치를 붙들기" : "Grip the winch", state: gripping ? "done" : "active" },
      { text: korean ? "⏎로 시간 접기" : "Fold time with ⏎", state: gripping && foldReady ? "active" : "next" },
      { text: korean ? "2회차에 다리 건너기" : "Cross during pass 2", state: "next" },
    ];
    if (!gripping) {
      const nearWinch = Boolean(hold && pilot && distanceToPoint(pilot, hold.x, hold.y) <= hold.radius);
      if (!nearWinch) {
        return {
          stage: "crossing-move-winch",
          pass: pass.record,
          step: "1 / 3",
          title: korean ? "황금 표식의 윈치로 가세요" : "Go to the winch under the gold marker",
          body: korean ? "아직 탈출이 아닙니다 — 미래의 나를 도울 행동을 먼저 남깁니다." : "Do not escape yet — first leave the action your future self will need.",
          ...tutorialInput("move"),
          checklist,
        };
      }
      return {
        stage: "crossing-grab-winch",
        pass: pass.record,
        step: "1 / 3",
        title: korean ? "Space를 누르고 있으세요 — 다리가 내려옵니다" : "Hold Space — the bridge comes down",
        body: korean ? "행동 키를 누르고 있는 동안 윈치가 다리를 붙듭니다." : "While you hold the action key, the winch keeps the bridge down.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (!foldReady) {
      return {
        stage: "crossing-hold-winch",
        pass: pass.record,
        step: "2 / 3",
        title: korean ? "그대로 붙들고 있으세요" : "Keep holding",
        body: korean ? "금색 게이지가 차면 시간을 접을 수 있습니다." : "Once the gold gauge fills you can fold time.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    return {
      stage: "crossing-fold",
      pass: pass.record,
      step: "2 / 3",
      title: korean ? "⏎로 시간을 접으세요 — 이 손은 계속 붙들고 있게 됩니다" : "Fold time with ⏎ — this hand keeps holding",
      body: korean ? "남은 기록이 접히고, 청록색 과거는 윈치를 계속 잡습니다." : "The rest of the recording folds; your cyan past keeps gripping the winch.",
      ...tutorialInput("fold"),
      checklist,
    };
  }
  const present = presentActor(state);
  const doorOpen = state.door?.open === true;
  const beyondDoor = Boolean(present && state.door && present.x > state.door.rect.x + state.door.rect.width);
  const checklist: TutorialMessage["checklist"] = [
    { text: korean ? "청록색 과거가 윈치 붙들기" : "Past holds the winch", state: doorOpen ? "done" : "next" },
    { text: korean ? "다리를 건너기" : "Cross the bridge", state: beyondDoor ? "done" : doorOpen ? "active" : "next" },
    { text: korean ? "오른쪽 빛으로 들어가기" : "Enter the light on the right", state: state.success ? "done" : beyondDoor ? "active" : "next" },
  ];
  if (state.success) {
    return {
      stage: "crossing-complete",
      pass: korean ? "튜토리얼 완료" : "TUTORIAL COMPLETE",
      step: korean ? "완료" : "DONE",
      title: korean ? "혼자였지만, 과거의 나와 함께 해냈습니다" : "You did it with the self you were",
      body: korean ? "다음 방부터는 이 원리를 조금씩 응용합니다." : "The next rooms build on this same rule.",
      key: "✓",
      action: korean ? "다음 기억으로" : "Continue",
      checklist,
    };
  }
  if (!doorOpen) {
    return {
      stage: "crossing-wait-bridge",
      pass: pass.cooperate,
      step: "3 / 3",
      title: korean ? "다리가 닫혀 있습니다" : "The bridge is closed",
      body: korean ? "청록색 과거가 윈치를 잡으면 다리가 열립니다 — 다리 앞에서 준비하세요." : "The bridge opens once your cyan past grips the winch — get ready beside it.",
      ...tutorialInput("move"),
      checklist,
    };
  }
  if (!beyondDoor) {
    return {
      stage: "crossing-cross-bridge",
      pass: pass.cooperate,
      step: "3 / 3",
      title: korean ? "과거가 윈치를 붙들고 있습니다. 다리를 건너 빛으로 가세요" : "Your past holds the winch. Cross into the light",
      body: korean ? "주황색 현재를 움직여 열린 다리를 건너세요." : "Move the amber present self across the open bridge.",
      ...tutorialInput("move"),
      checklist,
    };
  }
  return {
    stage: "crossing-enter-exit",
    pass: pass.cooperate,
    step: "3 / 3",
    title: korean ? "그대로 오른쪽의 빛까지 가세요" : "Continue right into the light",
    body: korean ? "과거의 손이 다리를 붙들고 있습니다." : "The hand you left behind keeps the bridge open.",
    ...tutorialInput("move"),
    checklist,
  };
}

function traceWeightTutorial(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  const pass = passLabels(korean);
  const hold = state.hold;
  const stone = state.forceObject;
  if (state.phase === "recording") {
    const pilot = recordingActor(state);
    const gripping = hold?.active === true;
    const heldTicks = holdActiveSinceTick === null ? 0 : state.tapeTick - holdActiveSinceTick;
    const travelTicks = traceReleaseTick === null ? 0 : state.tapeTick - traceReleaseTick;
    const travelledEnough = traceReleaseTick !== null && travelTicks >= traceRequiredTravelTicks();
    const checklist: TutorialMessage["checklist"] = [
      { text: korean ? "윈치를 충분히 붙들기" : "Hold the winch long enough", state: traceHeldLongEnough ? "done" : "active" },
      { text: korean ? "오른쪽 + 행동 키 기록" : "Record right + action", state: travelledEnough ? "done" : traceHeldLongEnough ? "active" : "next" },
      { text: korean ? "⏎ 시간 접기" : "Fold time with ⏎", state: travelledEnough && canFoldNow(state) ? "active" : "next" },
    ];
    if (!traceHeldLongEnough) {
      if (!gripping) {
        const nearWinch = Boolean(hold && pilot && distanceToPoint(pilot, hold.x, hold.y) <= hold.radius);
        return {
          stage: nearWinch ? "trace-grab-winch" : "trace-move-winch",
          pass: pass.record,
          step: "1 / 4",
          title: korean ? "윈치를 붙들어 문을 여세요" : "Grip the winch to open the door",
          body: nearWinch
            ? (korean ? "행동 키를 누르고 계세요 — 붙드는 시간만큼 미래의 내가 건널 수 있습니다." : "Keep holding the action key — every second held is time your future self can cross.")
            : (korean ? "황금 표식의 윈치로 가세요." : "Go to the winch under the gold marker."),
          ...(nearWinch ? tutorialInput("act") : tutorialInput("move")),
          checklist,
        };
      }
      const secondsLeft = Math.max(0, traceRequiredHoldTicks() - heldTicks) / TICK_RATE;
      return {
        stage: "trace-keep-holding",
        pass: pass.record,
        step: "1 / 4",
        title: korean ? "그대로 붙드세요 — 건널 시간을 벌고 있습니다" : "Keep holding — you are buying crossing time",
        body: korean ? `앞으로 ${secondsLeft.toFixed(1)}초 더 붙들면 충분합니다.` : `Hold for ${secondsLeft.toFixed(1)} more seconds and it will be enough.`,
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (gripping) {
      return {
        stage: "trace-release",
        pass: pass.record,
        step: "2 / 4",
        title: korean ? "손을 떼고, 돌덩이 쪽으로 걸으세요" : "Let go and walk toward the weight",
        body: korean ? "충분히 붙들었습니다 — 이 기록이면 미래의 내가 건널 수 있습니다." : "You held long enough — this recording gives your future self time to cross.",
        ...tutorialInput("release"),
        checklist,
      };
    }
    if (!travelledEnough) {
      return {
        stage: "trace-record-push",
        pass: pass.record,
        step: "3 / 4",
        title: korean ? "오른쪽을 누른 채 행동 키도 함께 누르세요" : "Keep moving right and hold action too",
        body: korean ? "지금 문에 막혀도 괜찮습니다 — 위치가 아니라 입력이 기록됩니다. 2회차의 과거는 고정된 문을 지나 돌덩이를 밉니다." : "Being blocked by the door now is fine — inputs are recorded, not positions. In pass 2 your past walks through the latched door and pushes the weight.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    return {
      stage: "trace-fold",
      pass: pass.record,
      step: "4 / 4",
      title: korean ? "⏎ 시간 접기" : "Fold time with ⏎",
      body: korean ? "과거는 이 밀기를 이어갑니다 — 2회차에 함께 미세요." : "Your past keeps pushing from here — join in during pass 2.",
      ...tutorialInput("fold"),
      checklist,
    };
  }
  const force = stone?.force ?? 0;
  const threshold = stone?.threshold ?? 0;
  const latched = state.door?.latched === true;
  const checklist: TutorialMessage["checklist"] = [
    { text: korean ? "열린 문을 지나 합류" : "Cross the open door", state: latched ? "done" : "active" },
    { text: korean ? "과거와 함께 밀기" : "Push beside your past", state: state.exit.open ? "done" : latched ? "active" : "next" },
    { text: korean ? "빛으로 들어가기" : "Enter the light", state: state.success ? "done" : state.exit.open ? "active" : "next" },
  ];
  if (state.success) {
    return {
      stage: "trace-complete",
      pass: korean ? "기억 완성" : "MEMORY COMPLETE",
      step: korean ? "완료" : "DONE",
      title: korean ? "두 자아의 힘이 길을 열었습니다" : "Two efforts opened the way",
      body: korean ? "혼자서는 움직이지 않던 무게였습니다." : "Alone, the weight would never have moved.",
      key: "✓",
      action: korean ? "다음 기억으로" : "Continue",
      checklist,
    };
  }
  if (state.exit.open) {
    return {
      stage: "trace-exit",
      pass: pass.cooperate,
      step: "3 / 3",
      title: korean ? "빛으로 들어가세요" : "Enter the light",
      body: korean ? "과거의 힘이 현재의 길이 되었습니다." : "Your past effort became the way forward.",
      ...tutorialInput("move"),
      checklist,
    };
  }
  if (!latched) {
    return {
      stage: "trace-cross",
      pass: pass.cooperate,
      step: "1 / 3",
      title: korean ? "열린 문을 지나가세요" : "Cross while the door is open",
      body: state.door?.open
        ? (korean ? "과거가 윈치를 붙드는 동안 건너면 문이 고정됩니다." : "Cross while your past holds the winch and the door latches open.")
        : (korean ? "과거가 곧 윈치를 잡습니다 — 문 앞으로 가세요." : "Your past is about to grip the winch — get to the door."),
      ...tutorialInput("move"),
      checklist,
    };
  }
  if (force < threshold) {
    return {
      stage: "trace-push",
      pass: pass.cooperate,
      step: "2 / 3",
      title: korean ? "과거와 같은 면에서 함께 미세요" : "Push beside your past self",
      body: korean ? `현재 결합된 힘 ${force} / ${threshold} · 돌덩이 왼쪽 면에서 오른쪽을 바라보고 행동 키를 누르세요.` : `Combined force ${force} / ${threshold} · Face right at the weight's left side and hold the action key.`,
      ...tutorialInput("act"),
      checklist,
    };
  }
  return {
    stage: "trace-pushing",
    pass: pass.cooperate,
    step: "2 / 3",
    title: korean ? "두 힘이 하나가 되었습니다" : "Two efforts became one",
    body: korean ? "행동 키를 놓지 말고 돌덩이를 끝까지 미세요." : "Keep holding action and push the weight to the end.",
    ...tutorialInput("act"),
    checklist,
  };
}

function handoffTutorial(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  const pass = passLabels(korean);
  const handoff = state.handoff;
  const hold = state.hold;
  if (!handoff) {
    return {
      stage: "handoff-missing",
      pass: pass.record,
      step: "",
      title: roomNames.handoff[locale],
      body: CHAMBERS.handoff.hint,
      ...tutorialInput("move"),
      checklist: [],
    };
  }
  if (state.phase === "recording") {
    const pilot = recordingActor(state);
    const carrying = handoff.holder === "past";
    const gripping = hold?.active === true;
    const foldReady = canFoldNow(state);
    const checklist: TutorialMessage["checklist"] = [
      { text: korean ? "상자를 교차점에 내려놓기" : "Stage the carrier at the junction", state: handoff.stagedByPast ? "done" : "active" },
      { text: korean ? "개폐기를 붙들기" : "Grip the gate switch", state: gripping ? "done" : handoff.stagedByPast ? "active" : "next" },
      { text: korean ? "⏎ 시간 접기" : "Fold time with ⏎", state: handoff.stagedByPast && gripping && foldReady ? "active" : "next" },
    ];
    if (!handoff.stagedByPast) {
      if (!carrying) {
        const nearCarrier = Boolean(pilot && distanceToPoint(pilot, handoff.x, handoff.y) <= handoff.radius);
        return {
          stage: nearCarrier ? "handoff-lift" : "handoff-find-carrier",
          pass: pass.record,
          step: "1 / 4",
          title: korean ? "기억 상자를 들어 올리세요" : "Pick up the memory carrier",
          body: nearCarrier
            ? (korean ? "행동 키를 누르고 있으면 상자를 듭니다." : "Hold the action key to lift the carrier.")
            : (korean ? "청록색으로 빛나는 상자로 가세요." : "Walk to the glowing cyan carrier."),
          ...(nearCarrier ? tutorialInput("act") : tutorialInput("move")),
          checklist,
        };
      }
      return {
        stage: "handoff-stage",
        pass: pass.record,
        step: "2 / 4",
        title: korean ? "황금 교차점에 내려놓으세요" : "Set it down at the gold junction",
        body: korean ? "행동 키를 누른 채 교차점까지 옮기면 상자가 내려놓입니다." : "Carry it to the junction while holding action — it stages itself there.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (!gripping) {
      return {
        stage: "handoff-switch",
        pass: pass.record,
        step: "3 / 4",
        title: korean ? "개폐기로 가서 붙드세요 — 전달구가 열립니다" : "Grip the switch — it opens the delivery gate",
        body: korean ? "위쪽의 황금 표식이 개폐기입니다. 행동 키를 누르고 계세요." : "The gold marker above is the switch. Keep holding the action key.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (!foldReady) {
      return {
        stage: "handoff-hold-switch",
        pass: pass.record,
        step: "3 / 4",
        title: korean ? "그대로 붙들고 있으세요" : "Keep holding",
        body: korean ? "곧 시간을 접을 수 있습니다." : "You will be able to fold time in a moment.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    return {
      stage: "handoff-fold",
      pass: pass.record,
      step: "4 / 4",
      title: korean ? "⏎ 시간 접기 — 개폐기는 계속 붙들려 있습니다" : "Fold time with ⏎ — the switch stays held",
      body: korean ? "과거가 전달구를 열어 두는 동안 현재가 상자를 옮깁니다." : "While your past keeps the gate open, your present moves the carrier.",
      ...tutorialInput("fold"),
      checklist,
    };
  }
  const checklist: TutorialMessage["checklist"] = [
    { text: korean ? "접점에서 상자 받기" : "Receive the carrier", state: handoff.receivedByPresent ? "done" : "active" },
    { text: korean ? "위쪽 길로 옮기기" : "Carry it onto the upper route", state: handoff.redirectedByPresent ? "done" : handoff.receivedByPresent ? "active" : "next" },
    { text: korean ? "전달구에 넣기" : "Deliver it through the gate", state: handoff.delivered ? "done" : handoff.redirectedByPresent ? "active" : "next" },
  ];
  if (state.success) {
    return {
      stage: "handoff-complete",
      pass: korean ? "기억 완성" : "MEMORY COMPLETE",
      step: korean ? "완료" : "DONE",
      title: korean ? "기억이 손에서 손으로 이어졌습니다" : "The memory passed from hand to hand",
      body: korean ? "내가 내려놓은 것을, 내가 이어받았습니다." : "What I set down, I received.",
      key: "✓",
      action: korean ? "다음 기억으로" : "Continue",
      checklist,
    };
  }
  if (!handoff.receivedByPresent) {
    return {
      stage: "handoff-receive",
      pass: pass.cooperate,
      step: "1 / 4",
      title: korean ? "접점으로 가서 상자를 받으세요" : "Go to the junction and receive the carrier",
      body: handoff.stagedByPast
        ? (korean ? "상자가 접점에 있습니다 — 곁에서 행동 키를 누르고 있으세요." : "The carrier waits at the junction — hold the action key beside it.")
        : (korean ? "청록색 과거가 상자를 옮기는 중입니다 — 접점에서 기다리세요." : "Your cyan past is still carrying it — wait at the junction."),
      ...tutorialInput("act"),
      checklist,
    };
  }
  if (!handoff.redirectedByPresent) {
    return {
      stage: "handoff-redirect",
      pass: pass.cooperate,
      step: "2 / 4",
      title: korean ? "상자를 위쪽 길로 옮기세요" : "Carry the carrier onto the upper route",
      body: korean ? "행동 키를 누른 채 위로 이동하세요." : "Keep holding action and move upward.",
      ...tutorialInput("act"),
      checklist,
    };
  }
  if (!handoff.delivered) {
    return {
      stage: "handoff-deliver",
      pass: pass.cooperate,
      step: "3 / 4",
      title: korean ? "과거가 열어둔 전달구에 넣으세요" : "Deliver it through the gate your past opened",
      body: state.door?.open
        ? (korean ? "전달구가 열려 있습니다 — 오른쪽 위 받침대까지 옮기세요." : "The gate is open — carry it to the cradle on the upper right.")
        : (korean ? "전달구가 아직 닫혀 있습니다 — 과거가 개폐기를 잡으면 열립니다." : "The gate is still closed — it opens once your past grips the switch."),
      ...tutorialInput("act"),
      checklist,
    };
  }
  return {
    stage: "handoff-exit",
    pass: pass.cooperate,
    step: "4 / 4",
    title: korean ? "빛으로 들어가세요" : "Enter the light",
    body: korean ? "전달이 끝났습니다 — 출구가 열려 있습니다." : "The delivery is done — the exit is open.",
    ...tutorialInput("move"),
    checklist,
  };
}

function lastHoldTutorial(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  const pass = passLabels(korean);
  const stone = state.forceObject;
  const hold = state.hold;
  const seated = Boolean(stone && stone.x <= stone.minX);
  if (state.phase === "recording") {
    const pilot = recordingActor(state);
    const gripping = hold?.active === true;
    const foldReady = canFoldNow(state);
    const checklist: TutorialMessage["checklist"] = [
      { text: korean ? "돌덩이를 틈에 밀어 넣기" : "Seat the stone in the gap", state: seated ? "done" : "active" },
      { text: korean ? "문 손잡이를 붙들기" : "Grip the door handle", state: gripping ? "done" : seated ? "active" : "next" },
      { text: korean ? "⏎ 시간 접기" : "Fold time with ⏎", state: seated && gripping && foldReady ? "active" : "next" },
    ];
    if (!seated) {
      const engaging = Boolean(stone && pilot && pilot.targetId === stone.id && pilot.actionHeld);
      if (!engaging) {
        return {
          stage: "lasthold-reach-stone",
          pass: pass.record,
          step: "1 / 3",
          title: korean ? "돌덩이를 왼쪽 틈으로 미세요 — 다리가 됩니다" : "Push the stone left into the gap — it becomes a bridge",
          body: korean ? "돌덩이 오른쪽 면에서 왼쪽을 바라보고 행동 키를 누르세요." : "Stand at the stone's right face, look left, and hold the action key.",
          ...tutorialInput("move"),
          checklist,
        };
      }
      const span = stone ? Math.max(1, stone.maxX - stone.minX) : 1;
      const progress = stone ? Math.round(((stone.maxX - stone.x) / span) * 100) : 0;
      return {
        stage: "lasthold-push-stone",
        pass: pass.record,
        step: "1 / 3",
        title: korean ? "그대로 미세요" : "Keep pushing",
        body: korean ? `틈까지 ${progress}% 밀었습니다.` : `The stone is ${progress}% of the way into the gap.`,
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (!gripping) {
      return {
        stage: "lasthold-grab-handle",
        pass: pass.record,
        step: "2 / 3",
        title: korean ? "마지막 문의 손잡이를 붙드세요" : "Grip the final door's handle",
        body: korean ? "황금 표식의 손잡이로 가서 행동 키를 누르고 있으세요." : "Go to the handle under the gold marker and keep holding the action key.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    if (!foldReady) {
      return {
        stage: "lasthold-hold-handle",
        pass: pass.record,
        step: "2 / 3",
        title: korean ? "그대로 붙들고 있으세요" : "Keep holding",
        body: korean ? "곧 시간을 접을 수 있습니다." : "You will be able to fold time in a moment.",
        ...tutorialInput("act"),
        checklist,
      };
    }
    return {
      stage: "lasthold-fold",
      pass: pass.record,
      step: "3 / 3",
      title: korean ? "⏎ — 과거는 여기, 문 곁에 남습니다" : "⏎ — your past stays here, beside the door",
      body: korean ? "시간을 접으면 과거는 이 손잡이를 끝까지 붙듭니다." : "Fold time and your past holds this handle to the end.",
      ...tutorialInput("fold"),
      checklist,
    };
  }
  const present = presentActor(state);
  const doorOpen = state.door?.open === true;
  const beyondDoor = Boolean(present && state.door && present.x > state.door.rect.x + state.door.rect.width);
  const checklist: TutorialMessage["checklist"] = [
    { text: korean ? "돌덩이 다리 완성" : "Stone bridge in place", state: seated ? "done" : "next" },
    { text: korean ? "과거가 문을 붙듦" : "Past holds the door", state: doorOpen ? "done" : "next" },
    { text: korean ? "문을 지나 빛으로" : "Through the door, into the light", state: state.success ? "done" : doorOpen || beyondDoor ? "active" : "next" },
  ];
  if (state.success) {
    return {
      stage: "lasthold-complete",
      pass: korean ? "기억 완성" : "MEMORY COMPLETE",
      step: korean ? "완료" : "DONE",
      title: korean ? "과거는 문을 붙들고 남았습니다" : "The past stayed behind, holding the door",
      body: korean ? "지나왔기에, 지금 여기에 있습니다." : "I am here because I moved through it.",
      key: "✓",
      action: korean ? "계속" : "Continue",
      checklist,
    };
  }
  if (!doorOpen) {
    return {
      stage: "lasthold-wait-door",
      pass: pass.cooperate,
      step: "1 / 2",
      title: korean ? "문 앞으로 가세요 — 과거가 다리를 놓고 문을 붙듭니다" : "Walk to the door — your past bridges the gap and grips the handle",
      body: korean ? "청록색 과거가 기록을 따라 움직이는 동안 오른쪽으로 나아가세요." : "Move right while your cyan past follows the recording.",
      ...tutorialInput("move"),
      checklist,
    };
  }
  if (!beyondDoor) {
    return {
      stage: "lasthold-pass-door",
      pass: pass.cooperate,
      step: "2 / 2",
      title: korean ? "문을 지나세요 — 과거는 따라올 수 없습니다" : "Pass the door — your past cannot follow",
      body: korean ? "과거가 손잡이를 붙드는 동안만 문이 열려 있습니다." : "The door stays open only while your past holds the handle.",
      ...tutorialInput("move"),
      checklist,
    };
  }
  return {
    stage: "lasthold-exit",
    pass: pass.cooperate,
    step: "2 / 2",
    title: korean ? "빛으로 들어가세요" : "Enter the light",
    body: korean ? "뒤돌아보지 않아도 됩니다 — 과거는 남는 것을 선택했습니다." : "You do not need to look back — your past chose to stay.",
    ...tutorialInput("move"),
    checklist,
  };
}

function tutorialMessage(state: Readonly<SimulationState>): TutorialMessage {
  const korean = locale === "ko";
  if (state.phase === "rerecord") return rerecordMessage(state, korean);
  switch (state.chamberId) {
    case "crossing": return crossingTutorial(state, korean);
    case "traceWeight": return traceWeightTutorial(state, korean);
    case "handoff": return handoffTutorial(state, korean);
    case "lastHold": return lastHoldTutorial(state, korean);
  }
}

function updateTutorial(state: Readonly<SimulationState>): void {
  // No stage-level cache: dynamic bodies (force gauge, hold countdown) must
  // refresh every snapshot. setText already skips unchanged DOM writes.
  const tutorial = tutorialMessage(state);
  setText("#tutorial-pass", tutorial.pass);
  setText("#tutorial-step", tutorial.step);
  setText("#tutorial-title", tutorial.title);
  setText("#tutorial-copy", tutorial.body);
  setText("#tutorial-key", tutorial.key);
  setText("#tutorial-action-label", tutorial.action);
  const list = queryElement("#tutorial-checklist");
  if (list) {
    while (list.children.length > tutorial.checklist.length) list.lastElementChild?.remove();
    while (list.children.length < tutorial.checklist.length) list.appendChild(document.createElement("li"));
    tutorial.checklist.forEach((entry, index) => {
      const item = list.children[index];
      if (!(item instanceof HTMLLIElement)) return;
      if (item.textContent !== entry.text) item.textContent = entry.text;
      if (item.dataset.state !== entry.state) item.dataset.state = entry.state;
    });
  }
  const card = queryElement("#tutorial-card");
  if (card) {
    if (card.dataset.phase !== state.phase) card.dataset.phase = state.phase;
    if (card.dataset.stage !== tutorial.stage) card.dataset.stage = tutorial.stage;
  }
}

function setPaused(value: boolean): void {
  paused = value;
  scene.setPaused(value);
  const panel = queryElement("#pause-screen");
  if (panel) panel.hidden = !value;
  queryElement("#pause-button")?.setAttribute("aria-expanded", String(value));
}

function localize(): void {
  document.documentElement.lang = locale;
  setText("#eyebrow", copy[locale].eyebrow);
  setText("#intro-copy", copy[locale].intro);
  setText("#first-pass-title", copy[locale].firstPass);
  setText("#first-pass-copy", copy[locale].firstPassBody);
  setText("#second-pass-title", copy[locale].secondPass);
  setText("#second-pass-copy", copy[locale].secondPassBody);
  setText("#play-button", copy[locale].play);
  setText("#intro-controls", copy[locale].controls);
  setText("#fold-prompt-label", copy[locale].foldPrompt);
  setText("#pause-title", copy[locale].pause);
  setText("#resume-button", copy[locale].resume);
  setText("#next", copy[locale].continue);
  setText("#ending-title", copy[locale].ending);
  setText("#ending-copy", copy[locale].endingBody);
  const state = window.__I_WAS_SO_I_AM__?.state;
  if (state) {
    setText("#phase-label", phaseCopy(state.phase));
    setText("#chamber-title", roomNames[state.chamberId][locale]);
    setText("#pass-badge", passBadgeCopy(state.phase));
    updateTutorial(state);
  }
}

function passBadgeCopy(phase: SimulationState["phase"]): string {
  if (phase === "recording") return copy[locale].passRecordBadge;
  if (phase === "rerecord") return copy[locale].passRerecordBadge;
  return copy[locale].passCooperateBadge;
}

// Fold flash (0.6 s) and pass-transition banner shown when a recording ends
// and the replay begins. The simulation never pauses — overlay only.
const FOLD_FLASH_MS = 600;
const PASS_BANNER_MS = 1600;
let fxPhase: SimulationState["phase"] | null = null;
let foldFlashTimer: number | undefined;
let passBannerTimer: number | undefined;

function showPassTransition(folded: boolean): void {
  const banner = queryElement("#pass-banner");
  if (banner) {
    banner.textContent = copy[locale].passBanner;
    banner.hidden = false;
    window.clearTimeout(passBannerTimer);
    passBannerTimer = window.setTimeout(() => { banner.hidden = true; }, PASS_BANNER_MS);
  }
  if (!folded) return;
  const flash = queryElement("#fold-flash");
  if (flash) {
    flash.textContent = copy[locale].foldFlash;
    flash.hidden = false;
    window.clearTimeout(foldFlashTimer);
    foldFlashTimer = window.setTimeout(() => { flash.hidden = true; }, FOLD_FLASH_MS);
  }
}

function updateUi(state: Readonly<SimulationState>, checksum: string): void {
  const chamber = CHAMBERS[state.chamberId];
  currentId = state.chamberId;
  const index = ROUTE.indexOf(state.chamberId);
  trackTutorialSignals(state);
  if (fxPhase === "recording" && state.phase === "replay") showPassTransition(state.foldedAtTick !== null);
  fxPhase = state.phase;
  setText("#phase-label", phaseCopy(state.phase));
  setText("#chamber-title", roomNames[state.chamberId][locale]);
  queryElement("#chamber-title")?.setAttribute("data-chamber-id", state.chamberId);
  setText("#chamber-subtitle", chamber.subtitle);
  setText("#pass-badge", passBadgeCopy(state.phase));
  const foldReady = canFoldNow(state);
  const foldPrompt = queryElement<HTMLButtonElement>("#fold-prompt");
  if (foldPrompt) {
    foldPrompt.hidden = state.phase !== "recording";
    foldPrompt.disabled = !foldReady;
  }
  const touchFold = queryElement<HTMLButtonElement>("#touch-fold");
  if (touchFold) touchFold.disabled = !foldReady;
  setText("#room-ordinal", `${String(index + 1).padStart(2, "0")} / ${String(ROUTE.length).padStart(2, "0")}`);
  const secondsRemaining = Math.max(0, chamber.tapeDurationTicks - Math.min(state.tapeTick, chamber.tapeDurationTicks)) / 30;
  const tapeMode = state.phase === "recording"
    ? (locale === "ko" ? "기록 남은 시간" : "RECORDING LEFT")
    : (locale === "ko" ? "메아리 남은 시간" : "ECHO TIME LEFT");
  setText("#tape-label", tapeMode);
  setText("#tape-time", locale === "ko" ? `${secondsRemaining.toFixed(1)}초` : `${secondsRemaining.toFixed(1)}s`);
  const fill = queryElement("#tape-fill");
  if (fill) fill.style.width = `${Math.min(100, state.tapeTick / chamber.tapeDurationTicks * 100)}%`;
  const routeFill = queryElement("#route-fill");
  if (routeFill) routeFill.style.width = `${((index + (state.success ? 1 : 0)) / ROUTE.length) * 100}%`;
  if (SHOW_DEBUG_DETAILS) {
    setText("#debug-value", `build ${BUILD_ID} · sim ${state.simulationVersion} · ${state.phase}:${state.tapeTick} · checksum ${checksum}`);
  }
  updateTutorial(state);
  document.body.dataset.phase = state.phase;
  document.body.classList.toggle("has-success", state.success);
  document.body.classList.toggle("exit-open", state.exit.open);
  window.__I_WAS_SO_I_AM__.state = state;
  window.__I_WAS_SO_I_AM__.checksum = checksum;
  if (state.success && successShownFor !== state.chamberId) {
    successShownFor = state.chamberId;
    setText("#success-ordinal", `MEMORY ${String(index + 1).padStart(2, "0")} COMPLETE`);
    setText("#success-title", chamber.name);
    setText("#success-copy", locale === "ko" ? "과거의 역할이 현재의 길이 되었습니다." : "The role you left behind became a way forward.");
    const card = queryElement("#success-card");
    if (card) card.hidden = false;
  }
}

function runTapeAtCadence(id: ChamberId, tape: Tape, presentFrames: number[], cadence: number): BrowserRun {
  const simulation = new Simulation(CHAMBERS[id]);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  const checksums = [simulation.checksum()];
  const renderInterval = 1000 / cadence;
  const simulationInterval = 1000 / 30;
  let accumulator = 0;
  let tapeTick = 0;
  while (tapeTick < presentFrames.length && simulation.state.phase === "replay") {
    accumulator += renderInterval;
    while (accumulator + Number.EPSILON >= simulationInterval && tapeTick < presentFrames.length && simulation.state.phase === "replay") {
      const frame = presentFrames[tapeTick];
      if (frame === undefined) break;
      simulation.step(frame);
      checksums.push(simulation.checksum());
      tapeTick += 1;
      accumulator -= simulationInterval;
    }
  }
  return { checksums, success: simulation.state.success, state: simulation.state };
}

function switchChamber(id: ChamberId): void {
  successShownFor = null;
  resetTutorialSignals();
  fxPhase = null;
  queryElement("#success-card")?.setAttribute("hidden", "");
  scene.switchChamber(id);
}

function actorScreenPosition(id: ActorId): { x: number; y: number } | null {
  return scene.actorScreenPosition(id);
}

const browserApi = {
  state: null,
  checksum: "",
  versions: {
    build: BUILD_ID,
    simulation: SIMULATION_VERSION,
    renderer: "Babylon.js",
    babylon: scene.rendererVersion,
  },
  renderer: { name: "babylon", ready: false, context: scene.rendererContext },
} as Window["__I_WAS_SO_I_AM__"];
if (EXPOSE_TEST_API) {
  Object.assign(browserApi, {
    switchChamber,
    rerecord: () => scene.rerecord(),
    loadGolden: (id: ChamberId) => scene.loadTape(goldenFor(id).past),
    runGolden: (id: ChamberId, cadence: number) => {
      const golden = goldenFor(id);
      return runTapeAtCadence(id, golden.past, golden.present, cadence);
    },
    runTape: (id: ChamberId, tape: Tape, presentFrames: number[]) => runTapeAtCadence(id, tape, presentFrames, 60),
    actorScreenPosition,
  });
}
window.__I_WAS_SO_I_AM__ = browserApi;
void scene.whenReady().then(() => {
  browserApi.renderer.ready = true;
}).catch((error: unknown) => {
  browserApi.renderer.error = error instanceof Error ? error.message : String(error);
});

scene.setEventsAdapter({
  onSnapshot: updateUi,
  onChamberChange: (id) => {
    currentId = id;
  },
});
scene.setPaused(true);
const savedProgress = readProgress();
if (savedProgress) {
  locale = savedProgress.locale;
  currentId = savedProgress.nextRoom;
  scene.switchChamber(currentId);
} else {
  scene.switchChamber(FIRST_ROOM);
}

function beginJourney(): void {
  started = true;
  document.body.classList.add("has-started");
  scene.setPaused(false);
  queryElement("#intro-screen")?.setAttribute("hidden", "");
}

queryElement("#play-button")?.addEventListener("click", beginJourney);
queryElement("#pause-button")?.addEventListener("click", () => setPaused(!paused));
queryElement("#resume-button")?.addEventListener("click", () => setPaused(false));
queryElement("#rerecord")?.addEventListener("click", () => scene.rerecord());
queryElement("#touch-rerecord")?.addEventListener("click", () => scene.rerecord());
queryElement("#fold-prompt")?.addEventListener("click", () => scene.foldRecording());
queryElement("#touch-fold")?.addEventListener("click", () => scene.foldRecording());
queryElement("#next")?.addEventListener("click", () => {
  queryElement("#success-card")?.setAttribute("hidden", "");
  const next = ROUTE[ROUTE.indexOf(currentId) + 1];
  if (next) {
    writeProgress(next);
    switchChamber(next);
  } else {
    scene.setPaused(true);
    queryElement("#ending-screen")?.removeAttribute("hidden");
  }
});
queryElement("#title-button")?.addEventListener("click", () => {
  clearProgress();
  queryElement("#ending-screen")?.setAttribute("hidden", "");
  queryElement("#intro-screen")?.removeAttribute("hidden");
  scene.setPaused(true);
  started = false;
  document.body.classList.remove("has-started");
  switchChamber(FIRST_ROOM);
});
document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
  const control = button.dataset.control as "up" | "down" | "left" | "right" | "action";
  const release = (): void => scene.setVirtualControl(control, false);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    scene.setVirtualControl(control, true);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});
document.querySelectorAll<HTMLButtonElement>("[data-setting]").forEach((button) => button.addEventListener("click", () => {
  const setting = button.dataset.setting;
  const value = button.querySelector<HTMLElement>("span");
  if (setting === "locale") {
    locale = locale === "ko" ? "en" : "ko";
    if (value) value.textContent = locale.toUpperCase();
    writeProgress(currentId);
    localize();
    return;
  }
  const active = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(active));
  if (setting === "motion") document.body.classList.toggle("reduce-motion", active);
  if (setting === "contrast") document.body.classList.toggle("high-contrast", active);
  if (setting === "mute") document.body.classList.toggle("muted", active);
  if (value) {
    if (setting === "contrast") {
      value.textContent = active ? "ON" : "OFF";
    } else {
      value.textContent = active ? "OFF" : "ON";
    }
  }
}));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && started) setPaused(!paused);
  const activationKeys = ["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"];
  if (!started && activationKeys.includes(event.key)) beginJourney();
});
window.addEventListener("blur", () => scene.resetInput());
localize();
