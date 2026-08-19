import { checksumState } from "./checksum";
import {
  ACTOR_RADIUS,
  GRACE_TICKS,
  MIN_TAPE_TICKS,
  MOVE_PER_TICK,
  TARGET_HYSTERESIS,
  TARGET_RADIUS,
} from "./constants";
import { distanceBetween, distanceToRect, moveActorBy, pointInsideRect } from "./geometry";
import { hasInput, InputBit, movementIntent, NEUTRAL_INPUT, type InputFrame } from "./input";
import { applyDoor } from "./mechanisms/door";
import { applyForce } from "./mechanisms/force";
import { applyHandoff } from "./mechanisms/handoff";
import { applyHold } from "./mechanisms/hold";
import { createTape, replayFrame, validateTape } from "./replay";
import {
  POSITION_SCALE,
  SIMULATION_VERSION,
  type ActorId,
  type ActorState,
  type ChamberDefinition,
  type FailureCode,
  type SimulationState,
  type Tape,
} from "./types";

export interface StepResult {
  state: Readonly<SimulationState>;
  checksum: string;
  phaseChanged: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function actor(id: ActorId, chamber: ChamberDefinition): ActorState {
  return {
    id,
    x: chamber.spawn.x,
    y: chamber.spawn.y,
    facingX: 1,
    facingY: 0,
    actionHeld: false,
    targetId: null,
    targetLockout: false,
  };
}

export function createInitialState(chamber: ChamberDefinition, phase: SimulationState["phase"] = "recording"): SimulationState {
  return {
    simulationVersion: SIMULATION_VERSION,
    chamberId: chamber.id,
    chamberVersion: chamber.version,
    phase,
    tick: 0,
    tapeTick: 0,
    actors: phase === "recording" ? [actor("past", chamber)] : [actor("past", chamber), actor("present", chamber)],
    door: chamber.door ? clone(chamber.door) : null,
    hold: chamber.hold ? clone(chamber.hold) : null,
    forceObject: chamber.forceObject ? clone(chamber.forceObject) : null,
    handoff: chamber.handoff ? clone(chamber.handoff) : null,
    exit: clone(chamber.exit),
    success: false,
    lastError: null,
    foldedAtTick: null,
  };
}

function acquireRadius(radius: number): number {
  return radius > 0 ? radius : TARGET_RADIUS;
}

function moveActor(actorState: ActorState, frame: InputFrame, chamber: ChamberDefinition, state: SimulationState): void {
  const intent = movementIntent(frame);
  if (intent.x !== 0 || intent.y !== 0) {
    actorState.facingX = intent.x;
    actorState.facingY = intent.y;
  }
  const step = intent.x !== 0 && intent.y !== 0 ? MOVE_PER_TICK * Math.SQRT1_2 : MOVE_PER_TICK;
  moveActorBy(actorState, intent.x * step, intent.y * step, chamber, state);
}

function eligibleTarget(actorState: ActorState, state: SimulationState): { id: string; distance: number } | null {
  const targets: Array<{ id: string; distance: number; radius: number; x: number; y: number }> = [];
  if (state.hold) {
    targets.push({
      id: state.hold.id,
      distance: distanceBetween(actorState.x, actorState.y, state.hold.x, state.hold.y),
      radius: acquireRadius(state.hold.radius),
      x: state.hold.x,
      y: state.hold.y,
    });
  }
  if (state.forceObject) {
    targets.push({
      id: state.forceObject.id,
      distance: distanceToRect(actorState, state.forceObject),
      radius: TARGET_RADIUS,
      x: state.forceObject.x + state.forceObject.width / 2,
      y: state.forceObject.y + state.forceObject.height / 2,
    });
  }
  if (state.handoff) {
    targets.push({
      id: state.handoff.id,
      distance: distanceBetween(actorState.x, actorState.y, state.handoff.x, state.handoff.y),
      radius: acquireRadius(state.handoff.radius),
      x: state.handoff.x,
      y: state.handoff.y,
    });
  }
  return targets
    .filter((target) => {
      const facingProjection = (target.x - actorState.x) * actorState.facingX + (target.y - actorState.y) * actorState.facingY;
      return target.distance <= target.radius && facingProjection >= -POSITION_SCALE / 2;
    })
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0] ?? null;
}

