import type { InputFrame } from "../core/input";
import { isAlignedPusher } from "../core/mechanisms/force";
import { Simulation, simulationConstants } from "../core/simulation";
import type { ChamberDefinition } from "../core/types";
import { CHAMBERS } from "./chambers";

/**
 * What the Trace Weight tutorial card advances on. It lives here rather than
 * inside the UI so the regression tests can drive a recording exactly the way
 * the card tells a player to, instead of hand-tuned frame counts.
 */

/** Stage facts the Trace Weight recording card reads, all measured off the tape so far. */
export interface TraceRecordingProgress {
  /** Ticks the winch has been gripped without letting go. */
  gripTicks: number;
  /** The grip lasted long enough to buy the present self its crossing. */
  heldLongEnough: boolean;
  /** The winch was let go after that grip — the walk to the weight has started. */
  released: boolean;
  /** Folding on this tick leaves the echo standing against the weight, pushing it. */
  echoWouldPush: boolean;
  /**
   * Tick the echo first reaches the weight. The replay walks it there off the
   * same frames however late the fold lands, so this — not the fold — is when
   * pass 2's shared push can start.
   */
  echoJoinedAtTick: number | null;
}

const IDLE_PROGRESS: TraceRecordingProgress = {
  gripTicks: 0,
  heldLongEnough: false,
  released: false,
  echoWouldPush: false,
  echoJoinedAtTick: null,
};

export function idleTraceProgress(): TraceRecordingProgress {
  return IDLE_PROGRESS;
}

/**
 * Ticks the winch must stay held so the present self can walk from spawn to the
 * latch line in pass 2 — derived from chamber geometry and core movement speed,
 * with the grace window as reaction margin.
 */
export function traceRequiredHoldTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const latchX = chamber.door?.latchWhenPresentBeyondX ?? chamber.spawn.x;
  return Math.ceil((latchX - chamber.spawn.x) / simulationConstants.movePerTick) + simulationConstants.graceTicks;
}

/**
 * Ticks pass 2 still owes once the echo joins the push: seat the weight under
 * two forces, then walk the present up over the seated weight, across, and down
 * into the light. Straight legs at core walking speed with the grace window as
 * margin — over-estimating only makes the card ask for the fold sooner.
 */
export function traceFinishTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const weight = chamber.forceObject;
  if (!weight) return simulationConstants.graceTicks;
  const seatTicks = Math.ceil((weight.maxX - weight.x) / simulationConstants.forceMovePerTick);
  const climb = weight.height / 2 + simulationConstants.actorRadius;
  const run = chamber.exit.x + chamber.exit.width / 2 - (weight.maxX - simulationConstants.actorRadius);
  const walkTicks = Math.ceil((climb * 2 + run) / simulationConstants.movePerTick);
  return seatTicks + walkTicks + simulationConstants.graceTicks;
}

/** Replay ticks a join at `tick` would have left for the finish, against what it needs. */
function joinFitsTheWindow(tick: number): boolean {
  const chamber = CHAMBERS.traceWeight;
  return tick + traceFinishTicks() <= chamber.tapeDurationTicks + simulationConstants.graceTicks;
}

/**
 * True when folding on this tick finishes the room: the echo is standing on the
 * weight, and it got there early enough for the two of them to seat it and for
 * the present to reach the light.
 */
export function traceFoldWouldFinish(progress: TraceRecordingProgress): boolean {
  return progress.echoWouldPush && progress.echoJoinedAtTick !== null && joinFitsTheWindow(progress.echoJoinedAtTick);
}

/**
 * True once no fold from here on could finish — the echo is not on the weight
 * and the replay window has no room left for it to get there. A recording that
 * dawdled this long cannot be saved, so the card asks for a rerecord instead of
 * offering a fold that would strand the echo.
 */
export function traceRecordingRanOutOfTime(progress: TraceRecordingProgress, tapeTick: number): boolean {
  return !traceFoldWouldFinish(progress) && !joinFitsTheWindow(tapeTick);
}

/** Trace Weight with its bridge already latched: the corridor pass 2 hands the echo. */
function latchedTraceWeight(): ChamberDefinition {
  const chamber = CHAMBERS.traceWeight;
  if (!chamber.door) return chamber;
  return { ...chamber, door: { ...chamber.door, open: true, latched: true } };
}

/**
 * Trace Weight is the one room whose last recorded beat cannot be watched while
 * it is recorded: the bridge is shut in pass 1, so the past ends up pinned
 * against the door no matter how much further right the player walks. Counting
 * elapsed ticks as a stand-in for that walk lies — the dead time between
 * letting go of the winch and pressing right + action is spent out of the same
 * budget, so the card could call a tape ready while the echo was still short of
 * the weight. Folding then freezes the echo where it stands (the fold fill
 * keeps the hand, not the feet) and the weight never sees a second force.
 *
 * So the card does not count: it replays. The tape so far is run through a copy
 * of the chamber whose bridge is already latched — the exact corridor pass 2
 * hands the echo, bought by the grip the card already required — and the core's
 * own `isAlignedPusher` answers whether that echo would be pushing. What the
 * card promises is what the simulation says, on the frames actually recorded.
 */
export class TraceRecordingProjection {
  private simulation = new Simulation(latchedTraceWeight());
  private projectedTicks = 0;
  private gripStartTick: number | null = null;
  private progress: TraceRecordingProgress = IDLE_PROGRESS;

  reset(): void {
    this.simulation = new Simulation(latchedTraceWeight());
    this.projectedTicks = 0;
    this.gripStartTick = null;
    this.progress = IDLE_PROGRESS;
  }

  /**
   * Projects every frame recorded since the last call and reports the card's
   * stage facts. Frames are replayed whole, so a UI that samples the tick
   * stream unevenly still reads the same answer as one that sees every tick.
   */
  advance(frames: readonly InputFrame[]): TraceRecordingProgress {
    if (frames.length < this.projectedTicks) this.reset();
    while (this.projectedTicks < frames.length && this.simulation.state.phase === "recording") {
      const frame = frames[this.projectedTicks];
      if (frame === undefined) break;
      this.simulation.step(frame);
      this.projectedTicks += 1;
      this.observe();
    }
    return this.progress;
  }

  private observe(): void {
    const state = this.simulation.state;
    const echo = state.actors[0];
    const weight = state.forceObject;
    if (state.hold?.active) {
      this.gripStartTick ??= state.tapeTick;
      this.progress = {
        ...this.progress,
        gripTicks: state.tapeTick - this.gripStartTick,
        heldLongEnough: this.progress.heldLongEnough || state.tapeTick - this.gripStartTick >= traceRequiredHoldTicks(),
      };
    } else {
      this.gripStartTick = null;
      this.progress = {
        ...this.progress,
        gripTicks: 0,
        released: this.progress.released || this.progress.heldLongEnough,
      };
    }
    const echoWouldPush = echo !== undefined && weight !== null && isAlignedPusher(echo, weight);
    this.progress = {
      ...this.progress,
      echoWouldPush,
      echoJoinedAtTick: this.progress.echoJoinedAtTick ?? (echoWouldPush ? state.tapeTick : null),
    };
  }
}
