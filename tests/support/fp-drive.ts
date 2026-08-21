import { encodeFrame, type Frame, type Intent } from "../../src/sim/input";
import type { Simulation } from "../../src/sim/simulation";
import type { ActorId, ActorState, SimState } from "../../src/sim/types";

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

export function drive(simulation: Simulation, frames: readonly Frame[]): string[] {
  const checksums: string[] = [];
  for (const frame of frames) checksums.push(simulation.step(frame).checksum);
  return checksums;
}

export function actorOf(state: SimState | Readonly<SimState>, id: ActorId): ActorState {
  const actor = state.actors.find((candidate) => candidate.id === id);
  if (!actor) throw new Error(`No ${id} actor in phase ${state.phase}`);
  return actor;
}

export function doorOpen(state: SimState | Readonly<SimState>, id: string): boolean {
  return state.doors.find((door) => door.id === id)?.open ?? false;
}

/**
 * The recording a player makes in Awakening: walk to the plate, come to a stop
 * on it, wait for the door to move, then fold. Written as holds rather than a
 * frame dump so the intent survives a tuning change.
 *
 * The standing beat is longer than it needs to be to stop the actor, because
 * 00's door waits 0.6 s before it opens. Standing there long enough to see it
 * move is the room's whole lesson, and it is what the player is doing when they
 * glance back.
 */
export const WALK_TO_PLATE: Hold[] = [
  { forward: true, ticks: 38 },
  { ticks: 30 },
];
