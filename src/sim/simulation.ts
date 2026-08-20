import { focusFor, spawnActor, stepActor } from "./actor";
import { checksumState } from "./checksum";
import { insideBox } from "./collide";
import {
  AIR_ACCEL,
  EYE_HEIGHT,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_SPEED,
  MIN_TAPE_TICKS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SIM_VERSION,
  TICK_MS,
  TICK_RATE,
  TICK_SECONDS,
  WALK_SPEED,
  YAW_UNITS,
} from "./constants";
import { assertValidFrame, NEUTRAL_FRAME, type Frame } from "./input";
import { evaluateDoors, evaluatePlates, initialDoors, initialPlates, solidsFor } from "./mechanisms";
import { createTape, replayFrame, validateTape } from "./tape";
import type { RoomDefinition, SimState, Tape } from "./types";

export interface StepResult {
  state: SimState;
  checksum: string;
  phaseChanged: boolean;
}

/** Constants the render layer needs, so it never re-declares one of its own. */
export const simConstants = {
  tickRate: TICK_RATE,
  tickMs: TICK_MS,
  tickSeconds: TICK_SECONDS,
  yawUnits: YAW_UNITS,
  eyeHeight: EYE_HEIGHT,
  playerHeight: PLAYER_HEIGHT,
  playerRadius: PLAYER_RADIUS,
  walkSpeed: WALK_SPEED,
  groundAccel: GROUND_ACCEL,
  airAccel: AIR_ACCEL,
  gravity: GRAVITY,
  jumpSpeed: JUMP_SPEED,
  minTapeTicks: MIN_TAPE_TICKS,
} as const;

/**
 * The one place the world advances. Both passes run through the same `step`:
 * the first records the frames it is given, the second feeds those frames back
 * to the echo while the living player supplies new ones. Nothing else may write
 * to the state — the renderer only ever reads it.
 */
export class Simulation {
  private room: RoomDefinition;
  private current: SimState;
  private frames: Frame[] = [];
  private tape: Tape | null = null;

  constructor(room: RoomDefinition) {
    this.room = room;
    this.current = this.freshState("recording");
  }

  get state(): Readonly<SimState> {
    return this.current;
  }

  get definition(): RoomDefinition {
    return this.room;
  }

  get recordedFrames(): readonly Frame[] {
    return this.frames;
  }

  get currentTape(): Tape | null {
    return this.tape;
  }

  /** The frame the fold would repeat: the posture the recording ends in. */
  get foldTail(): Frame | null {
    if (this.current.phase !== "recording" || this.frames.length === 0) return null;
    return this.frames[this.frames.length - 1] ?? null;
  }

  get canFold(): boolean {
    return this.current.phase === "recording" && this.frames.length >= MIN_TAPE_TICKS;
  }

  checksum(): string {
    return checksumState(this.current);
  }

  private freshState(phase: SimState["phase"]): SimState {
    return {
      simVersion: SIM_VERSION,
      roomId: this.room.id,
      roomVersion: this.room.version,
      phase,
      tapeTick: 0,
      actors: [spawnActor("present", this.room.spawn)],
      plates: initialPlates(this.room),
      doors: initialDoors(this.room),
      exitOpen: true,
      success: false,
      lastError: null,
      foldedAtTick: null,
    };
  }

  /** Start over from an empty tape. */
  rerecord(): void {
    const carriedError = this.current.lastError;
    this.frames = [];
    this.tape = null;
    this.current = this.freshState("recording");
    this.current.lastError = carriedError;
  }

  /**
   * Finish the recording where it stands, holding the posture it ends in.
   * The tail is the last sampled frame verbatim — feet, gaze and grip together —
   * which is what makes "the recording ends in the posture you are holding" true
   * rather than nearly true.
   */
  fold(): boolean {
    if (!this.canFold) return false;
    const tail = this.frames[this.frames.length - 1] ?? NEUTRAL_FRAME;
    this.current.foldedAtTick = this.frames.length;
    while (this.frames.length < this.room.tapeDurationTicks) this.frames.push(tail);
    this.beginReplay();
    return true;
  }

  private beginReplay(): void {
    const tape = createTape(this.room, this.frames);
    const invalid = validateTape(this.room, tape);
    if (invalid) {
      this.current.phase = "rerecord";
      this.current.lastError = invalid;
      return;
    }
    this.tape = tape;
    const foldedAtTick = this.current.foldedAtTick;
    this.current = this.freshState("replay");
    this.current.foldedAtTick = foldedAtTick;
    this.current.actors = [
      spawnActor("present", this.room.spawn),
      spawnActor("past", this.room.spawn),
    ];
  }

  /** Load a tape recorded elsewhere (tests, corpus) and go straight to the second pass. */
  loadTape(tape: Tape): boolean {
    const invalid = validateTape(this.room, tape);
    if (invalid) {
      this.current.lastError = invalid;
      return false;
    }
    this.frames = [...tape.frames];
    this.current.foldedAtTick = null;
    this.beginReplay();
    return true;
  }

  step(frame: Frame): StepResult {
    assertValidFrame(frame);
    const phaseBefore = this.current.phase;
    const state = this.current;

    if (phaseBefore === "success" || phaseBefore === "rerecord") {
      return { state, checksum: checksumState(state), phaseChanged: false };
    }

    const solids = solidsFor(this.room, state.doors);
    const present = state.actors.find((actor) => actor.id === "present");
    const past = state.actors.find((actor) => actor.id === "past");

    if (phaseBefore === "recording") {
      this.frames.push(frame);
    } else if (past && this.tape) {
      stepActor(past, replayFrame(this.tape, state.tapeTick), solids);
      past.focusId = focusFor(past, this.room.interactables);
    }

    if (present) {
      stepActor(present, frame, solids);
      present.focusId = focusFor(present, this.room.interactables);
    }

    evaluatePlates(this.room, state);
    evaluateDoors(this.room, state);

    state.tapeTick += 1;

    if (phaseBefore === "recording") {
      if (this.frames.length >= this.room.tapeDurationTicks) this.beginReplay();
    } else {
      if (present && state.exitOpen && this.reachedExit(present.x, present.y, present.z)) {
        state.phase = "success";
        state.success = true;
        state.lastError = null;
      } else if (state.tapeTick >= this.room.tapeDurationTicks + this.room.replayGraceTicks) {
        state.phase = "rerecord";
        state.lastError = state.doors.every((door) => door.open) ? "out-of-time" : "door-closed";
      }
    }

    return {
      state: this.current,
      checksum: checksumState(this.current),
      phaseChanged: this.current.phase !== phaseBefore,
    };
  }

  private reachedExit(x: number, y: number, z: number): boolean {
    // Measured at chest height so brushing the exit's floor edge is not a win.
    return insideBox({ x, y: y + PLAYER_HEIGHT / 2, z }, this.room.exit.min, this.room.exit.max);
  }
}
