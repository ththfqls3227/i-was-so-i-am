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

/** Past the end of the tape the echo receives nothing — it stands where it stopped. */
export function replayFrame(tape: Tape, tick: number): Frame {
  return tick >= 0 && tick < tape.duration ? (tape.frames[tick] ?? NEUTRAL_FRAME) : NEUTRAL_FRAME;
}
