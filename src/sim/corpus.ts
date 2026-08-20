import { encodeFrame, type Intent } from "./input";
import { Simulation } from "./simulation";
import type { RoomDefinition } from "./types";

/**
 * The replay corpus: one deliberately awkward run, held to the same checksums in
 * every engine that ships the game.
 *
 * Diagonals, turns at yaw values that are not round numbers, a jump, a held
 * grip and a full stop — anything that rounds differently anywhere will move a
 * checksum. This is what makes the claim behind the whole rebuild testable: a
 * tape means the same thing on every machine, so the second pass a player
 * records is the second pass everyone else sees.
 */
export interface CorpusStep {
  ticks: number;
  intent: Intent;
}

export const CORPUS: readonly CorpusStep[] = [
  { ticks: 24, intent: { forward: true, yawUnits: 0 } },
  { ticks: 18, intent: { forward: true, right: true, yawUnits: 377 } },
  { ticks: 9, intent: { forward: true, jump: true, yawUnits: 1013 } },
  { ticks: 22, intent: { back: true, left: true, yawUnits: 2731 } },
  { ticks: 16, intent: { forward: true, act: true, yawUnits: 4091 } },
  { ticks: 20, intent: { yawUnits: 4091 } },
  { ticks: 40, intent: { forward: true, yawUnits: 55 } },
];

export function runCorpus(room: RoomDefinition): string[] {
  const simulation = new Simulation(room);
  const checksums: string[] = [];
  for (const step of CORPUS) {
    const frame = encodeFrame(step.intent);
    for (let index = 0; index < step.ticks; index += 1) checksums.push(simulation.step(frame).checksum);
  }
  return checksums;
}
