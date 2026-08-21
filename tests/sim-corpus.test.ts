import { describe, expect, it } from "vitest";
import golden from "../src/sim/corpus-checksums.json";
import { CORPUS, CORPUS_RECORDING_TICKS, CORPUS_REPLAY_TICKS, runCorpus } from "../src/sim/corpus";
import { AWAKENING } from "../src/world/room";

/**
 * The Node half of the cross-engine contract. `scripts/fp-cross-engine.mjs`
 * holds Chromium, Firefox and WebKit to this same array, so a checksum that
 * moves here has moved everywhere — and one that moves only there is a genuine
 * engine disagreement, which is the failure the hand-built trig tables exist to
 * prevent.
 */
describe("replay corpus", () => {
  it("matches the committed checksums tick for tick", () => {
    expect(runCorpus(AWAKENING)).toEqual(golden);
  });

  it("covers the whole tape and every kind of intent", () => {
    expect(golden.length).toBe(CORPUS_RECORDING_TICKS + CORPUS_REPLAY_TICKS);
    const intents = CORPUS.map((step) => step.intent);
    expect(intents.some((intent) => intent.forward && intent.right)).toBe(true);
    expect(intents.some((intent) => intent.jump)).toBe(true);
    expect(intents.some((intent) => intent.act)).toBe(true);
    expect(new Set(intents.map((intent) => intent.yawUnits)).size).toBeGreaterThan(4);
  });

  it("is reproducible within one engine", () => {
    expect(runCorpus(AWAKENING)).toEqual(runCorpus(AWAKENING));
  });

  it("runs off the end of the tape, where the clamp lives", () => {
    // The replay half has to outlast the tape or it cannot see the bug it was
    // written for: the echo used to be handed a neutral frame at this exact
    // tick and let go of everything it was holding.
    expect(CORPUS_REPLAY_TICKS).toBeGreaterThan(AWAKENING.tapeDurationTicks);
    expect(CORPUS_REPLAY_TICKS).toBeGreaterThanOrEqual(
      AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks,
    );
  });
});
