import { checksumState } from "./checksum";
import { hasInput, InputBit, movementIntent, NEUTRAL_INPUT, type InputFrame } from "./input";
import { createTape, replayFrame, validateTape } from "./replay";
import {
  POSITION_SCALE,
  SIMULATION_VERSION,
  TICK_RATE,
  type ActorId,
  type ActorState,
  type ChamberDefinition,
  type ForceObjectState,
  type Rect,
  type SimulationState,
  type Tape,
} from "./types";

const ACTOR_RADIUS = 1.3 * POSITION_SCALE;
const MOVE_PER_TICK = 0.6 * POSITION_SCALE;
const FORCE_MOVE_PER_TICK = 0.32 * POSITION_SCALE;
const TARGET_RADIUS = 3.2 * POSITION_SCALE;
const TARGET_HYSTERESIS = 4 * POSITION_SCALE;
const PUSH_CONTACT = 1.8 * POSITION_SCALE;
const GRACE_TICKS = Math.ceil(0.25 * TICK_RATE);

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
  };
}

function overlapsCircleRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function pointInsideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function distanceToRect(actorState: ActorState, rect: Rect): number {
  const dx = Math.max(rect.x - actorState.x, 0, actorState.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - actorState.y, 0, actorState.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function colliders(chamber: ChamberDefinition, state: SimulationState, actorId: ActorId): Rect[] {
  const rects = [...chamber.walls];
  if (state.door && (!state.door.open || (actorId === "past" && state.door.blocksPast))) rects.push(state.door.rect);
  if (state.forceObject) rects.push(state.forceObject);
  return rects;
}

function moveActor(actorState: ActorState, frame: InputFrame, chamber: ChamberDefinition, state: SimulationState): void {
  const intent = movementIntent(frame);
  if (intent.x !== 0 || intent.y !== 0) {
    actorState.facingX = intent.x;
    actorState.facingY = intent.y;
  }
  const moveX = intent.x * MOVE_PER_TICK;
  const moveY = intent.y * MOVE_PER_TICK;
  const obstacles = colliders(chamber, state, actorState.id);
  const nextX = actorState.x + moveX;
  if (!obstacles.some((rect) => overlapsCircleRect(nextX, actorState.y, ACTOR_RADIUS, rect))) actorState.x = nextX;
  const nextY = actorState.y + moveY;
  if (!obstacles.some((rect) => overlapsCircleRect(actorState.x, nextY, ACTOR_RADIUS, rect))) actorState.y = nextY;
}

function eligibleTarget(actorState: ActorState, state: SimulationState): { id: string; distance: number } | null {
  const targets: Array<{ id: string; distance: number; x: number; y: number }> = [];
  if (state.hold) {
    targets.push({ id: state.hold.id, distance: Math.hypot(actorState.x - state.hold.x, actorState.y - state.hold.y), x: state.hold.x, y: state.hold.y });
  }
  if (state.forceObject) {
    targets.push({ id: state.forceObject.id, distance: distanceToRect(actorState, state.forceObject), x: state.forceObject.x + state.forceObject.width / 2, y: state.forceObject.y + state.forceObject.height / 2 });
  }
  if (state.handoff) {
    targets.push({ id: state.handoff.id, distance: Math.hypot(actorState.x - state.handoff.x, actorState.y - state.handoff.y), x: state.handoff.x, y: state.handoff.y });
  }
  return targets
    .filter((target) => {
      const facingProjection = (target.x - actorState.x) * actorState.facingX + (target.y - actorState.y) * actorState.facingY;
      return target.distance <= TARGET_RADIUS && facingProjection >= -POSITION_SCALE / 2;
    })
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0] ?? null;
}

function targetDistance(actorState: ActorState, targetId: string, state: SimulationState): number {
  if (state.hold?.id === targetId) return Math.hypot(actorState.x - state.hold.x, actorState.y - state.hold.y);
  if (state.forceObject?.id === targetId) return distanceToRect(actorState, state.forceObject);
  if (state.handoff?.id === targetId) return Math.hypot(actorState.x - state.handoff.x, actorState.y - state.handoff.y);
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

function isAlignedPusher(actorState: ActorState, object: ForceObjectState): boolean {
  const verticallyAligned = actorState.y >= object.y - ACTOR_RADIUS && actorState.y <= object.y + object.height + ACTOR_RADIUS;
  const atLeftFace = actorState.x <= object.x && object.x - actorState.x <= ACTOR_RADIUS + PUSH_CONTACT;
  return verticallyAligned && atLeftFace && actorState.facingX === 1 && actorState.targetId === object.id && actorState.actionHeld;
}

function applyInteractions(state: SimulationState, chamber: ChamberDefinition, gracePastTargetId: string | null): void {
  if (state.hold) {
    const credited = state.actors
      .filter((actorState) =>
        (actorState.actionHeld && actorState.targetId === state.hold?.id) ||
        (actorState.id === "past" && gracePastTargetId === state.hold?.id),
      )
      .map((actorState) => actorState.id)
      .sort();
    state.hold.creditedActors = credited;
    state.hold.active = state.hold.requiredActor ? credited.includes(state.hold.requiredActor) : credited.length > 0;
    if (state.door) {
      const present = state.actors.find((actorState) => actorState.id === "present");
      if (
        state.hold.active &&
        present &&
        state.door.latchWhenPresentBeyondX !== undefined &&
        present.x >= state.door.latchWhenPresentBeyondX
      ) {
        state.door.latched = true;
      }
      state.door.open = state.hold.active || state.door.latched === true;
    }
  }

  if (state.forceObject) {
    const contributors = state.actors.filter((actorState) => isAlignedPusher(actorState, state.forceObject as ForceObjectState));
    state.forceObject.force = contributors.length;
    if (contributors.length >= state.forceObject.threshold) {
      const previousX = state.forceObject.x;
      state.forceObject.x = Math.min(state.forceObject.maxX, state.forceObject.x + FORCE_MOVE_PER_TICK);
      const delta = state.forceObject.x - previousX;
      for (const contributor of contributors) contributor.x += delta;
    }
    state.exit.open = state.forceObject.x >= state.forceObject.maxX;
  }

  if (state.handoff) {
    const handoff = state.handoff;
    const holder = handoff.holder
      ? state.actors.find((actorState) => actorState.id === handoff.holder)
      : null;
    if (holder && !holder.actionHeld) {
      handoff.holder = null;
    } else if (holder) {
      handoff.x = holder.x;
      handoff.y = holder.y;
    } else {
      const claimant = state.actors.find((actorState) =>
        actorState.actionHeld &&
        actorState.targetId === handoff.id &&
        (actorState.id === "past" ? !handoff.stagedByPast : handoff.stagedByPast),
      );
      if (claimant) {
        handoff.holder = claimant.id;
        if (claimant.id === "present") handoff.receivedByPresent = true;
      }
    }

    const activeHolder = handoff.holder
      ? state.actors.find((actorState) => actorState.id === handoff.holder)
      : null;
    if (activeHolder) {
      handoff.x = activeHolder.x;
      handoff.y = activeHolder.y;
      if (
        activeHolder.id === "present" &&
        handoff.receivedByPresent &&
        Math.abs(activeHolder.y - handoff.junction.y) >= handoff.junction.radius * 2
      ) {
        handoff.redirectedByPresent = true;
      }
      if (
        activeHolder.id === "past" &&
        Math.hypot(activeHolder.x - handoff.junction.x, activeHolder.y - handoff.junction.y) <= handoff.junction.radius
      ) {
        handoff.stagedByPast = true;
        handoff.holder = null;
        handoff.x = handoff.junction.x;
        handoff.y = handoff.junction.y;
        activeHolder.targetId = null;
      } else if (
        activeHolder.id === "present" &&
        handoff.redirectedByPresent &&
        pointInsideRect(activeHolder.x, activeHolder.y, handoff.delivery)
      ) {
        handoff.delivered = true;
        handoff.holder = null;
        activeHolder.targetId = null;
      }
    }
    state.exit.open = handoff.delivered;
  }

  const present = state.actors.find((candidate) => candidate.id === "present");
  if (present && state.exit.open && pointInsideRect(present.x, present.y, state.exit)) {
    state.success = true;
    state.phase = "success";
  }

  if (!state.hold && !state.forceObject && !state.handoff) state.exit.open = chamber.exit.open;
}

export class Simulation {
  readonly chamber: ChamberDefinition;
  private current: SimulationState;
  private frames: InputFrame[] = [];
  private activeTape: Tape | null = null;
  private frozenSuccess: SimulationState | null = null;
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

  checksum(): string {
    return checksumState(this.current);
  }

  rerecord(): void {
    this.frames = [];
    this.activeTape = null;
    this.frozenSuccess = null;
    this.pastTargetBeforeRelease = null;
    this.current = createInitialState(this.chamber, "recording");
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
    if (this.current.phase === "success" && this.frozenSuccess) {
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
        this.current.lastError = "Replay tape is missing";
      } else {
        const past = this.current.actors.find((candidate) => candidate.id === "past");
        const present = this.current.actors.find((candidate) => candidate.id === "present");
        if (!past || !present) throw new Error("Replay actors are missing");
        const pastFrame = replayFrame(this.activeTape, this.current.tapeTick);
        if (this.current.tapeTick === this.activeTape.duration) this.pastTargetBeforeRelease = past.targetId;
        moveActor(past, pastFrame, this.chamber, this.current);
        updateAction(past, pastFrame, this.current);
        moveActor(present, presentInput, this.chamber, this.current);
        updateAction(present, presentInput, this.current);
        const graceEnd = this.activeTape.duration + GRACE_TICKS;
        const graceTarget = this.current.tapeTick >= this.activeTape.duration && this.current.tapeTick < graceEnd
          ? this.pastTargetBeforeRelease
          : null;
        applyInteractions(this.current, this.chamber, graceTarget);
        this.current.tick += 1;
        this.current.tapeTick += 1;
        if (this.current.success) {
          this.frozenSuccess = clone(this.current);
        } else if (this.current.tapeTick >= graceEnd) {
          this.current.phase = "rerecord";
          this.current.lastError = "The echo has faded. Rerecord a new path.";
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
};
