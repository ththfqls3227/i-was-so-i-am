import { POSITION_SCALE, TICK_RATE, type ChamberDefinition, type ChamberId, type Rect } from "../core/types";

function scalePosition(value: number): number {
  return value * POSITION_SCALE;
}

function createRect(x: number, y: number, width: number, height: number): Rect {
  return {
    x: scalePosition(x),
    y: scalePosition(y),
    width: scalePosition(width),
    height: scalePosition(height),
  };
}

function createBoundaryWalls(width: number, height: number): Rect[] {
  return [
    createRect(0, 0, width, 2),
    createRect(0, height - 2, width, 2),
    createRect(0, 0, 2, height),
    createRect(width - 2, 0, 2, height),
  ];
}

export const AWAKENING_CHAMBER: ChamberDefinition = {
  id: "awakening",
  version: 1,
  name: "AWAKENING",
  subtitle: "발판을 밟으면 문이 열립니다. 기록과 재생을 한 번 겪어보세요.",
  hint: "발판 위로 올라서면 문이 열립니다. 문을 지나 빛으로 나가세요.",
  tapeDurationTicks: 5 * TICK_RATE,
  world: { width: scalePosition(60), height: scalePosition(36) },
  spawn: { x: scalePosition(8), y: scalePosition(18) },
  walls: [
    ...createBoundaryWalls(60, 36),
    createRect(38, 2, 2, 12),
    createRect(38, 25, 2, 9),
  ],
  // A one-way release: the plate unlatches this door rather than holding it up,
  // so a single self can press it and walk on through. Chamber 00 asks for no
  // cooperation at all — it only teaches the loop.
  door: { id: "awakening-door", rect: createRect(38, 14, 2, 11), open: false, gatedBy: "plate", latchOnOpen: true },
  plate: { id: "awakening-plate", ...createRect(20, 13, 9, 9), active: false, pressedBy: [] },
  exit: { id: "awakening-exit", ...createRect(48, 14, 8, 11), open: true },
};

export const SECOND_SELF_CHAMBER: ChamberDefinition = {
  id: "secondSelf",
  version: 1,
  name: "SECOND SELF",
  subtitle: "메아리가 발판 위에 서 있는 동안에만 문이 열립니다.",
  hint: "1회차에 발판 위에 선 채로 기록을 끝내고, 2회차에 열린 문을 지나세요.",
  tapeDurationTicks: 6 * TICK_RATE,
  world: { width: scalePosition(64), height: scalePosition(40) },
  spawn: { x: scalePosition(8), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(64, 40),
    createRect(36, 2, 2, 16),
    createRect(36, 29, 2, 9),
  ],
  door: { id: "second-self-door", rect: createRect(36, 18, 2, 11), open: false, gatedBy: "plate" },
  // Only the echo's weight counts, so the door cannot be opened by the self that
  // needs to walk through it: the smallest possible piece of cooperation.
  plate: { id: "second-self-plate", ...createRect(14, 5, 10, 9), active: false, pressedBy: [], requiredActor: "past" },
  exit: { id: "second-self-exit", ...createRect(48, 18, 8, 11), open: true },
};

export const HAND_NOT_BODY_CHAMBER: ChamberDefinition = {
  id: "handNotBody",
  version: 1,
  name: "HAND, NOT BODY",
  subtitle: "기록되는 것은 위치가 아니라 입력입니다.",
  hint: "닫힌 문에 막힌 채로 계속 오른쪽과 행동 키를 누르세요. 2회차에 발판을 밟아 메아리의 길을 열어주세요.",
  tapeDurationTicks: 8 * TICK_RATE,
  world: { width: scalePosition(56), height: scalePosition(40) },
  spawn: { x: scalePosition(8), y: scalePosition(20) },
  walls: [
    ...createBoundaryWalls(56, 40),
    createRect(28, 2, 2, 14),
    createRect(28, 27, 2, 11),
  ],
  door: { id: "hand-door", rect: createRect(28, 16, 2, 11), open: false, gatedBy: "plate" },
  // The living body is the only weight this plate answers to — during the
  // recording the past walks straight over it and the door stays shut, which is
  // exactly the lesson the room is built to teach.
  plate: { id: "hand-plate", ...createRect(6, 4, 13, 10), active: false, pressedBy: [], requiredActor: "present" },
  // Seated against the far wall: an echo that keeps walking right ends up
  // pressed into the switch rather than past it, so every recorded tick beyond
  // the one it arrives on is slack rather than an overshoot.
  hold: { id: "hand-switch", x: scalePosition(51), y: scalePosition(20), radius: scalePosition(3.6), active: false, creditedActors: [] },
  exitGate: "hold",
  exit: { id: "hand-exit", ...createRect(5, 27, 9, 9), open: false },
};

