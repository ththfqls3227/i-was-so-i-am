import { describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation, simulationConstants } from "../src/core/simulation";
import type { ChamberDefinition, SimulationState, Tape } from "../src/core/types";
import { CROSSING_CHAMBER, HANDOFF_CHAMBER, LAST_HOLD_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { crossingGolden, handoffGolden, lastHoldGolden, recordFoldedTape } from "../src/content/golden";
import { traceRequiredHoldTicks } from "../src/content/tutorial-timing";
import { recordTraceWeightByCard, replayTraceWeightWithWillingPresent, traceCardFoldOffers, type TraceCardPlay } from "./support/trace-card";

/**
 * The fold is the one irreversible move in a recording, and the card is what
 * tells a player to make it. These tests hold the card to its word: whenever it
 * offers "⏎ 시간 접기", folding right then has to finish the room — however
 * loosely the player got there.
 */

describe("Trace Weight card keeps its promise under generous timing", () => {
  const plays: TraceCardPlay[] = [];
  for (const overshootTicks of [0, 10]) {
    for (const extraGripTicks of [0, traceRequiredHoldTicks(), traceRequiredHoldTicks() * 2]) {
      for (const dwellTicks of [0, 5, 12, 30]) {
        for (const reactionTicks of [0, 6, 20]) {
          plays.push({ overshootTicks, extraGripTicks, dwellTicks, reactionTicks, fold: true });
        }
        plays.push({ overshootTicks, extraGripTicks, dwellTicks, fold: false });
      }
    }
  }

  it("finishes the room for every card-driven schedule, folded or run to the tape's end", () => {
    const failures: Array<{ play: TraceCardPlay; error: string | null; weightX: number | undefined }> = [];
    const gaveUp: TraceCardPlay[] = [];
    for (const play of plays) {
      const recording = recordTraceWeightByCard(play);
      if (recording.ranOutOfTime) {
        // Dawdling can still burn the replay window. What must never happen is
        // the card offering a fold on the way there.
        expect(recording.foldOfferedAtTick).toBeNull();
        expect(recording.foldedAtTick).toBeNull();
        gaveUp.push(play);
        continue;
      }
      if (!recording.tape) throw new Error("A card-driven recording ended with no tape");
      const simulation = replayTraceWeightWithWillingPresent(recording.tape);
      if (!simulation.state.success) {
        failures.push({ play, error: simulation.state.lastError, weightX: simulation.state.forceObject?.x });
      }
    }
    expect(failures).toEqual([]);
    // Only the most extreme dawdling should ever reach the give-up card.
    expect(gaveUp.every((play) => (play.extraGripTicks ?? 0) >= traceRequiredHoldTicks() * 2)).toBe(true);
  });

  it("completes the room from every single tick the card offers the fold", () => {
    for (const play of [
      { fold: false } satisfies TraceCardPlay,
      { dwellTicks: 12, extraGripTicks: 40, fold: false } satisfies TraceCardPlay,
      { overshootTicks: 10, dwellTicks: 30, extraGripTicks: 40, fold: false } satisfies TraceCardPlay,
    ]) {
      const frames = recordTraceWeightByCard(play).tape?.frames ?? [];
      const offers = traceCardFoldOffers(frames);
      expect(offers.length).toBeGreaterThan(0);
      const failures = offers.filter((tick) => {
        const folded = recordFoldedTape(TRACE_WEIGHT_CHAMBER, [...frames.slice(0, tick)]);
        return !replayTraceWeightWithWillingPresent(folded).state.success;
      });
      expect({ play, failures }).toEqual({ play, failures: [] });
    }
  });

  it("offers the fold only once the recorded walk actually reaches the weight", () => {
    // The schedule that used to break: the player lets go, hesitates half a
    // second, then walks. Elapsed-tick gating called this ready while the echo
    // was still 6 walk ticks short of the weight.
    const play: TraceCardPlay = { dwellTicks: 12, extraGripTicks: 51, reactionTicks: 0, fold: true };
    const recording = recordTraceWeightByCard(play);
    const offered = recording.foldOfferedAtTick;
    expect(offered).not.toBeNull();
    if (offered === null) return;

    const tape = recording.tape;
    if (!tape) throw new Error("The card offered a fold but produced no tape");
    const onTime = replayTraceWeightWithWillingPresent(tape);
    expect(onTime.state.success).toBe(true);

    // One tick earlier the echo is not yet in contact, and the card says so:
    // folding there strands it, and the weight never takes a second force.
    const tooEarly = recordFoldedTape(TRACE_WEIGHT_CHAMBER, [...tape.frames.slice(0, offered - 1)]);
    const stranded = replayTraceWeightWithWillingPresent(tooEarly);
    expect(stranded.state.success).toBe(false);
    expect(stranded.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.minX);
    expect(stranded.state.lastError).toBe("block-not-bridged");
  });

  it("keeps the echo pushing when the fold lands late, and when ⏎ is never pressed", () => {
    const late = recordTraceWeightByCard({ dwellTicks: 12, reactionTicks: 20, fold: true });
    const never = recordTraceWeightByCard({ dwellTicks: 12, fold: false });
    for (const recording of [late, never]) {
      const tape = recording.tape;
      if (!tape) throw new Error("A card-driven recording ended with no tape");
      const simulation = replayTraceWeightWithWillingPresent(tape);
      expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.maxX);
      expect(simulation.state.success).toBe(true);
    }
    expect(never.foldedAtTick).toBeNull();
  });
});

