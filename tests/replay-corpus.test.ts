import { describe, expect, it } from "vitest";
import type { InputFrame } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { buildReplayCorpus } from "../src/content/corpus";

function replayChecksums(chamber: ChamberDefinition, tape: Tape, presentFrames: InputFrame[], cadence: number): string[] {
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  const checksums = [simulation.checksum()];
  const renderInterval = 1000 / cadence;
  const simulationInterval = 1000 / 30;
  let accumulator = 0;
  let tapeTick = 0;
  while (tapeTick < presentFrames.length && simulation.state.phase === "replay") {
    accumulator += renderInterval;
    while (accumulator + Number.EPSILON >= simulationInterval && tapeTick < presentFrames.length && simulation.state.phase === "replay") {
      simulation.step(presentFrames[tapeTick]);
      for (const actor of simulation.state.actors) {
        expect(Number.isFinite(actor.x)).toBe(true);
        expect(Number.isFinite(actor.y)).toBe(true);
      }
      expect(simulation.state.actors.length).toBe(2);
      checksums.push(simulation.checksum());
      tapeTick += 1;
      accumulator -= simulationInterval;
    }
  }
  return checksums;
}

describe("100-tape deterministic replay corpus", () => {
  for (const corpusCase of buildReplayCorpus()) {
    const chamber = CHAMBERS[corpusCase.chamberId];
    it(`matches every tick for ${chamber.id} corpus case ${corpusCase.id}`, () => {
      const baseline = replayChecksums(chamber, corpusCase.tape, corpusCase.presentFrames, 30);
      expect(replayChecksums(chamber, corpusCase.tape, corpusCase.presentFrames, 60)).toEqual(baseline);
      expect(replayChecksums(chamber, corpusCase.tape, corpusCase.presentFrames, 144)).toEqual(baseline);
    });
  }
});
