import { describe, expect, it } from "vitest";
import golden from "../src/sim/corpus-checksums.json";
import { CORPUS, runCorpus } from "../src/sim/corpus";
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
    const ticks = CORPUS.reduce((sum, step) => sum + step.ticks, 0);
    expect(golden.length).toBe(ticks);
    const intents = CORPUS.map((step) => step.intent);
    expect(intents.some((intent) => intent.forward && intent.right)).toBe(true);
    expect(intents.some((intent) => intent.jump)).toBe(true);
    expect(intents.some((intent) => intent.act)).toBe(true);
    expect(new Set(intents.map((intent) => intent.yawUnits)).size).toBeGreaterThan(4);
  });

  it("is reproducible within one engine", () => {
    expect(runCorpus(AWAKENING)).toEqual(runCorpus(AWAKENING));
  });
});
