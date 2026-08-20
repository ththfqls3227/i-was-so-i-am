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

  it("offers the fold no later than the tick the recorded walk reaches the weight", () => {
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

    // Folding a tick earlier used to strand the echo short of the weight, which
    // is what the projection was built to prevent. The posture tail removed that
    // cliff: the recorded stride carries on, so the echo arrives late instead of
    // never. The card is now conservative rather than exact, and this pins the
    // cliff as gone — restoring the pinned-feet fill fails here.
    const tooEarly = recordFoldedTape(TRACE_WEIGHT_CHAMBER, [...tape.frames.slice(0, offered - 1)]);
    const later = replayTraceWeightWithWillingPresent(tooEarly);
    expect(later.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.maxX);
    expect(later.state.success).toBe(true);
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
 * Hand, Not Body's card used to predict, because the old fold pinned the echo's
 * feet and so fixed its remaining travel at record time. The fold now repeats
 * the posture, so a recording made of "right + action" walks the echo to the
 * switch whenever pass 2 opens the door. There is nothing left to predict: the
 * posture the card can see is the whole requirement. These tests hold that
 * claim — every fold the card would offer finishes, from the earliest tick the
 * core allows to the latest, and against a deliberately slow second pass.
 */
describe("Hand, Not Body finishes from any fold the card can offer", () => {
  const pushRight = encodeInput({ right: true, actionHeld: true });
  const up = encodeInput({ up: true });
  const down = encodeInput({ down: true });

  /** The recording the card asks for: right + action, folded after `ticks`. */
  function recordedPosture(ticks: number): Tape {
    return recordFoldedTape(HAND_NOT_BODY_CHAMBER, Array<InputFrame>(ticks).fill(pushRight));
  }

  /**
   * A present self that does its half, `dawdleTicks` late. It stands on the
   * plate holding the echo's door open, then walks down into the light once the
   * switch is gripped.
   */
  function replayWithWillingPresent(tape: Tape, dawdleTicks = 0): Simulation {
    const chamber = HAND_NOT_BODY_CHAMBER;
    const plate = chamber.plate;
    if (!plate) throw new Error("Hand, Not Body has no plate");
    const simulation = new Simulation(chamber);
    const error = simulation.loadTape(tape);
    if (error) throw new Error(error);
    const plateY = plate.y + plate.height / 2;
    let waited = 0;
    while (simulation.state.phase === "replay") {
      const state = simulation.state;
      const present = state.actors.find((actor) => actor.id === "present");
      let frame: InputFrame = NEUTRAL_INPUT;
      if (waited < dawdleTicks) {
        waited += 1;
      } else if (!present) {
        frame = NEUTRAL_INPUT;
      } else if (!state.exit.open) {
        frame = present.y > plateY ? up : NEUTRAL_INPUT;
      } else if (present.y < state.exit.y + state.exit.height / 2) {
        frame = down;
      }
      simulation.step(frame);
    }
    return simulation;
  }

  it("finishes from the earliest fold the core allows and from every later one", () => {
    const failures: number[] = [];
    for (let ticks = simulationConstants.minTapeTicks; ticks < HAND_NOT_BODY_CHAMBER.tapeDurationTicks; ticks += 7) {
      if (!replayWithWillingPresent(recordedPosture(ticks)).state.success) failures.push(ticks);
    }
    expect(failures).toEqual([]);
  });

  it("survives a second pass that takes its time getting to the plate", () => {
    // The reported defect: under the old pinned-feet fold, every tick spent
    // before the plate came straight out of the echo's walking budget. Three
    // seconds of dawdling on top of the walk must still finish.
    const tape = recordedPosture(simulationConstants.minTapeTicks);
    const dawdles = [0, 15, 30, 60, 90];
    const failures = dawdles.filter((dawdle) => !replayWithWillingPresent(tape, dawdle).state.success);
    expect(failures).toEqual([]);
  });

  it("keeps the promise for a player who holds both keys far longer than needed", () => {
    // Every extra recorded tick is slack, not overshoot: the echo ends up
    // pressed into the switch by the far wall rather than walking past it.
    const late = recordedPosture(HAND_NOT_BODY_CHAMBER.tapeDurationTicks - 1);
    const simulation = replayWithWillingPresent(late);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.success).toBe(true);
  });

  it("cannot strand the present off the plate however long the fold's keys stay down", () => {
    // The fold lands with right and action held, so pass 2 opens with the
    // present already walking. Whatever that lurch costs — up to being pressed
    // against the shut door — walking straight up has to find the plate.
    const tape = handNotBodyGolden().past;
    const stranded: number[] = [];
    for (let lurchTicks = 0; lurchTicks <= 40; lurchTicks += 4) {
      const simulation = new Simulation(HAND_NOT_BODY_CHAMBER);
      if (simulation.loadTape(tape)) throw new Error("The golden tape was rejected");
      for (let tick = 0; tick < lurchTicks && simulation.state.phase === "replay"; tick += 1) simulation.step(pushRight);
      let pressed = false;
      while (simulation.state.phase === "replay" && !pressed) {
        simulation.step(up);
        pressed = simulation.state.plate?.active === true;
      }
      if (!pressed) stranded.push(lurchTicks);
    }
    expect(stranded).toEqual([]);
  });
});

/**
 * The posture tail is correct for a room that wants a walking echo and fatal
 * for one whose echo has to keep hold of something. Those rooms' cards refuse
 * the fold until the feet stop; these pin down why that guard has to exist.
 */
describe("folding mid-stride is what the grip rooms' cards guard against", () => {
  const right = encodeInput({ right: true });
  const pushRight = encodeInput({ right: true, actionHeld: true });
  const holdStill = encodeInput({ actionHeld: true });
  const upRight = encodeInput({ up: true, right: true });

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

  it("walks the Crossing echo off its winch, and standing still does not", () => {
    const approach = Array<InputFrame>(24).fill(right);
    const present = crossingGolden().present;
    const walking = replayWith(CROSSING_CHAMBER, recordFoldedTape(CROSSING_CHAMBER, [...approach, ...Array<InputFrame>(6).fill(pushRight)]), present);
    const standing = replayWith(CROSSING_CHAMBER, recordFoldedTape(CROSSING_CHAMBER, [...approach, ...Array<InputFrame>(6).fill(holdStill)]), present);
    expect(walking.state.success).toBe(false);
    expect(walking.state.lastError).toBe("door-closed");
    expect(standing.state.success).toBe(true);
  });

  it("walks the Second Self echo off its plate, and standing still does not", () => {
    const present = secondSelfGolden().present;
    const walking = replayWith(SECOND_SELF_CHAMBER, recordFoldedTape(SECOND_SELF_CHAMBER, Array<InputFrame>(32).fill(upRight)), present);
    const standing = replayWith(SECOND_SELF_CHAMBER, recordFoldedTape(SECOND_SELF_CHAMBER, [
      ...Array<InputFrame>(22).fill(upRight),
      ...Array<InputFrame>(10).fill(NEUTRAL_INPUT),
    ]), present);
    expect(walking.state.success).toBe(false);
    expect(walking.state.lastError).toBe("plate-unpressed");
    expect(standing.state.success).toBe(true);
  });
});
