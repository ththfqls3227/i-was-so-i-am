import { AWAKENING } from "../../src/world/room";
import type { GateRef, HoldSpec, PlateSpec, RoomDefinition } from "../../src/sim/types";

/**
 * Synthetic rooms for mechanism tests. They borrow Awakening's shell — a sealed
 * box with a door and a corridor — and swap only the mechanism under test, so a
 * failure is about the mechanism and never about geometry.
 */
export function roomWith(overrides: Partial<RoomDefinition>): RoomDefinition {
  return { ...AWAKENING, id: "test-room", version: 1, ...overrides };
}

/** Two metres in front of spawn, at chest height: inside the gaze cone from the start. */
export const PILLAR: HoldSpec = {
  id: "pillar",
  at: { x: 0, y: 1.2, z: 3.6 },
  releaseRadius: 3,
};

export const SECOND_PILLAR: HoldSpec = {
  id: "second-pillar",
  at: { x: 2.2, y: 1.2, z: 3.6 },
  releaseRadius: 3,
};

export const ENTRY_PLATE: PlateSpec = {
  id: "entry-plate",
  centre: { x: 0, z: 7.6 },
  half: { x: 0.95, z: 0.95 },
  reach: 0.35,
};

/** A second plate beside the first, close enough that one run can reach both. */
export const FAR_PLATE: PlateSpec = {
  id: "far-plate",
  centre: { x: 3.2, z: 7.6 },
  half: { x: 0.95, z: 0.95 },
  reach: 0.35,
};

/**
 * Awakening's doorway, rewired for a mechanism test.
 *
 * The delay is explicitly cleared rather than inherited: 00's door waits a beat
 * for narrative reasons, and a synthetic room testing grips should not silently
 * pick up a timing choice made three chambers away. Tests that want a delay ask
 * for one.
 */
export function door(gatedBy: GateRef, latchOnOpen = false): RoomDefinition["doors"][number] {
  const original = AWAKENING.doors[0];
  if (!original) throw new Error("Awakening has no door to borrow");
  // closeDelayTicks for the same reason as openDelayTicks, and it is the second
  // time this spread has leaked one of 00's timings into every synthetic room:
  // 00 buys its plate-to-doorway walk with a three-second closing grace, and a
  // grip room that inherits it watches a released door stay open for ninety
  // ticks. Any timing field added to DoorSpec has to be zeroed here too.
  return { ...original, gatedBy, latchOnOpen, openDelayTicks: 0, closeDelayTicks: 0 };
}
