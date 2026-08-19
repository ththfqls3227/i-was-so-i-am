import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { createTape } from "../core/replay";
import type { ChamberDefinition, ChamberId, Tape } from "../core/types";
import { CROSSING_CHAMBER, TRACE_WEIGHT_CHAMBER } from "./chambers";

export interface ReplayCorpusCase {
  id: number;
  chamberId: ChamberId;
  tape: Tape;
  presentFrames: InputFrame[];
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const framePalette: InputFrame[] = [
  NEUTRAL_INPUT,
  encodeInput({ up: true }),
  encodeInput({ down: true }),
  encodeInput({ left: true }),
  encodeInput({ right: true }),
  encodeInput({ right: true, actionHeld: true }),
  encodeInput({ actionPressed: true, actionHeld: true }),
  encodeInput({ actionHeld: true }),
  encodeInput({ actionReleased: true }),
  encodeInput({ up: true, down: true, actionHeld: true }),
];

function generatedFrames(chamber: ChamberDefinition, seed: number): InputFrame[] {
  const random = seeded(seed);
  const frames: InputFrame[] = [];
  let current = framePalette[random() % framePalette.length] ?? NEUTRAL_INPUT;
  for (let tick = 0; tick < chamber.tapeDurationTicks; tick += 1) {
    if (tick % 9 === 0) current = framePalette[random() % framePalette.length] ?? NEUTRAL_INPUT;
    frames.push(current);
  }
  return frames;
}

export function buildReplayCorpus(count = 100): ReplayCorpusCase[] {
  return Array.from({ length: count }, (_, caseIndex) => {
    const chamber = caseIndex % 2 === 0 ? CROSSING_CHAMBER : TRACE_WEIGHT_CHAMBER;
    return {
      id: caseIndex,
      chamberId: chamber.id,
      tape: createTape(chamber, generatedFrames(chamber, caseIndex * 2 + 1)),
      presentFrames: generatedFrames(chamber, caseIndex * 2 + 2),
    };
  });
}
