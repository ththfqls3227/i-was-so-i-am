import "./style.css";
import { Simulation } from "./core/simulation";
import { SIMULATION_VERSION, type ActorId, type ChamberId, type FailureCode, type SimulationState, type Tape } from "./core/types";
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
  "door-closed": { ko: "문이 닫혔습니다 — 과거가 더 오래 붙들도록 기록하세요.", en: "The door closed. Record your past holding on longer." },
  "hold-released-early": { ko: "과거가 손을 너무 일찍 놓았습니다 — 붙든 채로 시간을 접으세요.", en: "Your past let go too early. Fold time while still holding." },
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
    controls: "방향키 / WASD 이동 · Space / E 행동 · R 다시 기록 · Esc 일시정지",
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
    controls: "Arrows / WASD move · Space / E act · R rerecord · Esc pause",
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
      <p id="hint" class="hint"></p>
      <p class="controls" id="controls"></p>
      <button class="rerecord" id="rerecord">↺ <span>다시 기록</span> <kbd>R</kbd></button>
      ${debugDetails}
    </aside>
    <nav class="touch-controls" aria-label="터치 게임 조작">
      <div class="dpad"><button data-control="up" aria-label="위">↑</button><button data-control="left" aria-label="왼쪽">←</button><button data-control="down" aria-label="아래">↓</button><button data-control="right" aria-label="오른쪽">→</button></div>
      <button class="touch-action" data-control="action" aria-label="행동 버튼, 길게 누르기">길게<br>누르기</button><button class="touch-reset" id="touch-rerecord" aria-label="다시 기록">↺</button>
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
  if (node) node.textContent = value;
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

function distanceToPoint(actor: SimulationState["actors"][number], x: number, y: number): number {
  return Math.hypot(actor.x - x, actor.y - y);
}

function inputLabel(kind: "move" | "act" | "release" | "reset"): { key: string; action: string } {
  const touch = navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
  if (kind === "move") return { key: touch ? "방향 버튼" : "방향키 / WASD", action: "이동" };
  if (kind === "act") return { key: touch ? "ACT" : "SPACE / E", action: "누르고 있기" };
  if (kind === "release") return { key: touch ? "ACT" : "SPACE / E", action: "손 떼기" };
  return { key: touch ? "↺" : "R", action: "처음부터 다시 기록" };
}

function tutorialInput(kind: "move" | "act" | "release" | "reset"): Pick<TutorialMessage, "key" | "action"> {
  return inputLabel(kind);
}

