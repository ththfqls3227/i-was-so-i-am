import { distanceBetween, pointInsideRect } from "../../src/core/geometry";
import { encodeInput, InputBit, NEUTRAL_INPUT, type InputFrame } from "../../src/core/input";
import { Simulation, simulationConstants } from "../../src/core/simulation";
import type { Tape } from "../../src/core/types";
import { TRACE_WEIGHT_CHAMBER } from "../../src/content/chambers";
import { traceFoldWouldFinish, TraceRecordingProjection, traceRecordingRanOutOfTime } from "../../src/content/tutorial-timing";

/**
 * Plays the Trace Weight recording card by card, the way the tutorial words it:
 * walk to the winch, grip it until the card says to let go, let go, then hold
 * right + action until the card offers "⏎ 시간 접기", then fold. Every stage
 * boundary is read from the same module the UI reads, so these tests exercise
 * the card a player follows rather than tuned frame counts.
 */
export interface TraceCardPlay {
  /** Ticks walked past the winch before turning back to it — a player who overruns the marker. */
  overshootTicks?: number;
  /** Ticks the winch stays gripped beyond the point the card says it is enough. */
  extraGripTicks?: number;
  /** Ticks with no key pressed between letting go of the winch and starting the walk. */
  dwellTicks?: number;
  /** Ticks between the card offering the fold and ⏎ actually landing. */
  reactionTicks?: number;
  /** false: never press ⏎ — let the recording run to the chamber's authored end. */
  fold?: boolean;
}

export interface TraceCardRecording {
  /** null when the card gave up on this recording before any tape was made. */
  tape: Tape | null;
  /** Tape tick the card first showed "⏎ 시간 접기", or null if it never did. */
  foldOfferedAtTick: number | null;
  foldedAtTick: number | null;
  /** The card told the player this recording can no longer finish — press R. */
  ranOutOfTime: boolean;
  /** The past's x when it let go of the winch — where the pass 2 walk starts. */
  releasedAtX: number;
}

/**
 * Ticks at which the Trace Weight card offers "⏎ 시간 접기" for the given
 * recording — the same two conditions main.ts reads: the projected echo would
 * be pushing, and the replay window still holds the finish.
 */
export function traceCardFoldOffers(frames: readonly InputFrame[]): number[] {
  const projection = new TraceRecordingProjection();
  const offers: number[] = [];
  for (let tick = 1; tick <= frames.length; tick += 1) {
    const progress = projection.advance(frames.slice(0, tick));
    if (traceFoldWouldFinish(progress)) offers.push(tick);
  }
  return offers;
}

/** Encodes frames the way the render layer samples the keyboard, edges included. */
function keyboardEncoder(): (keys: { left?: boolean; right?: boolean; action?: boolean }) => InputFrame {
  let previousAction = false;
  return (keys) => {
    const action = keys.action === true;
    let frame = encodeInput({ left: keys.left === true, right: keys.right === true, actionHeld: action });
    if (action && !previousAction) frame |= InputBit.ActionPressed;
    if (!action && previousAction) frame |= InputBit.ActionReleased;
    previousAction = action;
    return frame;
  };
}

type Beat = "approach" | "overshoot" | "return" | "grip" | "dwell" | "travel";

