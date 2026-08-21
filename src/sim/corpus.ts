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

/** First pass. Recorded, then folded — so the last step is also the tail posture. */
export const CORPUS: readonly CorpusStep[] = [
  { ticks: 24, intent: { forward: true, yawUnits: 0 } },
  { ticks: 18, intent: { forward: true, right: true, yawUnits: 377 } },
  { ticks: 9, intent: { forward: true, jump: true, yawUnits: 1013 } },
  { ticks: 22, intent: { back: true, left: true, yawUnits: 2731 } },
  { ticks: 16, intent: { forward: true, act: true, yawUnits: 4091 } },
  { ticks: 20, intent: { yawUnits: 4091 } },
  { ticks: 40, intent: { forward: true, yawUnits: 55 } },
];

/**
 * Second pass, deliberately long enough to run off the end of the tape and
 * through the grace span.
 *
 * This half exists because of a bug it would have caught: `replayFrame` used to
 * hand the echo a neutral frame once the tape ran out, so at that exact tick the
 * echo let go of everything and every door it was holding open closed. Nothing
 * in the corpus reached the replay phase, so nothing noticed. It does now, and
 * the last hundred and fifty ticks here are entirely past the end of the tape.
 */
export const CORPUS_REPLAY: readonly CorpusStep[] = [
  { ticks: 30, intent: {} },
  { ticks: 60, intent: { forward: true, yawUnits: 0 } },
  { ticks: 40, intent: { right: true, yawUnits: 900 } },
  { ticks: 20, intent: { jump: true, yawUnits: 900 } },
  { ticks: 300, intent: { act: true, yawUnits: 2048 } },
  { ticks: 150, intent: { forward: true, act: true, yawUnits: 2048 } },
];

export function runCorpus(room: RoomDefinition): string[] {
  const simulation = new Simulation(room);
  const checksums: string[] = [];
  for (const step of CORPUS) {
    const frame = encodeFrame(step.intent);
    for (let index = 0; index < step.ticks; index += 1) checksums.push(simulation.step(frame).checksum);
  }
  // Fold, then live with what was recorded. A room that cannot be folded this
  // far in is a room whose corpus needs rewriting, so say so rather than
  // silently checksumming a first pass twice.
  if (!simulation.fold()) throw new Error(`Corpus could not fold in room ${room.id}`);
  for (const step of CORPUS_REPLAY) {
    const frame = encodeFrame(step.intent);
    for (let index = 0; index < step.ticks; index += 1) checksums.push(simulation.step(frame).checksum);
  }
  return checksums;
}

export const CORPUS_RECORDING_TICKS = CORPUS.reduce((sum, step) => sum + step.ticks, 0);
export const CORPUS_REPLAY_TICKS = CORPUS_REPLAY.reduce((sum, step) => sum + step.ticks, 0);