function crossingTutorial(state: Readonly<SimulationState>, korean: boolean): TutorialMessage {
  const actor = state.actors.find((candidate) => candidate.id === "present") ?? state.actors[0];
  const hold = state.hold;
  const move = tutorialInput("move");
  const act = tutorialInput("act");
  const reset = tutorialInput("reset");
  if (!actor || !hold) {
    return {
      stage: "crossing-find",
      pass: korean ? "1회차 · 과거 행동 기록 중" : "PASS 1 · RECORDING",
      step: "1 / 2",
      title: korean ? "황금 표식이 있는 윈치로 가세요" : "Go to the winch under the gold marker",
      body: korean ? "지금 움직임은 잠시 뒤 청록색 과거의 내가 그대로 반복합니다." : "The cyan past self will repeat this movement shortly.",
      ...move,
      checklist: [],
    };
  }
  if (state.phase === "recording") {
    const closeEnough = distanceToPoint(actor, hold.x, hold.y) <= hold.radius + 10;
    if (!closeEnough) {
      return {
        stage: "crossing-move-winch",
        pass: korean ? "1회차 · 과거 행동 기록" : "PASS 1 · RECORD",
        step: "1 / 3",
        title: korean ? "황금 표식의 윈치까지 이동하세요" : "Move to the marked winch",
        body: korean ? "아직 탈출하는 차례가 아닙니다. 미래의 나를 도울 행동을 먼저 남깁니다." : "Do not escape yet. First leave an action that will help your future self.",
        ...move,
        checklist: [
          { text: korean ? "윈치까지 이동" : "Reach the winch", state: "active" },
          { text: korean ? "윈치를 1초간 붙들기" : "Hold the winch for one second", state: "next" },
          { text: korean ? "2회차에 다리 건너기" : "Cross during pass 2", state: "next" },
        ],
      };
    }
    if (!hold.active) {
      return {
        stage: "crossing-grab-winch",
        pass: korean ? "1회차 · 과거 행동 기록" : "PASS 1 · RECORD",
        step: "2 / 3",
        title: korean ? "윈치에서 행동 키를 1초만 누르세요" : "Hold the action key for one second",
        body: korean ? "짧은 금색 게이지가 차면 즉시 시간이 접힙니다. 오래 기다릴 필요가 없습니다." : "Time folds as soon as the short gold gauge fills. There is no long wait.",
        ...act,
        checklist: [
          { text: korean ? "윈치까지 이동" : "Reach the winch", state: "done" },
          { text: korean ? "윈치를 1초간 붙들기" : "Hold the winch for one second", state: "active" },
          { text: korean ? "2회차에 다리 건너기" : "Cross during pass 2", state: "next" },
        ],
      };
    }
    return {
      stage: "crossing-hold-winch",
      pass: korean ? "1회차 · 행동을 기억에 새기는 중" : "PASS 1 · SAVING THE ACTION",
      step: "2 / 3",
      title: korean ? "좋아요. 딱 1초만 유지하세요" : "Good. Hold for just one second",
      body: korean ? "금색 게이지가 차는 즉시 과거의 내가 이 행동을 이어받습니다." : "As soon as the gold gauge fills, your past self takes over this action.",
      ...act,
      checklist: [
        { text: korean ? "윈치까지 이동" : "Reach the winch", state: "done" },
        { text: korean ? "윈치를 1초간 붙들기" : "Hold the winch for one second", state: "active" },
        { text: korean ? "2회차에 다리 건너기" : "Cross during pass 2", state: "next" },
      ],
    };
  }
  if (state.phase === "rerecord") {
    return {
      stage: "crossing-recover",
      pass: korean ? "다시 기록이 필요합니다" : "RERECORD NEEDED",
      step: "복구",
      title: korean ? "과거가 윈치를 끝까지 붙들지 못했습니다" : "Your past did not hold the winch long enough",
      body: korean ? "R을 누른 뒤 윈치 옆에서 행동 키를 계속 누르고 계세요." : "Press R, then keep holding the action key beside the winch.",
      ...reset,
      checklist: [
        { text: korean ? "R로 즉시 다시 시작" : "Restart immediately with R", state: "active" },
      ],
    };
  }
  const present = state.actors.find((candidate) => candidate.id === "present");
  const beyondDoor = Boolean(present && state.door && present.x > state.door.rect.x + state.door.rect.width + 15);
  if (state.success) {
    return {
      stage: "crossing-complete",
      pass: korean ? "튜토리얼 완료" : "TUTORIAL COMPLETE",
      step: "완료",
      title: korean ? "혼자였지만, 과거의 나와 함께 해냈습니다" : "You did it with the self you were",
      body: korean ? "다음 방부터는 이 원리를 조금씩 응용합니다." : "The next rooms build on this same rule.",
      key: "✓",
      action: korean ? "다음 기억으로" : "Continue",
      checklist: [
        { text: korean ? "과거의 행동 기록" : "Record the past", state: "done" },
        { text: korean ? "과거와 함께 다리 건너기" : "Cross with the past", state: "done" },
      ],
    };
  }
  if (!hold.active && !beyondDoor) {
    return {
      stage: "crossing-replay-failed",
      pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING",
      step: "2 / 2",
      title: korean ? "다리가 닫혔습니다. 기록을 고쳐야 합니다" : "The bridge closed. Fix the recording",
      body: korean ? "1회차에 윈치 옆에서 행동 키를 더 오래 누르세요." : "During pass 1, hold the action key longer beside the winch.",
      ...reset,
      checklist: [
        { text: korean ? "청록색 과거가 윈치 붙들기" : "Past holds the winch", state: "next" },
        { text: korean ? "현재의 나는 오른쪽으로 건너기" : "Present crosses right", state: "next" },
      ],
    };
  }
  return {
    stage: beyondDoor ? "crossing-enter-exit" : "crossing-cross-bridge",
    pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING",
    step: "3 / 3",
    title: beyondDoor ? (korean ? "그대로 오른쪽의 빛까지 가세요" : "Continue right into the light") : (korean ? "시간이 접혔습니다. 이제 주황색 현재를 움직이세요" : "Time folded. Now move the amber present self"),
    body: korean ? "청록색 과거가 윈치를 계속 붙듭니다. 주황색 현재로 오른쪽 다리를 건너세요." : "The cyan past keeps holding the winch. Move the amber present across the bridge to the right.",
    ...move,
    checklist: [
      { text: korean ? "청록색 과거가 윈치 붙들기" : "Past holds the winch", state: "done" },
      { text: korean ? "현재의 나는 다리 건너기" : "Present crosses the bridge", state: beyondDoor ? "done" : "active" },
      { text: korean ? "오른쪽 빛으로 들어가기" : "Enter the light on the right", state: beyondDoor ? "active" : "next" },
    ],
  };
}