export function recordTraceWeightByCard(play: TraceCardPlay = {}): TraceCardRecording {
  const chamber = TRACE_WEIGHT_CHAMBER;
  const winch = chamber.hold;
  if (!winch) throw new Error("Trace Weight winch is missing");
  const overshootTicks = play.overshootTicks ?? 0;
  const extraGripTicks = play.extraGripTicks ?? 0;
  const dwellTicks = play.dwellTicks ?? 0;
  const reactionTicks = play.reactionTicks ?? 0;
  const fold = play.fold ?? true;

  const simulation = new Simulation(chamber);
  const projection = new TraceRecordingProjection();
  const encode = keyboardEncoder();
  let beat: Beat = "approach";
  let beatTicks = 0;
  let gripBonus = 0;
  let foldOfferedAtTick: number | null = null;
  let foldedAtTick: number | null = null;
  let releasedAtX = 0;
  let sinceOffered = -1;
  let ranOutOfTime = false;

  const nearWinch = (): boolean => {
    const pilot = simulation.state.actors[0];
    return pilot !== undefined && distanceBetween(pilot.x, pilot.y, winch.x, winch.y) <= winch.radius;
  };

  while (simulation.state.phase === "recording") {
    if (beat === "approach" && nearWinch()) {
      beat = overshootTicks > 0 ? "overshoot" : "grip";
      beatTicks = 0;
    }
    const frame = beat === "approach" || beat === "overshoot"
      ? encode({ right: true })
      : beat === "return"
        ? encode({ left: true })
        : beat === "grip"
          ? encode({ action: true }) // "keep holding the action key"
          : beat === "dwell"
            ? encode({}) // "let go and walk toward the weight"
            : encode({ right: true, action: true }); // "keep moving right and hold action too"

    simulation.step(frame);
    if (simulation.state.phase !== "recording") break;
    const progress = projection.advance(simulation.recordedFrames);
    beatTicks += 1;

    // The card has stopped asking for a fold and started asking for an R.
    if (traceRecordingRanOutOfTime(progress, simulation.state.tapeTick)) {
      ranOutOfTime = true;
      break;
    }

    if (beat === "overshoot" && beatTicks >= overshootTicks) {
      beat = "return";
      beatTicks = 0;
    } else if (beat === "return" && nearWinch()) {
      beat = "grip";
      beatTicks = 0;
    } else if (beat === "grip" && progress.heldLongEnough) {
      gripBonus += 1;
      if (gripBonus > extraGripTicks) {
        releasedAtX = simulation.state.actors[0]?.x ?? 0;
        beat = "dwell";
        beatTicks = 0;
      }
    } else if (beat === "dwell" && beatTicks > dwellTicks) {
      // One tick of the beat is the release itself; the rest is hesitation.
      beat = "travel";
      beatTicks = 0;
    } else if (beat === "travel" && traceFoldWouldFinish(progress)) {
      if (foldOfferedAtTick === null) foldOfferedAtTick = simulation.state.tapeTick;
      if (!fold) continue;
      sinceOffered = sinceOffered < 0 ? 0 : sinceOffered + 1;
      if (sinceOffered >= reactionTicks) {
        foldedAtTick = simulation.state.tapeTick;
        if (!simulation.foldRecording()) throw new Error("The card offered a fold the simulation refused");
        break;
      }
    }
  }

  const tape = simulation.tape;
  if (!tape && !ranOutOfTime) throw new Error("The card-driven recording produced no tape");
  return { tape: tape ?? null, foldOfferedAtTick, foldedAtTick, ranOutOfTime, releasedAtX };
}

/**
 * Replays a Trace Weight tape with a present self that does its half: cross,
 * push at the weight's left face beside the echo, then walk around the seated
 * weight into the light. It pushes for as long as the replay allows, so a tape
 * whose echo joins late still gets its chance.
 */
export function replayTraceWeightWithWillingPresent(tape: Tape): Simulation {
  const chamber = TRACE_WEIGHT_CHAMBER;
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  const pushRight = encodeInput({ right: true, actionHeld: true });
  const up = encodeInput({ up: true });
  const right = encodeInput({ right: true });
  const down = encodeInput({ down: true });
  const radius = simulationConstants.actorRadius;

  while (simulation.state.phase === "replay") {
    const state = simulation.state;
    const present = state.actors.find((actor) => actor.id === "present");
    const weight = state.forceObject;
    let frame = NEUTRAL_INPUT;
    if (!present || !weight) {
      frame = pushRight;
    } else if (!state.exit.open) {
      frame = pushRight;
    } else if (present.y + radius >= weight.y && present.x < weight.x + weight.width + radius) {
      frame = up; // climb clear of the seated weight
    } else if (present.x < state.exit.x + state.exit.width / 2) {
      frame = right;
    } else if (!pointInsideRect(present.x, present.y, state.exit)) {
      frame = down; // drop into the light
    }
    simulation.step(frame);
  }
  return simulation;
}
