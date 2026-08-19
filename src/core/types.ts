import type { InputFrame } from "./input";

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const SIMULATION_VERSION = "production-1.0.0";
export const TAPE_FORMAT_VERSION = 1;
export const POSITION_SCALE = 10;

export type ChamberId = "traceWeight" | "crossing" | "handoff" | "lastHold";
export type Phase = "recording" | "replay" | "success" | "rerecord";
export type ActorId = "past" | "present";

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
  targetLockout: boolean;
}

export interface DoorState {
  id: string;
  rect: Rect;
  open: boolean;
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
  lastError: string | null;
}