function targetDistance(actorState: ActorState, targetId: string, state: SimulationState): number {
  if (state.hold?.id === targetId) return distanceBetween(actorState.x, actorState.y, state.hold.x, state.hold.y);
  if (state.forceObject?.id === targetId) return distanceToRect(actorState, state.forceObject);
  if (state.handoff?.id === targetId) return distanceBetween(actorState.x, actorState.y, state.handoff.x, state.handoff.y);
  return Number.POSITIVE_INFINITY;
}

function updateAction(actorState: ActorState, frame: InputFrame, state: SimulationState): void {
  const held = hasInput(frame, InputBit.ActionHeld);
  actorState.actionHeld = held;
  if (!held || hasInput(frame, InputBit.ActionReleased)) {
    actorState.targetId = null;
    actorState.targetLockout = false;
    return;
  }
  if (actorState.targetId) {
    if (targetDistance(actorState, actorState.targetId, state) > TARGET_HYSTERESIS) {
      actorState.targetId = null;
      actorState.targetLockout = true;
    }
    return;
  }
  if (actorState.targetLockout) return;
  actorState.targetId = eligibleTarget(actorState, state)?.id ?? null;
}

function applyInteractions(state: SimulationState, chamber: ChamberDefinition, gracePastTargetId: string | null): void {
  applyHold(state, chamber, state.actors, gracePastTargetId);
  applyDoor(state, chamber, state.actors);
  applyForce(state, chamber, state.actors);
  applyHandoff(state, chamber, state.actors);

  const present = state.actors.find((candidate) => candidate.id === "present");
  if (present && state.exit.open && pointInsideRect(present.x, present.y, state.exit)) {
    state.success = true;
    state.phase = "success";
  }

  if (!state.hold && !state.forceObject && !state.handoff) state.exit.open = chamber.exit.open;
}

function replayFailureCode(state: SimulationState): FailureCode {
  if (state.handoff && !state.handoff.stagedByPast) return "carrier-not-staged";
  if (state.handoff && state.door && !state.door.open) return "delivery-gate-closed";
  if (state.door && !state.door.open && !state.hold?.requiredActor) return "door-closed";
  if (state.forceObject) {
    const direction = state.forceObject.pushDirection ?? "right";
    const seated = direction === "right"
      ? state.forceObject.x >= state.forceObject.maxX
      : state.forceObject.x <= state.forceObject.minX;
    if (!seated) return "block-not-bridged";
  }
  if (state.door && !state.door.open) return "hold-released-early";
  return "echo-faded";
}

export class Simulation {
  readonly chamber: ChamberDefinition;
  private current: SimulationState;
  private frames: InputFrame[] = [];
  private activeTape: Tape | null = null;
  private pastTargetBeforeRelease: string | null = null;

  constructor(chamber: ChamberDefinition) {
    this.chamber = clone(chamber);
    this.current = createInitialState(this.chamber);
  }

  get state(): Readonly<SimulationState> {
    return this.current;
  }

  get tape(): Readonly<Tape> | null {
    return this.activeTape;
  }

  /** True when the current recording is long enough to fold into a tape. */
  get canFold(): boolean {
    return this.current.phase === "recording" && this.frames.length >= MIN_TAPE_TICKS;
  }

  checksum(): string {
    return checksumState(this.current);
  }

  rerecord(): void {
    this.frames = [];
    this.activeTape = null;
    this.pastTargetBeforeRelease = null;
    this.current = createInitialState(this.chamber, "recording");
  }

