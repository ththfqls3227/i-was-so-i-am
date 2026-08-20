import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { createTape } from "../core/replay";
import { Simulation, simulationConstants } from "../core/simulation";
import type { ChamberDefinition, ChamberId, Tape } from "../core/types";
import { CHAMBERS } from "./chambers";
import { CHAMBER_ROUTE } from "./manifests";

export interface ReplayCorpusCase {
  id: number;
  chamberId: ChamberId;
  tape: Tape;
  presentFrames: InputFrame[];
}

/** Every authored room takes its turn, so no chamber ships without cross-cadence proof. */
const CHAMBER_CYCLE = CHAMBER_ROUTE.map((id) => CHAMBERS[id]);

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

/** Record part of the generated frames through the real simulation, then fold. */
function foldedTape(chamber: ChamberDefinition, frames: InputFrame[], seed: number): Tape {
  const random = seeded(seed);
  const minTicks = simulationConstants.minTapeTicks;
  const foldTick = minTicks + (random() % (chamber.tapeDurationTicks - minTicks));
  const simulation = new Simulation(chamber);
  for (let tick = 0; tick < foldTick; tick += 1) simulation.step(frames[tick] ?? NEUTRAL_INPUT);
  if (!simulation.foldRecording() || !simulation.tape) {
    throw new Error(`Corpus fold failed for ${chamber.id} at tick ${foldTick}`);
  }
  return simulation.tape;
}

export function buildReplayCorpus(count = 100): ReplayCorpusCase[] {
  return Array.from({ length: count }, (_, caseIndex) => {
    const chamber = CHAMBER_CYCLE[caseIndex % CHAMBER_CYCLE.length] ?? CHAMBERS.crossing;
    const pastFrames = generatedFrames(chamber, caseIndex * 2 + 1);
    // Every third case ends its recording with a fold so the corpus also
    // certifies determinism of ActionHeld-filled folded tapes in all rooms.
    const tape = caseIndex % 3 === 0
      ? foldedTape(chamber, pastFrames, caseIndex * 2 + 3)
      : createTape(chamber, pastFrames);
    return {
      id: caseIndex,
      chamberId: chamber.id,
      tape,
      presentFrames: generatedFrames(chamber, caseIndex * 2 + 2),
    };
  });
}
