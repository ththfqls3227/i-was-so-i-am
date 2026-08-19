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
  version: 1,
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
  version: 1,
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
  version: 1,
  name: "HANDOFF",
  subtitle: "과거가 가져온 기억의 방향을 현재가 바꾸어 이어갑니다.",
  hint: "과거로 운반체를 접점까지 보내세요. 현재는 이어받아 위쪽 길로 꺾은 뒤 봉인 지점까지 옮기세요.",
  tapeDurationTicks: 10 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(48, 15, 2, 28),
  ],
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
  version: 1,
  name: "LAST HOLD",
  subtitle: "마지막 메아리가 문을 붙드는 동안 현재만이 앞으로 나아갑니다.",
  hint: "과거를 마지막 고정점에 남기고, 현재로 최종 문을 통과하세요.",
  tapeDurationTicks: 8 * TICK_RATE,
  world: { width: scalePosition(80), height: scalePosition(45) },
  spawn: { x: scalePosition(10), y: scalePosition(22) },
  walls: [
    ...createBoundaryWalls(80, 45),
    createRect(43, 2, 2, 15),
    createRect(43, 28, 2, 15),
  ],
  door: { id: "last-door", rect: createRect(43, 17, 2, 11), open: false, blocksPast: true },
  hold: { id: "last-echo-hold", x: scalePosition(28), y: scalePosition(22), radius: scalePosition(3.2), active: false, creditedActors: [], requiredActor: "past" },
  exit: { id: "last-exit", ...createRect(70, 17, 6, 10), open: true },
};

export const CHAMBERS: Record<ChamberId, ChamberDefinition> = {
  traceWeight: TRACE_WEIGHT_CHAMBER,
  crossing: CROSSING_CHAMBER,
  handoff: HANDOFF_CHAMBER,
  lastHold: LAST_HOLD_CHAMBER,
};
