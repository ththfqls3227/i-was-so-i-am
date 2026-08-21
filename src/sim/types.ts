import type { Frame } from "./input";

export type ActorId = "past" | "present";
export type Phase = "recording" | "replay" | "success" | "rerecord";

/**
 * Structured failure reasons. The core only ever stores these codes; the UI maps
 * each one to copy. Never compare failure copy — compare codes.
 */
export type FailureCode =
  | "tape-missing"
  | "tape-format-unknown"
  | "tape-version-mismatch"
  | "tape-room-mismatch"
  | "tape-tickrate-mismatch"
  | "tape-duration-mismatch"
  | "tape-too-long"
  | "tape-checksum-mismatch"
  | "tape-invalid"
  | "out-of-time"
  | "door-closed";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A solid axis-aligned box. Rooms are built entirely from these. */
export interface Brush {
  id: string;
  min: Vec3;
  max: Vec3;
}

/**
 * What opens a door or an exit. Composable, so a room can ask for two things at
 * once without the door needing to know what either of them is.
 */
export type GateRef =
  | { kind: "plate"; id: string }
  | { kind: "hold"; id: string }
  | { kind: "all"; of: readonly GateRef[] };

/**
 * A floor plate: active while an actor stands inside its footprint. Standing is
 * the whole input, which is why it is the first mechanism the game teaches.
 */
export interface PlateSpec {
  id: string;
  centre: { x: number; z: number };
  half: { x: number; z: number };
  /** How far above the plate an actor's feet may be and still count. */
  reach: number;
  requiredActor?: ActorId;
  /**
   * Held down by something the simulation does not model — an older record the
   * archive is replaying on this plate. Not a tape and not an actor: the room
   * simply arrives with this plate already pressed.
   */
  forcedActive?: boolean;
}

/**
 * A grip. You take hold of it by looking at it and holding Act, and you keep
 * hold of it by not walking away — unlike a plate it survives turning your head,
 * because a hand stays where a hand was put.
 */
export interface HoldSpec {
  id: string;
  /** Where the grip is. The gaze cone is measured against this point. */
  at: Vec3;
  /** Walking further than this from the grip loses it. */
  releaseRadius: number;
  requiredActor?: ActorId;
}

export interface HoldState {
  id: string;
  active: boolean;
  heldBy: ActorId[];
}

export interface PlateState {
  id: string;
  active: boolean;
  pressedBy: ActorId[];
}

/** A vertical slide door. Closed, its brush is solid; open, it is not there. */
export interface DoorSpec {
  id: string;
  brush: Brush;
  /** What drives it. */
  gatedBy: GateRef;
  /**
   * Once opened, stays open — the room never takes back what you gave it.
   * Exactly one door in the campaign sets this false, and that absence is the
   * finale: the only way to hold it open is to leave someone holding it.
   */
  latchOnOpen: boolean;
}

export interface DoorState {
  id: string;
  open: boolean;
  latched: boolean;
}

/** Something the crosshair can answer to, and that Act can be held against. */
export interface InteractableSpec {
  id: string;
  kind: "plate" | "switch";
  /** Point the gaze cone is measured against. */
  focus: Vec3;
}

export interface ExitSpec {
  id: string;
  min: Vec3;
  max: Vec3;
}

export interface RoomDefinition {
  id: string;
  version: number;
  name: string;
  subtitle: string;
  /** Length of a full recording, and therefore of the replay span before grace. */
  tapeDurationTicks: number;
  /** Extra ticks the present gets after the tape ends, before the run is called. */
  replayGraceTicks: number;
  spawn: { x: number; y: number; z: number; yawUnits: number };
  brushes: Brush[];
  plates: PlateSpec[];
  holds: HoldSpec[];
  doors: DoorSpec[];
  exit: ExitSpec;
  /** What opens the way out. Absent means it was never closed. */
  exitGatedBy?: GateRef;
  /**
   * This room takes no recording. There is no tape, no echo and no clock — the
   * player simply walks it. The HUD drops its tape bar, pass badge and the fold
   * and rerecord prompts, because none of them would do anything.
   */
  recordingDisabled?: boolean;
  /**
   * The second pass never expires. The echo keeps holding the posture it was
   * folded in for as long as the player takes, and the run cannot fail on time.
   */
  echoPersists?: boolean;
}

export interface ActorState {
  id: ActorId;
  /** Feet position. The collider rises PLAYER_HEIGHT from here. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yawUnits: number;
  grounded: boolean;
  actHeld: boolean;
  /** Previous tick's buttons, so press edges are derived rather than transmitted. */
  buttonsPrev: number;
  /** Interactable currently under the gaze cone, or null. */
  focusId: string | null;
  /** The grip this actor has hold of, or null. */
  targetId: string | null;
  /**
   * The one grip this actor dropped by walking out of its release radius. It
   * cannot be retaken until Act is released — but every other grip stays
   * available, so a held tail can never blind an echo to the whole room.
   */
  lockedOutTargetId: string | null;
}

export interface SimState {
  simVersion: string;
  roomId: string;
  roomVersion: number;
  phase: Phase;
  /** Ticks into the current recording or replay. The only clock the world has. */
  tapeTick: number;
  actors: ActorState[];
  plates: PlateState[];
  holds: HoldState[];
  doors: DoorState[];
  exitOpen: boolean;
  success: boolean;
  lastError: FailureCode | null;
  /**
   * Recording tick the player folded at, or null when the tape ran its full
   * length. This describes how the tape was authored, not the state of the
   * world, so it is deliberately outside the checksum — a tape loaded from
   * elsewhere has no fold point but must still replay identically.
   */
  foldedAtTick: number | null;
}

export interface Tape {
  formatVersion: number;
  simVersion: string;
  roomId: string;
  roomVersion: number;
  tickRate: number;
  duration: number;
  frames: Frame[];
  checksum: string;
}
