import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { createTape } from "../core/replay";
import type { ChamberDefinition, ChamberId, Tape } from "../core/types";
import {
  CROSSING_CHAMBER,
  HANDOFF_CHAMBER,
  LAST_HOLD_CHAMBER,
  TRACE_WEIGHT_CHAMBER,
} from "./chambers";

export interface GoldenSolution {
  past: Tape;
  present: InputFrame[];
}

function repeat(frame: InputFrame, count: number): InputFrame[] {
  return Array.from({ length: count }, () => frame);
}

function pad(frames: InputFrame[], duration: number): InputFrame[] {
  return [
    ...frames.slice(0, duration),
    ...repeat(NEUTRAL_INPUT, Math.max(0, duration - frames.length)),
  ];
}

export function traceWeightGolden(chamber: ChamberDefinition = TRACE_WEIGHT_CHAMBER): GoldenSolution {
  const push = encodeInput({ right: true, actionHeld: true });
  const pastFrames = pad([
    ...repeat(encodeInput({ right: true }), 20),
    ...repeat(encodeInput({ actionHeld: true }), 52),
    encodeInput({ right: true, actionReleased: true }),
    ...repeat(encodeInput({ right: true }), 47),
    ...repeat(push, chamber.tapeDurationTicks - 120),
  ], chamber.tapeDurationTicks);
  const presentFrames = pad([
    ...repeat(encodeInput({ right: true }), 72),
    encodeInput({ right: true, actionReleased: true }),
    ...repeat(push, 92),
    encodeInput({ up: true, actionReleased: true }),
    ...repeat(encodeInput({ up: true }), 14),
    ...repeat(encodeInput({ right: true }), 18),
    ...repeat(encodeInput({ down: true }), 14),
  ], chamber.tapeDurationTicks);
  return { past: createTape(chamber, pastFrames), present: presentFrames };
}

function holdGolden(chamber: ChamberDefinition, approachTicks: number): GoldenSolution {
  const pastFrames = pad([
    ...repeat(encodeInput({ right: true }), approachTicks),
    ...repeat(encodeInput({ actionHeld: true }), chamber.tapeDurationTicks - approachTicks),
  ], chamber.tapeDurationTicks);
  const presentFrames = pad(repeat(encodeInput({ right: true }), 120), chamber.tapeDurationTicks);
  return { past: createTape(chamber, pastFrames), present: presentFrames };
}

export function crossingGolden(chamber: ChamberDefinition = CROSSING_CHAMBER): GoldenSolution {
  return holdGolden(chamber, 24);
}

export function handoffGolden(chamber: ChamberDefinition = HANDOFF_CHAMBER): GoldenSolution {
  const carry = encodeInput({ right: true, actionHeld: true });
  const pastFrames = pad(repeat(carry, 130), chamber.tapeDurationTicks);
  const presentFrames = pad([
    ...repeat(carry, 49),
    ...repeat(encodeInput({ up: true, actionHeld: true }), 21),
    ...repeat(carry, 43),
    ...repeat(encodeInput({ up: true, actionReleased: true }), 2),
    ...repeat(encodeInput({ right: true }), 18),
  ], chamber.tapeDurationTicks);
  return { past: createTape(chamber, pastFrames), present: presentFrames };
}

export function lastHoldGolden(chamber: ChamberDefinition = LAST_HOLD_CHAMBER): GoldenSolution {
  return holdGolden(chamber, 28);
}

export function goldenFor(chamberId: ChamberId): GoldenSolution {
  switch (chamberId) {
    case "traceWeight": return traceWeightGolden();
    case "crossing": return crossingGolden();
    case "handoff": return handoffGolden();
    case "lastHold": return lastHoldGolden();
  }
}