  /**
   * Fold time: end the recording at the current tick. The remaining tape is
   * filled with the last sampled frame stripped down to ActionHeld, so a past
   * self folded mid-hold keeps holding without walking into walls forever.
   * Returns false (and does nothing) unless at least MIN_TAPE_TICKS were recorded.
   */
  foldRecording(): boolean {
    if (!this.canFold) return false;
    const lastFrame = this.frames[this.frames.length - 1] ?? NEUTRAL_INPUT;
    const heldOnly = lastFrame & InputBit.ActionHeld;
    const foldedAtTick = this.frames.length;
    while (this.frames.length < this.chamber.tapeDurationTicks) this.frames.push(heldOnly);
    this.activeTape = createTape(this.chamber, this.frames);
    this.current = createInitialState(this.chamber, "replay");
    this.current.foldedAtTick = foldedAtTick;
    return true;
  }

  loadTape(tape: Tape): string | null {
    const error = validateTape(this.chamber, tape);
    if (error) {
      this.rerecord();
      this.current.lastError = error;
      return error;
    }
    this.activeTape = clone(tape);
    this.frames = [...tape.frames];
    this.current = createInitialState(this.chamber, "replay");
    return null;
  }

  step(presentInput: InputFrame = NEUTRAL_INPUT): StepResult {
    if (this.current.phase === "success") {
      return { state: this.current, checksum: checksumState(this.current), phaseChanged: false };
    }

    const previousPhase = this.current.phase;
    if (this.current.phase === "rerecord") {
      return { state: this.current, checksum: checksumState(this.current), phaseChanged: false };
    }

    if (this.current.phase === "recording") {
      const past = this.current.actors[0];
      if (!past) throw new Error("Recording actor is missing");
      this.frames.push(presentInput);
      moveActor(past, presentInput, this.chamber, this.current);
      updateAction(past, presentInput, this.current);
      applyInteractions(this.current, this.chamber, null);
      this.current.tick += 1;
      this.current.tapeTick = this.frames.length;
      if (this.frames.length >= this.chamber.tapeDurationTicks) {
        this.activeTape = createTape(this.chamber, this.frames);
        this.current = createInitialState(this.chamber, "replay");
      }
    } else if (this.current.phase === "replay") {
      if (!this.activeTape) {
        this.current.phase = "rerecord";
        this.current.lastError = "tape-missing";
      } else {
        const past = this.current.actors.find((candidate) => candidate.id === "past");
        const present = this.current.actors.find((candidate) => candidate.id === "present");
        if (!past || !present) throw new Error("Replay actors are missing");
        const pastFrame = replayFrame(this.activeTape, this.current.tapeTick);
        // The replay span is fixed by the authored chamber duration so a folded
        // (short) tape can never shorten the present self's cooperative time.
        const releaseTick = this.chamber.tapeDurationTicks;
        if (this.current.tapeTick === releaseTick) this.pastTargetBeforeRelease = past.targetId;
        moveActor(past, pastFrame, this.chamber, this.current);
        updateAction(past, pastFrame, this.current);
        moveActor(present, presentInput, this.chamber, this.current);
        updateAction(present, presentInput, this.current);
        const graceEnd = releaseTick + GRACE_TICKS;
        const graceTarget = this.current.tapeTick >= releaseTick && this.current.tapeTick < graceEnd
          ? this.pastTargetBeforeRelease
          : null;
        applyInteractions(this.current, this.chamber, graceTarget);
        this.current.tick += 1;
        this.current.tapeTick += 1;
        if (!this.current.success && this.current.tapeTick >= graceEnd) {
          this.current.phase = "rerecord";
          this.current.lastError = replayFailureCode(this.current);
        }
      }
    }

    return {
      state: this.current,
      checksum: checksumState(this.current),
      phaseChanged: previousPhase !== this.current.phase,
    };
  }
}

export const simulationConstants = {
  actorRadius: ACTOR_RADIUS,
  movePerTick: MOVE_PER_TICK,
  graceTicks: GRACE_TICKS,
  minTapeTicks: MIN_TAPE_TICKS,
};