/**
 * The other three rooms gate their fold on things the recording pass can
 * actually show — the carrier staged, the stone seated, the handle gripped — so
 * they never had Trace Weight's blind spot. These pin that down: folding at the
 * first tick each card allows still finishes the room.
 */
describe("the other rooms' cards offer the fold only on a workable recording", () => {
  function canFoldNow(state: Readonly<SimulationState>): boolean {
    return state.phase === "recording" && state.tapeTick >= simulationConstants.minTapeTicks;
  }

  function foldAtFirstOffer(
    chamber: ChamberDefinition,
    pastFrames: readonly InputFrame[],
    cardOffersFold: (state: Readonly<SimulationState>) => boolean,
  ): { tape: Tape; foldedAtTick: number } {
    const simulation = new Simulation(chamber);
    for (const frame of pastFrames) {
      if (simulation.state.phase !== "recording") break;
      simulation.step(frame);
      if (!cardOffersFold(simulation.state)) continue;
      const foldedAtTick = simulation.state.tapeTick;
      if (!simulation.foldRecording()) throw new Error(`${chamber.id}: the card offered a fold the simulation refused`);
      const tape = simulation.tape;
      if (!tape) throw new Error(`${chamber.id}: folding produced no tape`);
      return { tape, foldedAtTick };
    }
    throw new Error(`${chamber.id}: the card never offered a fold`);
  }

  function replayWith(chamber: ChamberDefinition, tape: Tape, presentFrames: readonly InputFrame[]): Simulation {
    const simulation = new Simulation(chamber);
    const error = simulation.loadTape(tape);
    if (error) throw new Error(error);
    let index = 0;
    while (simulation.state.phase === "replay") {
      simulation.step(presentFrames[index] ?? NEUTRAL_INPUT);
      index += 1;
    }
    return simulation;
  }

  it("crossing: gripping the winch is enough, and the fold keeps the grip", () => {
    const golden = crossingGolden();
    const { tape } = foldAtFirstOffer(
      CROSSING_CHAMBER,
      golden.past.frames,
      (state) => state.hold?.active === true && canFoldNow(state),
    );
    const simulation = replayWith(CROSSING_CHAMBER, tape, golden.present);
    expect(simulation.state.success).toBe(true);
  });

  it("handoff: the carrier is staged and the switch gripped before the fold is offered", () => {
    const golden = handoffGolden();
    const { tape } = foldAtFirstOffer(
      HANDOFF_CHAMBER,
      golden.past.frames,
      (state) => state.handoff?.stagedByPast === true && state.hold?.active === true && canFoldNow(state),
    );
    const simulation = replayWith(HANDOFF_CHAMBER, tape, golden.present);
    expect(simulation.state.handoff?.delivered).toBe(true);
    expect(simulation.state.success).toBe(true);
  });

  it("last hold: the stone is seated and the handle gripped before the fold is offered", () => {
    const golden = lastHoldGolden();
    const { tape } = foldAtFirstOffer(
      LAST_HOLD_CHAMBER,
      golden.past.frames,
      (state) => {
        const stone = state.forceObject;
        return stone !== null && stone.x <= stone.minX && state.hold?.active === true && canFoldNow(state);
      },
    );
    const simulation = replayWith(LAST_HOLD_CHAMBER, tape, golden.present);
    expect(simulation.state.success).toBe(true);
  });
});
