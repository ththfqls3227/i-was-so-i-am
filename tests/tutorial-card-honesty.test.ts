import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation, simulationConstants } from "../src/core/simulation";
import type { ChamberDefinition, SimulationState, Tape } from "../src/core/types";
import {
  AWAKENING_CHAMBER,
  CROSSING_CHAMBER,
  HAND_NOT_BODY_CHAMBER,
  HANDOFF_CHAMBER,
  LAST_HOLD_CHAMBER,
  SECOND_SELF_CHAMBER,
  TRACE_WEIGHT_CHAMBER,
} from "../src/content/chambers";
import { awakeningGolden, crossingGolden, handNotBodyGolden, handoffGolden, lastHoldGolden, recordFoldedTape, secondSelfGolden } from "../src/content/golden";
import { HandRecordingProjection, handFoldWouldFinish, traceRequiredHoldTicks } from "../src/content/tutorial-timing";
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

  it("handoff: the switch is gripped before the fold is offered", () => {
    const golden = handoffGolden();
    const { tape } = foldAtFirstOffer(
      HANDOFF_CHAMBER,
      golden.past.frames,
      (state) => state.hold?.active === true && canFoldNow(state),
    );
    const simulation = replayWith(HANDOFF_CHAMBER, tape, golden.present);
    expect(simulation.state.handoff?.delivered).toBe(true);
    expect(simulation.state.success).toBe(true);
  });

  it("awakening: any fold the card allows finishes, because the present opens its own door", () => {
    const golden = awakeningGolden();
    const { tape, foldedAtTick } = foldAtFirstOffer(AWAKENING_CHAMBER, golden.past.frames, canFoldNow);
    expect(foldedAtTick).toBe(simulationConstants.minTapeTicks);
    expect(replayWith(AWAKENING_CHAMBER, tape, golden.present).state.success).toBe(true);
  });

  it("second self: the fold is offered only while the echo is standing on the plate", () => {
    const golden = secondSelfGolden();
    const { tape } = foldAtFirstOffer(
      SECOND_SELF_CHAMBER,
      golden.past.frames,
      (state) => state.plate?.active === true && canFoldNow(state),
    );
    expect(replayWith(SECOND_SELF_CHAMBER, tape, golden.present).state.success).toBe(true);

    // Folding off the plate is the doomed move the card never offers: the echo
    // freezes where it stands and the door never rises.
    const offPlate = recordFoldedTape(SECOND_SELF_CHAMBER, Array<InputFrame>(simulationConstants.minTapeTicks).fill(NEUTRAL_INPUT));
    const stranded = replayWith(SECOND_SELF_CHAMBER, offPlate, golden.present);
    expect(stranded.state.success).toBe(false);
    expect(stranded.state.lastError).toBe("plate-unpressed");
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

/**
 * Hand, Not Body records its whole solution against a shut door, so its card
 * has Trace Weight's blind spot for the same reason and answers it the same
 * way: by replaying the frames through the corridor pass 2 will open. These
 * hold that projection to its word.
 */
describe("Hand, Not Body's card offers the fold only on a recording that reaches the switch", () => {
  const pushRight = encodeInput({ right: true, actionHeld: true });
  const up = encodeInput({ up: true });
  const down = encodeInput({ down: true });

  /** Ticks at which the card offers "⏎ 기록 끝내기" for these recorded frames. */
  function foldOffers(frames: readonly InputFrame[]): number[] {
    const projection = new HandRecordingProjection();
    const offers: number[] = [];
    for (let tick = 1; tick <= frames.length; tick += 1) {
      if (handFoldWouldFinish(projection.advance(frames.slice(0, tick)))) offers.push(tick);
    }
    return offers;
  }

  /**
   * A present self that does its half: stand on the plate holding the echo's
   * door open, then walk down into the light once the switch is gripped.
   */
  function replayWithWillingPresent(tape: Tape): Simulation {
    const chamber = HAND_NOT_BODY_CHAMBER;
    const plate = chamber.plate;
    if (!plate) throw new Error("Hand, Not Body has no plate");
    const simulation = new Simulation(chamber);
    const error = simulation.loadTape(tape);
    if (error) throw new Error(error);
    const plateY = plate.y + plate.height / 2;
    while (simulation.state.phase === "replay") {
      const state = simulation.state;
      const present = state.actors.find((actor) => actor.id === "present");
      let frame: InputFrame = NEUTRAL_INPUT;
      if (!present) {
        frame = NEUTRAL_INPUT;
      } else if (!state.exit.open) {
        frame = present.y > plateY ? up : NEUTRAL_INPUT; // hold the plate down
      } else if (present.y < state.exit.y + state.exit.height / 2) {
        frame = down; // the switch is gripped — drop into the light
      }
      simulation.step(frame);
    }
    return simulation;
  }

  it("finishes the room from every tick the card offers the fold", () => {
    const frames = handNotBodyGolden().past.frames;
    const offers = foldOffers(frames);
    expect(offers.length).toBeGreaterThan(0);
    const failures = offers.filter((tick) => {
      const folded = recordFoldedTape(HAND_NOT_BODY_CHAMBER, [...frames.slice(0, tick)]);
      return !replayWithWillingPresent(folded).state.success;
    });
    expect(failures).toEqual([]);
  });

  it("strands the echo one tick before the first offer — which is why the card counts nothing", () => {
    const frames = handNotBodyGolden().past.frames;
    const first = foldOffers(frames)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const tooEarly = recordFoldedTape(HAND_NOT_BODY_CHAMBER, [...frames.slice(0, first - 1)]);
    const stranded = replayWithWillingPresent(tooEarly);
    expect(stranded.state.success).toBe(false);
    expect(stranded.state.exit.open).toBe(false);
    expect(stranded.state.lastError).toBe("hold-released-early");
  });

  it("keeps the promise for a player who holds both keys far longer than needed", () => {
    // Every extra recorded tick is slack, not overshoot: the echo ends up
    // pressed into the switch by the far wall rather than walking past it.
    const late = recordFoldedTape(HAND_NOT_BODY_CHAMBER, Array<InputFrame>(HAND_NOT_BODY_CHAMBER.tapeDurationTicks - 1).fill(pushRight));
    const simulation = replayWithWillingPresent(late);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.success).toBe(true);
  });
});
