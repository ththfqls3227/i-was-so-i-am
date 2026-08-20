import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { Simulation } from "../core/simulation";
import type { ChamberDefinition, ChamberId, Tape } from "../core/types";
import {
  AWAKENING_CHAMBER,
  CROSSING_CHAMBER,
  HAND_NOT_BODY_CHAMBER,
  HANDOFF_CHAMBER,
  LAST_HOLD_CHAMBER,
  SECOND_SELF_CHAMBER,
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
const upRight = encodeInput({ up: true, right: true });
const downRight = encodeInput({ down: true, right: true });
const holdStill = encodeInput({ actionHeld: true });
const pushRight = encodeInput({ right: true, actionHeld: true });
const pushLeft = encodeInput({ left: true, actionHeld: true });
const carryUpRight = encodeInput({ up: true, right: true, actionHeld: true });

export function awakeningGolden(chamber: ChamberDefinition = AWAKENING_CHAMBER): GoldenSolution {
  // Chamber 00 asks for nothing from the past: whatever it records, the present
  // presses the plate itself. The tape is here only so the loop is rehearsed.
  const past = recordFoldedTape(chamber, repeat(right, 34));
  const present = pad(repeat(right, 90), chamber.tapeDurationTicks);
  return { past, present };
}

export function secondSelfGolden(chamber: ChamberDefinition = SECOND_SELF_CHAMBER): GoldenSolution {
  const past = recordFoldedTape(chamber, [
    ...repeat(upRight, 22), // walk onto the plate
    ...repeat(NEUTRAL_INPUT, 10), // stand on it, then fold — the echo never steps off
  ]);
  const present = pad(repeat(right, 80), chamber.tapeDurationTicks);
  return { past, present };
}

export function handNotBodyGolden(chamber: ChamberDefinition = HAND_NOT_BODY_CHAMBER): GoldenSolution {
  // Pinned against a shut door the whole time: what is recorded is the input,
  // not the standing still it produces here.
  const past = recordFoldedTape(chamber, repeat(pushRight, 78));
  const present = pad([
    ...repeat(up, 14), // stand on the plate and open the echo's corridor
    ...repeat(NEUTRAL_INPUT, 60), // hold it open while the echo walks to the switch
    ...repeat(down, 32), // the switch is gripped and the light is open — go
  ], chamber.tapeDurationTicks);
  return { past, present };
}

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
    ...repeat(upRight, 22), // climb toward the gate switch
    ...repeat(up, 6), // step under it, still looking at it
    ...repeat(holdStill, 20), // grip it, then fold — the delivery gate stays open
  ]);
  const present = pad([
    ...repeat(downRight, 24), // walk down to the carrier's pedestal
    ...repeat(holdStill, 3), // lift it
    ...repeat(carryUpRight, 22), // carry it up to the gate's corridor
    ...repeat(pushRight, 55), // through the held-open gate into the cradle
    ...repeat(right, 30), // release and step into the exit light
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
    case "awakening": return awakeningGolden();
    case "secondSelf": return secondSelfGolden();
    case "crossing": return crossingGolden();
    case "handNotBody": return handNotBodyGolden();
    case "traceWeight": return traceWeightGolden();
    case "handoff": return handoffGolden();
    case "lastHold": return lastHoldGolden();
  }
}
