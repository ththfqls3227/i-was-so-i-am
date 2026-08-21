import { encodeFrame, type Frame, type Intent } from "../sim/input";
import { Simulation } from "../sim/simulation";
import type { RoomDefinition, Tape } from "../sim/types";

/** A run of identical frames — how a held key actually reaches the tick loop. */
export interface Hold extends Intent {
  ticks: number;
}

export function framesFor(holds: readonly Hold[]): Frame[] {
  const frames: Frame[] = [];
  for (const hold of holds) {
    const { ticks, ...intent } = hold;
    const frame = encodeFrame(intent);
    for (let index = 0; index < ticks; index += 1) frames.push(frame);
  }
  return frames;
}

/**
 * The recording each room is designed around, written as intent rather than as
 * a frame dump so it survives a tuning change.
 *
 * These ship because the corridor at the end needs them. It shows you what you
 * left in every room you played, and a player can reach it having skipped
 * rooms, replayed rooms, or arrived through the chamber select. Every window
 * has to have somebody in it, so the room's own recording stands in for the one
 * that was never made — silently, because in a diorama seen through a lattice
 * from three metres away the postures converge anyway.
 */
export const GOLDEN_RECORDINGS: Readonly<Record<string, readonly Hold[]>> = {
  // Walk to the plate, stand until the door has moved, fold.
  awakening: [{ forward: true, ticks: 38 }, { ticks: 30 }],
  // The plate ignores you while you are the one standing on it. Stand there
  // anyway — that is the recording.
  "second-self": [{ forward: true, ticks: 38 }, { ticks: 24 }],
  // Walk to the pillar, take hold, end the recording holding it.
  "holding-hand": [{ forward: true, ticks: 8 }, { act: true, ticks: 40 }],
  // Walk into the shut doorway and keep walking. Nothing here can open it.
  "hand-not-body": [{ forward: true, ticks: 70 }],
  // Take the grip on the ground floor and end the recording holding it.
  "two-of-us": [{ forward: true, ticks: 30 }, { act: true, ticks: 40 }],
  // Stand a long time on the first plate, then walk to the second and stop.
  "long-standing": [
    { forward: true, left: true, ticks: 32 },
    { ticks: 150 },
    { right: true, ticks: 50 },
    { ticks: 12 },
  ],
  // The same recording 03 taught: walk at the shut doorway and keep walking.
  "giving-back": [{ forward: true, ticks: 220 }],
  // Forward and gripping at once — the tail that causes accidents elsewhere.
  unkept: [{ forward: true, act: true, ticks: 80 }],
  // 09 is 02 again, because that is the point of it.
  "last-hold": [{ forward: true, ticks: 8 }, { act: true, ticks: 40 }],
};

/**
 * Play a room's own recording and hand back the tape it folds into.
 *
 * Built by running the simulation rather than by writing frames straight into a
 * Tape, so a golden that no longer solves its room is a golden that fails to
 * build — there is no way for these to drift quietly out of date.
 */
export function goldenTape(room: RoomDefinition): Tape | null {
  const holds = GOLDEN_RECORDINGS[room.id];
  if (!holds) return null;
  const simulation = new Simulation(room);
  for (const frame of framesFor(holds)) simulation.step(frame);
  if (!simulation.fold()) return null;
  return simulation.currentTape;
}
