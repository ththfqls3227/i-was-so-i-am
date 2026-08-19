import { assertValidInputFrame, NEUTRAL_INPUT, type InputFrame } from "./input";
import { checksumValue } from "./checksum";
import {
  SIMULATION_VERSION,
  TAPE_FORMAT_VERSION,
  TICK_RATE,
  type ChamberDefinition,
  type FailureCode,
  type Tape,
} from "./types";

const MAX_TAPE_TICKS = TICK_RATE * 30;

function payload(tape: Omit<Tape, "checksum">): unknown {
  return tape;
}

export function createTape(chamber: ChamberDefinition, frames: InputFrame[]): Tape {
  if (frames.length !== chamber.tapeDurationTicks) {
    throw new Error(`Tape duration ${frames.length} does not match chamber duration ${chamber.tapeDurationTicks}`);
  }
  frames.forEach(assertValidInputFrame);
  const tapeWithoutChecksum: Omit<Tape, "checksum"> = {
    formatVersion: TAPE_FORMAT_VERSION,
    simulationVersion: SIMULATION_VERSION,
    chamberId: chamber.id,
    chamberVersion: chamber.version,
    tickRate: TICK_RATE,
    duration: frames.length,
    frames: [...frames],
  };
  return { ...tapeWithoutChecksum, checksum: checksumValue(payload(tapeWithoutChecksum)) };
}

export function validateTape(chamber: ChamberDefinition, tape: Tape): FailureCode | null {
  try {
    if (tape.formatVersion !== TAPE_FORMAT_VERSION) return "tape-format-unknown";
    if (tape.simulationVersion !== SIMULATION_VERSION) return "tape-version-mismatch";
    if (tape.chamberId !== chamber.id || tape.chamberVersion !== chamber.version) return "tape-chamber-mismatch";
    if (tape.tickRate !== TICK_RATE) return "tape-tickrate-mismatch";
    if (tape.duration !== chamber.tapeDurationTicks || tape.duration !== tape.frames.length) return "tape-duration-mismatch";
    if (tape.duration > MAX_TAPE_TICKS) return "tape-too-long";
    tape.frames.forEach(assertValidInputFrame);
    const { checksum, ...withoutChecksum } = tape;
    if (checksumValue(payload(withoutChecksum)) !== checksum) return "tape-checksum-mismatch";
    return null;
  } catch {
    return "tape-invalid";
  }
}

export function replayFrame(tape: Tape, tick: number): InputFrame {
  return tick >= 0 && tick < tape.duration ? (tape.frames[tick] ?? NEUTRAL_INPUT) : NEUTRAL_INPUT;
}
