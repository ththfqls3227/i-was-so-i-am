import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { Simulation } from "../core/simulation";
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

/**
 * Author a past tape the way a player does: drive the recording simulation
 * with the given frames, then fold time. Every golden therefore exercises
 * Simulation.foldRecording (early cut + ActionHeld-only fill) instead of a
 * hand-padded, frame-precise full-length tape.
 */
export function recordFoldedTape(chamber: ChamberDefinition, frames: InputFrame[]): Tape {
  const simulation = new Simulation(chamber);
  for (const frame of frames) simulation.step(frame);
  if (!simulation.foldRecording()) {
    throw new Error(`Golden recording for ${chamber.id} cannot fold at ${frames.length} ticks`);
  }
  const tape = simulation.tape;
  if (!tape) throw new Error(`Golden tape missing for ${chamber.id}`);
  return tape;
}

const right = encodeInput({ right: true });
const up = encodeInput({ up: true });
const down = encodeInput({ down: true });
const holdStill = encodeInput({ actionHeld: true });
const pushRight = encodeInput({ right: true, actionHeld: true });
const pushLeft = encodeInput({ left: true, actionHeld: true });
const carryUp = encodeInput({ up: true, actionHeld: true });

export function crossingGolden(chamber: ChamberDefinition = CROSSING_CHAMBER): GoldenSolution {
  const past = recordFoldedTape(chamber, [
    ...repeat(right, 24), // walk to the winch (acquire radius leaves ~2 ticks of slack)
    ...repeat(holdStill, 36), // grip for 1.2 s, then fold — the fill keeps holding
  ]);
  const present = pad(repeat(right, 120), chamber.tapeDurationTicks);
  return { past, present };
}

export function traceWeightGolden(chamber: ChamberDefinition = TRACE_WEIGHT_CHAMBER): GoldenSolution {
  const past = recordFoldedTape(chamber, [
    ...repeat(right, 20), // reach the winch
    ...repeat(holdStill, 60), // hold while the present crosses and latches (~30 needed, +1 s margin)
    ...repeat(right, 52), // cross the latched bridge to the weight's left face
    ...repeat(pushRight, 15), // engage the weight, then fold mid-push
  ]);
  const present = pad([
    ...repeat(right, 72), // cross the held bridge (latching it) and reach the weight
    ...repeat(pushRight, 110), // push alone (force 1) until the past joins, then together
    ...repeat(up, 16),
    ...repeat(right, 20),
    ...repeat(down, 17), // walk around the seated weight into the exit
  ], chamber.tapeDurationTicks);
  return { past, present };
}

export function handoffGolden(chamber: ChamberDefinition = HANDOFF_CHAMBER): GoldenSolution {
  const past = recordFoldedTape(chamber, [
    ...repeat(pushRight, 50), // lift the carrier and stage it at the junction (+margin)
    ...repeat(up, 21), // release, climb toward the gate switch
    ...repeat(holdStill, 20), // grip the switch, then fold — the gate stays open
  ]);
  const present = pad([
    ...repeat(right, 46), // walk to the junction while the past stages
    ...repeat(NEUTRAL_INPUT, 6), // wait out the staging with margin
    ...repeat(holdStill, 4), // receive the staged carrier
    ...repeat(carryUp, 22), // redirect onto the upper route
    ...repeat(pushRight, 45), // carry through the opened gate into the delivery cradle
    ...repeat(right, 22), // release and step into the exit light
  ], chamber.tapeDurationTicks);
  return { past, present };
}

export function lastHoldGolden(chamber: ChamberDefinition = LAST_HOLD_CHAMBER): GoldenSolution {
  const past = recordFoldedTape(chamber, [
    ...repeat(right, 50), // pass the handle to the stone's right flank
    ...repeat(down, 18),
    ...repeat(pushLeft, 45), // seat the stone into the gap (~34 needed, +margin)
    ...repeat(right, 2),
    ...repeat(up, 18),
    ...repeat(right, 12), // return to the final door's handle
    ...repeat(holdStill, 20), // grip it, then fold — the past stays here forever
  ]);
  const present = pad(repeat(right, 250), chamber.tapeDurationTicks);
  return { past, present };
}

export function goldenFor(chamberId: ChamberId): GoldenSolution {
  switch (chamberId) {
    case "traceWeight": return traceWeightGolden();
    case "crossing": return crossingGolden();
    case "handoff": return handoffGolden();
    case "lastHold": return lastHoldGolden();
  }
}