function tutorialMessage(state: Readonly<SimulationState>): TutorialMessage {
  const korean = locale === "ko";
  if (state.chamberId === "crossing") return crossingTutorial(state, korean);
  if (state.chamberId !== "traceWeight") {
    const input = state.phase === "rerecord" ? tutorialInput("reset") : tutorialInput("act");
    return {
      stage: `${state.chamberId}-${state.phase}`,
      pass: state.phase === "recording" ? (korean ? "1회차 · 과거 행동 기록 중" : "PASS 1 · RECORDING") : (korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING"),
      step: korean ? `기억 ${String(ROUTE.indexOf(state.chamberId) + 1).padStart(2, "0")}` : `MEMORY ${String(ROUTE.indexOf(state.chamberId) + 1).padStart(2, "0")}`,
      title: roomNames[state.chamberId][locale],
      body: failureCopy(state.lastError) ?? CHAMBERS[state.chamberId].hint,
      ...input,
      checklist: [],
    };
  }

  const actor = state.actors.find((candidate) => candidate.id === "present") ?? state.actors[0];
  if (!actor || !state.hold) {
    return { stage: "trace-find", pass: korean ? "1회차 · 계획 기록 중" : "PASS 1 · RECORDING A PLAN", step: "1 / 3", title: korean ? "황금 표식의 윈치를 찾으세요" : "Find the marked winch", body: CHAMBERS.traceWeight.hint, ...tutorialInput("move"), checklist: [] };
  }
  if (state.phase === "recording") {
    const distance = distanceToPoint(actor, state.hold.x, state.hold.y);
    if (distance > 52 && state.tapeTick < 92) {
      return {
        stage: "trace-move-winch",
        pass: korean ? "1회차 · 계획 기록 중" : "PASS 1 · RECORDING A PLAN",
        step: "1 / 3",
        title: korean ? "빛나는 윈치로 이동하세요" : "Move to the glowing winch",
        body: korean ? "먼저 미래의 나에게 남길 행동을 기록합니다. 황금 표식만 따라가세요." : "First record the role your future self will need. Follow the gold marker.",
        ...tutorialInput("move"),
        checklist: [],
      };
    }
    if (state.hold.active && state.tapeTick < 82) {
      return {
        stage: "trace-hold-winch",
        pass: korean ? "1회차 · 계획 기록 중" : "PASS 1 · RECORDING A PLAN",
        step: "1 / 3",
        title: korean ? "윈치를 그대로 붙드세요" : "Keep holding the winch",
        body: korean ? "타이머의 첫 번째 금색 표시까지 행동 키를 누르고 계세요." : "Hold the action key until the first gold mark on the timer.",
        ...tutorialInput("act"),
        checklist: [],
      };
    }
    if (state.tapeTick < 172) {
      return {
        stage: "trace-record-route",
        pass: korean ? "1회차 · 계획 기록 중" : "PASS 1 · RECORDING A PLAN",
        step: "2 / 3",
        title: korean ? "행동 키에서 손을 떼고 오른쪽을 계속 누르세요" : "Release action and keep moving right",
        body: korean ? "지금 문에 막혀도 괜찮습니다. 위치가 아니라 오른쪽 입력이 기록되어, 2회차의 과거는 열린 다리를 건넙니다." : "It is okay to hit the closed door now. The input is recorded, so your past will cross once the bridge opens in pass 2.",
        ...tutorialInput("move"),
        checklist: [],
      };
    }
    return {
      stage: "trace-record-push",
      pass: korean ? "1회차 · 계획 기록 중" : "PASS 1 · RECORDING A PLAN",
      step: "3 / 3",
      title: korean ? "오른쪽을 누른 채 행동 키도 함께 누르세요" : "Keep moving right and hold action too",
      body: korean ? "지금은 벽 앞이어도 괜찮습니다. 2회차에는 과거가 바위까지 가서 이 밀기 행동을 반복합니다." : "The wall is expected now. In pass 2, your past reaches the weight and repeats this push.",
      ...tutorialInput("act"),
      checklist: [],
    };
  }
  if (state.phase === "rerecord") {
    return {
      stage: "trace-recover",
      pass: korean ? "다시 기록이 필요합니다" : "RERECORD NEEDED",
      step: korean ? "다시 계획하기" : "RETHINK",
      title: korean ? "메아리가 사라졌습니다" : "The echo faded",
      body: korean ? "R을 눌러 처음부터 더 나은 행동을 기록하세요." : "Press R and record a better route from the beginning.",
      ...tutorialInput("reset"),
      checklist: [],
    };
  }
  if (state.exit.open) {
    return { stage: "trace-exit", pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING", step: "완료", title: korean ? "빛으로 들어가세요" : "Enter the light", body: korean ? "과거의 힘이 현재의 길이 되었습니다." : "Your past effort became the way forward.", ...tutorialInput("move"), checklist: [] };
  }
  if (!state.door?.latched) {
    return {
      stage: "trace-cross",
      pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING",
      step: korean ? "시간이 접혔습니다" : "TIME FOLDED",
      title: korean ? "과거가 윈치를 붙드는 동안 건너세요" : "Cross while your past holds the winch",
      body: korean ? "청록색 메아리는 방금 기록한 행동을 그대로 반복합니다." : "The cyan echo repeats exactly what you recorded.",
      ...tutorialInput("move"),
      checklist: [],
    };
  }
  if ((state.forceObject?.force ?? 0) < 2) {
    return {
      stage: "trace-push",
      pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING",
      step: "TOGETHER",
      title: korean ? "과거의 나와 함께 미세요" : "Push beside your past self",
      body: korean ? `현재 결합된 힘 ${(state.forceObject?.force ?? 0)} / 2 · 바위 왼쪽에서 같은 방향을 바라보세요.` : `Combined force ${(state.forceObject?.force ?? 0)} / 2 · Face the same way at the left side of the weight.`,
      ...tutorialInput("act"),
      checklist: [],
    };
  }
  return { stage: "trace-pushing", pass: korean ? "2회차 · 과거와 협동 중" : "PASS 2 · COOPERATING", step: "TOGETHER", title: korean ? "두 힘이 하나가 되었습니다" : "Two efforts became one", body: korean ? "행동 키를 놓지 말고 그대로 바위를 끝까지 미세요." : "Keep holding action and push the weight to the end.", ...tutorialInput("act"), checklist: [] };
}

let lastTutorialStage = "";

function updateTutorial(state: Readonly<SimulationState>): void {
  const tutorial = tutorialMessage(state);
  if (tutorial.stage === lastTutorialStage) return;
  lastTutorialStage = tutorial.stage;
  setText("#tutorial-pass", tutorial.pass);
  setText("#tutorial-step", tutorial.step);
  setText("#tutorial-title", tutorial.title);
  setText("#tutorial-copy", tutorial.body);
  setText("#tutorial-key", tutorial.key);
  setText("#tutorial-action-label", tutorial.action);
  document.querySelectorAll<HTMLLIElement>("#tutorial-checklist li").forEach((item, index) => {
    const entry = tutorial.checklist[index];
    item.hidden = !entry;
    if (!entry) return;
    item.textContent = entry.text;
    item.dataset.state = entry.state;
  });
  const card = queryElement("#tutorial-card");
  if (card) {
    card.dataset.phase = state.phase;
    card.dataset.stage = tutorial.stage;
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
  setText("#controls", copy[locale].controls);
  setText("#pause-title", copy[locale].pause);
  setText("#resume-button", copy[locale].resume);
  setText("#next", copy[locale].continue);
  setText("#ending-title", copy[locale].ending);
  setText("#ending-copy", copy[locale].endingBody);
  const state = window.__I_WAS_SO_I_AM__?.state;
  if (state) {
    lastTutorialStage = "";
    setText("#phase-label", phaseCopy(state.phase));
    setText("#chamber-title", roomNames[state.chamberId][locale]);
    updateTutorial(state);
  }
}

function updateUi(state: Readonly<SimulationState>, checksum: string): void {
  const chamber = CHAMBERS[state.chamberId];
  currentId = state.chamberId;
  const index = ROUTE.indexOf(state.chamberId);
  setText("#phase-label", phaseCopy(state.phase));
  setText("#chamber-title", roomNames[state.chamberId][locale]);
  queryElement("#chamber-title")?.setAttribute("data-chamber-id", state.chamberId);
  setText("#chamber-subtitle", chamber.subtitle);
  setText("#hint", failureCopy(state.lastError) ?? chamber.hint);
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
  lastTutorialStage = "";
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
