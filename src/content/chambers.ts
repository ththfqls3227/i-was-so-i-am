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
  version: 2,
  name: "HANDOFF",
  subtitle: "과거가 기억을 내려놓고 전달구를 여는 동안, 현재가 이어받아 옮깁니다.",
  hint: "과거로 상자를 접점에 내려놓고 개폐기를 붙드세요. 현재는 이어받아 위쪽 길로 옮겨 열린 전달구에 넣으세요.",
  tapeDurationTicks: 10 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(48, 15, 2, 28),
  ],
  door: { id: "handoff-gate", rect: createRect(56, 2, 2, 13), open: false },
  hold: { id: "handoff-switch", x: scalePosition(38), y: scalePosition(9), radius: scalePosition(3.2), active: false, creditedActors: [] },
  handoff: {
    id: "memory-carrier",
    x: scalePosition(18),
    y: scalePosition(22),
    radius: scalePosition(2.2),
    junction: { x: scalePosition(38), y: scalePosition(22), radius: scalePosition(2.4) },
    delivery: createRect(61, 6, 7, 9),
    holder: null,
    stagedByPast: false,
    receivedByPresent: false,
    redirectedByPresent: false,
    delivered: false,
  },
  exit: { id: "handoff-exit", ...createRect(71, 6, 5, 9), open: false },
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
  exit: { id: "last-exit", ...createRect(70, 17, 6, 10), open: false },
};

export const CHAMBERS: Record<ChamberId, ChamberDefinition> = {
  traceWeight: TRACE_WEIGHT_CHAMBER,
  crossing: CROSSING_CHAMBER,
  handoff: HANDOFF_CHAMBER,
  lastHold: LAST_HOLD_CHAMBER,
};
