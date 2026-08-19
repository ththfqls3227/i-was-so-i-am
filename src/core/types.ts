import type { InputFrame } from "./input";

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const SIMULATION_VERSION = "production-2.0.0";
export const TAPE_FORMAT_VERSION = 1;
export const POSITION_SCALE = 10;

export type ChamberId = "traceWeight" | "crossing" | "handoff" | "lastHold";
export type Phase = "recording" | "replay" | "success" | "rerecord";
export type ActorId = "past" | "present";

/**
 * Structured failure reasons. The core only ever stores these codes in
 * `lastError`; the UI layer maps each code to player-facing copy.
 * Never compare failure copy strings — compare codes.
 */
export type FailureCode =
  | "tape-missing"
  | "tape-format-unknown"
  | "tape-version-mismatch"
  | "tape-chamber-mismatch"
  | "tape-tickrate-mismatch"
  | "tape-duration-mismatch"
  | "tape-too-long"
  | "tape-checksum-mismatch"
  | "tape-invalid"
  | "echo-faded"
  | "door-closed"
  | "hold-released-early"
  | "carrier-not-staged"
  | "delivery-gate-closed"
  | "block-not-bridged";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface ActorState extends Point {
  id: ActorId;
  facingX: -1 | 0 | 1;
  facingY: -1 | 0 | 1;
  actionHeld: boolean;
  targetId: string | null;
  /**
   * The one target this actor dropped by walking out of its hysteresis radius.
   * It cannot be regrabbed until the action key is released — but every other
   * affordance stays available, so a held action can never blind an actor to
   * the whole room.
   */
  lockedOutTargetId: string | null;
}

export interface DoorState {
  id: string;
  rect: Rect;
  open: boolean;
  /** Mechanism that gates this door. Defaults to "hold" when the chamber has a hold; doors without a gate keep their authored open state. */
  gatedBy?: "hold";
  latchWhenPresentBeyondX?: number;
  latched?: boolean;
  blocksPast?: boolean;
}

export interface HoldMechanismState extends Point {
  id: string;
  radius: number;
  active: boolean;
  creditedActors: ActorId[];
  requiredActor?: ActorId;
}

export interface ForceObjectState extends Rect {
  id: string;
  axis: "x";
  minX: number;
  maxX: number;
  threshold: number;
  force: number;
  /** Direction aligned pushers move the object. Defaults to "right". */
  pushDirection?: "left" | "right";
}

export interface HandoffMechanismState extends Point {
  id: string;
  radius: number;
  junction: Point & { radius: number };
  delivery: Rect;
  holder: ActorId | null;
  stagedByPast: boolean;
  receivedByPresent: boolean;
  redirectedByPresent: boolean;
  delivered: boolean;
}

export interface ExitState extends Rect {
  id: string;
  open: boolean;
}

export interface ChamberDefinition {
  id: ChamberId;
  version: number;
  name: string;
  subtitle: string;
  hint: string;
  tapeDurationTicks: number;
  world: { width: number; height: number };
  spawn: Point;
  walls: Rect[];
  door?: DoorState;
  hold?: HoldMechanismState;
  forceObject?: ForceObjectState;
  handoff?: HandoffMechanismState;
  /**
   * Mechanism allowed to open the exit. Defaults to the handoff when the
   * chamber has one, else the force object; a chamber with neither keeps its
   * authored exit state. Only the designated mechanism writes `exit.open`.
   */
  exitGate?: "force" | "handoff";
  exit: ExitState;
}

export interface Tape {
  formatVersion: number;
  simulationVersion: string;
  chamberId: ChamberId;
  chamberVersion: number;
  tickRate: number;
  duration: number;
  frames: InputFrame[];
  checksum: string;
}

export interface SimulationState {
  simulationVersion: string;
  chamberId: ChamberId;
  chamberVersion: number;
  phase: Phase;
  tick: number;
  tapeTick: number;
  actors: ActorState[];
  door: DoorState | null;
  hold: HoldMechanismState | null;
  forceObject: ForceObjectState | null;
  handoff: HandoffMechanismState | null;
  exit: ExitState;
  success: boolean;
  lastError: FailureCode | null;
  /** Recording tick at which the player folded time, or null when the tape ran its full length. Render-only flourish data. */
  foldedAtTick: number | null;
}
