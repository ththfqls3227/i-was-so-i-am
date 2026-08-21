import { checksumValue } from "./checksum";
import { MAX_TAPE_TICKS, SIM_VERSION, TAPE_FORMAT_VERSION, TICK_RATE } from "./constants";
import { assertValidFrame, NEUTRAL_FRAME, type Frame } from "./input";
import type { FailureCode, RoomDefinition, Tape } from "./types";

function payload(tape: Omit<Tape, "checksum">): unknown {
  return tape;
}

export function createTape(room: RoomDefinition, frames: Frame[]): Tape {
  if (frames.length !== room.tapeDurationTicks) {
    throw new Error(`Tape length ${frames.length} does not match room duration ${room.tapeDurationTicks}`);
  }
  frames.forEach(assertValidFrame);
  const withoutChecksum: Omit<Tape, "checksum"> = {
    formatVersion: TAPE_FORMAT_VERSION,
    simVersion: SIM_VERSION,
    roomId: room.id,
    roomVersion: room.version,
    tickRate: TICK_RATE,
    duration: frames.length,
    frames: [...frames],
  };
  return { ...withoutChecksum, checksum: checksumValue(payload(withoutChecksum)) };
}

export function validateTape(room: RoomDefinition, tape: Tape): FailureCode | null {
  try {
    if (tape.formatVersion !== TAPE_FORMAT_VERSION) return "tape-format-unknown";
    if (tape.simVersion !== SIM_VERSION) return "tape-version-mismatch";
    if (tape.roomId !== room.id || tape.roomVersion !== room.version) return "tape-room-mismatch";
    if (tape.tickRate !== TICK_RATE) return "tape-tickrate-mismatch";
    if (tape.duration !== room.tapeDurationTicks || tape.duration !== tape.frames.length) {
      return "tape-duration-mismatch";
    }
    if (tape.duration > MAX_TAPE_TICKS) return "tape-too-long";
    tape.frames.forEach(assertValidFrame);
    const { checksum, ...withoutChecksum } = tape;
    if (checksumValue(payload(withoutChecksum)) !== checksum) return "tape-checksum-mismatch";
    return null;
  } catch {
    return "tape-invalid";
  }
}

/**
 * The frame the echo is living at this tick, clamped at both ends.
 *
 * Past the end of the tape it keeps receiving the last frame — which, because a
 * fold pads the tape with the posture it ended in, is that posture. The earlier
 * version returned a neutral frame here, so the moment the gauge ran out the
 * echo let go of whatever it was holding and every door it was keeping open
 * closed. The finale is built on the opposite promise: the recording ends in the
 * posture you are holding, and it holds it for as long as you need.
 */
export function replayFrame(tape: Tape, tick: number): Frame {
  if (tape.duration <= 0) return NEUTRAL_FRAME;
  if (tick <= 0) return tape.frames[0] ?? NEUTRAL_FRAME;
  if (tick < tape.duration) return tape.frames[tick] ?? NEUTRAL_FRAME;
  return tape.frames[tape.duration - 1] ?? NEUTRAL_FRAME;
}