export const TRACE_WEIGHT_CHAMBER: ChamberDefinition = {
  id: "traceWeight",
  version: 2,
  name: "TRACE WEIGHT",
  subtitle: "과거가 길을 열고, 다시 합류한 두 자아가 기억의 무게를 밉니다.",
  hint: "과거로 윈치를 붙잡아 현재를 건넌 뒤, 추 앞에서 두 힘을 합치세요.",
  tapeDurationTicks: 10 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(35, 2, 2, 15),
    createRect(35, 28, 2, 15),
  ],
  door: {
    id: "trace-bridge",
    rect: createRect(35, 17, 2, 11),
    open: false,
    latchWhenPresentBeyondX: scalePosition(39),
    latched: false,
  },
  hold: { id: "trace-winch", x: scalePosition(24), y: scalePosition(22), radius: scalePosition(3.2), active: false, creditedActors: [] },
  forceObject: {
    id: "trace-weight",
    ...createRect(54, 17, 8, 10),
    axis: "x",
    minX: scalePosition(54),
    maxX: scalePosition(64),
    threshold: 2,
    force: 0,
  },
  exitGate: "force",
  exit: { id: "trace-weight-exit", ...createRect(70, 17, 6, 10), open: false },
};

export const CROSSING_CHAMBER: ChamberDefinition = {
  id: "crossing",
  version: 2,
  name: "CROSSING",
  subtitle: "과거가 윈치를 붙잡는 동안 현재가 끊어진 길을 건넙니다.",
  hint: "과거는 윈치를 계속 잡고, 현재는 열린 다리를 건너세요.",
  tapeDurationTicks: 8 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(39, 2, 2, 15),
    createRect(39, 28, 2, 15),
  ],
  door: { id: "crossing-bridge", rect: createRect(39, 17, 2, 11), open: false },
  hold: { id: "crossing-winch", x: scalePosition(26), y: scalePosition(22), radius: scalePosition(3.2), active: false, creditedActors: [] },
  exit: { id: "crossing-exit", ...createRect(70, 17, 6, 10), open: true },
};

export const HANDOFF_CHAMBER: ChamberDefinition = {
  id: "handoff",
  version: 3,
  name: "HANDOFF",
  subtitle: "과거가 개폐기를 붙들어 전달구를 열어 두는 동안, 현재가 상자를 옮깁니다.",
  hint: "1회차에는 위쪽 개폐기를 붙든 채로 기록을 끝내고, 2회차에는 받침대의 상자를 들고 열린 전달구로 옮기세요.",
  tapeDurationTicks: 10 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(48, 2, 2, 14),
    createRect(48, 28, 2, 15),
  ],
  door: { id: "handoff-gate", rect: createRect(48, 16, 2, 12), open: false, gatedBy: "hold" },
  hold: { id: "handoff-switch", x: scalePosition(20), y: scalePosition(8), radius: scalePosition(3.2), active: false, creditedActors: [] },
  handoff: {
    id: "memory-carrier",
    x: scalePosition(20),
    y: scalePosition(34),
    radius: scalePosition(2.6),
    // The box sits on its pedestal from the first tick. Only the living hand can
    // lift it, so the recording pass has exactly one job — hold the gate.
    carriedBy: ["present"],
    delivery: createRect(60, 15, 8, 10),
    holder: null,
    carriedByPresent: false,
    delivered: false,
  },
  exitGate: "handoff",
  exit: { id: "handoff-exit", ...createRect(72, 16, 6, 10), open: false },
};

export const LAST_HOLD_CHAMBER: ChamberDefinition = {
  id: "lastHold",
  version: 2,
  name: "LAST HOLD",
  subtitle: "과거가 다리를 놓고 문을 붙드는 동안, 현재만이 앞으로 나아갑니다.",
  hint: "과거로 돌덩이를 왼쪽 틈에 밀어 넣고 마지막 문의 손잡이를 붙드세요. 현재는 다리를 건너 문 너머 출구로 나아가세요.",
  tapeDurationTicks: 10 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(43, 2, 2, 15),
    createRect(43, 28, 2, 15),
  ],
  door: { id: "last-door", rect: createRect(43, 17, 2, 11), open: false, blocksPast: true },
  hold: { id: "last-echo-hold", x: scalePosition(38), y: scalePosition(22), radius: scalePosition(3.2), active: false, creditedActors: [], requiredActor: "past" },
  forceObject: {
    id: "last-bridge-stone",
    ...createRect(30, 29, 8, 9),
    axis: "x",
    minX: scalePosition(20),
    maxX: scalePosition(30),
    threshold: 1,
    force: 0,
    pushDirection: "left",
  },
  exitGate: "force",
  exit: { id: "last-exit", ...createRect(70, 17, 6, 10), open: false },
};

export const CHAMBERS: Record<ChamberId, ChamberDefinition> = {
  awakening: AWAKENING_CHAMBER,
  secondSelf: SECOND_SELF_CHAMBER,
  crossing: CROSSING_CHAMBER,
  handNotBody: HAND_NOT_BODY_CHAMBER,
  traceWeight: TRACE_WEIGHT_CHAMBER,
  handoff: HANDOFF_CHAMBER,
  lastHold: LAST_HOLD_CHAMBER,
};
