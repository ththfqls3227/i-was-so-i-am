import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { encodeFrame, NEUTRAL_FRAME, buttonsOf, yawUnitsOf, Button } from "../src/sim/input";
import { createTape, validateTape } from "../src/sim/tape";
import { cosYaw, sinYaw, wrapYawUnits, yawUnitsFromRadians } from "../src/sim/trig";
import { resolveHorizontal, standingOn } from "../src/sim/collide";
import { MIN_TAPE_TICKS, PLAYER_RADIUS, TICK_RATE, YAW_UNITS } from "../src/sim/constants";
import { AWAKENING } from "../src/world/room";
import { actorOf, doorOpen, drive, framesFor, WALK_TO_PLATE, type Hold } from "./support/fp-drive";

const quarterTurn = YAW_UNITS / 4;

function fresh(): Simulation {
  return new Simulation(AWAKENING);
}

/** Record the standard opening pass and fold, leaving the sim in replay. */
function recordAndFold(simulation: Simulation): void {
  drive(simulation, framesFor(WALK_TO_PLATE));
  expect(simulation.canFold).toBe(true);
  expect(simulation.fold()).toBe(true);
  expect(simulation.state.phase).toBe("replay");
}

describe("quantised yaw", () => {
  it("reproduces the same units for the same angle", () => {
    for (const radians of [0, 0.1, 1, -1, 3.14159, 6.2831, 12.5, -19.7]) {
      expect(yawUnitsFromRadians(radians)).toBe(yawUnitsFromRadians(radians));
    }
  });

  it("stays inside one turn for any input", () => {
    for (const radians of [-100, -1, 0, 1, 100, 1e6]) {
      const units = yawUnitsFromRadians(radians);
      expect(Number.isInteger(units)).toBe(true);
      expect(units).toBeGreaterThanOrEqual(0);
      expect(units).toBeLessThan(YAW_UNITS);
    }
  });

  it("agrees with the platform trig it is not allowed to call", () => {
    for (let units = 0; units < YAW_UNITS; units += 7) {
      const radians = (units / YAW_UNITS) * Math.PI * 2;
      expect(sinYaw(units)).toBeCloseTo(Math.sin(radians), 14);
      expect(cosYaw(units)).toBeCloseTo(Math.cos(radians), 14);
    }
  });

  it("keeps the heading a unit vector at every quantised step", () => {
    for (let units = 0; units < YAW_UNITS; units += 1) {
      const length = sinYaw(units) * sinYaw(units) + cosYaw(units) * cosYaw(units);
      expect(length).toBeCloseTo(1, 15);
    }
  });

  it("wraps negative and overlong units", () => {
    expect(wrapYawUnits(-1)).toBe(YAW_UNITS - 1);
    expect(wrapYawUnits(YAW_UNITS)).toBe(0);
    expect(wrapYawUnits(YAW_UNITS + 5)).toBe(5);
  });

  it("survives the round trip through a frame", () => {
    for (const units of [0, 1, 1023, 2048, 4095]) {
      expect(yawUnitsOf(encodeFrame({ yawUnits: units }))).toBe(units);
    }
  });
});

describe("tick determinism", () => {
  it("produces identical checksums for identical frames", () => {
    const frames = framesFor([
      { forward: true, yawUnits: 0, ticks: 20 },
      { forward: true, right: true, yawUnits: 300, ticks: 20 },
      { jump: true, forward: true, yawUnits: 300, ticks: 6 },
      { back: true, act: true, yawUnits: 3900, ticks: 25 },
      { ticks: 10 },
    ]);
    const first = drive(fresh(), frames);
    const second = drive(fresh(), frames);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("keeps a full record-fold-replay run reproducible end to end", () => {
    const replayFrames = framesFor([{ forward: true, ticks: 140 }]);
    const run = (): { checksums: string[]; success: boolean } => {
      const simulation = fresh();
      recordAndFold(simulation);
      const checksums = drive(simulation, replayFrames);
      return { checksums, success: simulation.state.success };
    };
    const first = run();
    const second = run();
    expect(first.checksums).toEqual(second.checksums);
    expect(first.success).toBe(true);
  });

  it("does not depend on how the frames are batched", () => {
    const frames = framesFor([
      { forward: true, ticks: 33 },
      { left: true, yawUnits: 1024, ticks: 21 },
      { ticks: 9 },
    ]);
    const oneByOne = fresh();
    for (const frame of frames) oneByOne.step(frame);
    const chunked = fresh();
    for (let index = 0; index < frames.length; index += 7) {
      for (const frame of frames.slice(index, index + 7)) chunked.step(frame);
    }
    expect(oneByOne.checksum()).toBe(chunked.checksum());
  });
});

describe("collision", () => {
  it("slides along a wall instead of stopping dead", () => {
    const simulation = fresh();
    // Face the east wall at 45 degrees and walk into it: x pins, z keeps going.
    drive(simulation, framesFor([{ forward: true, yawUnits: quarterTurn / 2, ticks: 120 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.x).toBeCloseTo(6 - PLAYER_RADIUS, 2);
    expect(actor.z).toBeGreaterThan(6);
  });

  it("pushes a body out of a brush it starts inside", () => {
    const body = { x: 6.1, y: 0, z: 4, vx: 3, vy: 0, vz: 0, grounded: true };
    resolveHorizontal(body, AWAKENING.brushes);
    expect(body.x).toBeCloseTo(6 - PLAYER_RADIUS, 6);
    expect(body.vx).toBe(0);
  });

  it("holds the player on the floor and reports ground contact", () => {
    const simulation = fresh();
    drive(simulation, framesFor([{ ticks: 10 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.y).toBeCloseTo(0, 6);
    expect(standingOn(actor, AWAKENING.brushes)).toBe(true);
  });

  it("jumps roughly 1.1 m and lands again", () => {
    const simulation = fresh();
    let peak = 0;
    for (const frame of framesFor([{ jump: true, ticks: 24 }])) {
      simulation.step(frame);
      peak = Math.max(peak, actorOf(simulation.state, "present").y);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.2);
    expect(actorOf(simulation.state, "present").y).toBeCloseTo(0, 6);
  });

  it("stays in the world when walked into every wall from every angle", () => {
    // The first vertical resolver decided by nearest face, so a body flush
    // against a 4 m wall was read as being under a ceiling and pushed through
    // the floor — after which nothing collided and the player ran off to z=60.
    for (let units = 0; units < YAW_UNITS; units += 128) {
      const simulation = fresh();
      drive(simulation, framesFor([{ forward: true, yawUnits: units, ticks: 200 }]));
      const actor = actorOf(simulation.state, "present");
      expect(actor.y).toBeGreaterThanOrEqual(-0.05);
      expect(actor.y).toBeLessThan(0.05);
      expect(Math.abs(actor.x)).toBeLessThanOrEqual(6.1);
      expect(actor.z).toBeGreaterThan(-0.5);
      expect(actor.z).toBeLessThan(19);
    }
  });

  it("keeps its footing while sliding along a wall", () => {
    const simulation = fresh();
    // Press into the east wall and walk the length of it.
    drive(simulation, framesFor([
      { forward: true, right: true, yawUnits: 0, ticks: 60 },
      { forward: true, right: true, yawUnits: 0, ticks: 60 },
    ]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.grounded).toBe(true);
    expect(actor.y).toBeCloseTo(0, 6);
    expect(actor.x).toBeCloseTo(6 - PLAYER_RADIUS, 2);
  });

  it("will not let a closed door be walked through", () => {
    const simulation = fresh();
    // Skirt the plate down the east side, then turn for the doorway.
    drive(simulation, framesFor([
      { forward: true, right: true, ticks: 30 },
      { forward: true, ticks: 90 },
    ]));
    const actor = actorOf(simulation.state, "present");
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
    expect(actor.z).toBeLessThan(12);
  });

  it("opens once the plate is stood on, and stays open after stepping off", () => {
    const simulation = fresh();
    drive(simulation, framesFor(WALK_TO_PLATE));
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
    drive(simulation, framesFor([{ back: true, ticks: 40 }]));
    expect(simulation.state.plates[0]?.active).toBe(false);
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });
});

describe("record, fold and replay", () => {
  it("refuses to fold before the tape holds a second of intent", () => {
    const simulation = fresh();
    drive(simulation, framesFor([{ forward: true, ticks: MIN_TAPE_TICKS - 1 }]));
    expect(simulation.canFold).toBe(false);
    expect(simulation.fold()).toBe(false);
    expect(simulation.state.phase).toBe("recording");
  });

  it("pads the tape to the room's full window and starts the second pass", () => {
    const simulation = fresh();
    recordAndFold(simulation);
    const tape = simulation.currentTape;
    expect(tape?.duration).toBe(AWAKENING.tapeDurationTicks);
    expect(simulation.state.foldedAtTick).toBe(WALK_TO_PLATE.reduce((sum, hold) => sum + hold.ticks, 0));
    expect(simulation.state.actors.map((actor) => actor.id).sort()).toEqual(["past", "present"]);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });

  it("completes the room: the echo walks the recording and opens the way", () => {
    const simulation = fresh();
    recordAndFold(simulation);
    let echoOpenedIt = false;
    for (const frame of framesFor([{ ticks: 60 }, { forward: true, ticks: 120 }])) {
      simulation.step(frame);
      if (!echoOpenedIt && doorOpen(simulation.state, "inner-door")) {
        // The living player has not moved yet, so this can only be the echo.
        expect(actorOf(simulation.state, "present").z).toBeCloseTo(AWAKENING.spawn.z, 3);
        echoOpenedIt = true;
      }
    }
    expect(echoOpenedIt).toBe(true);
    expect(simulation.state.phase).toBe("success");
    expect(simulation.state.success).toBe(true);
  });

  it("calls the run when the window runs out, and says why", () => {
    const simulation = fresh();
    recordAndFold(simulation);
    const window = AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks;
    drive(simulation, framesFor([{ ticks: window }]));
    expect(simulation.state.phase).toBe("rerecord");
    // The echo did open the door; standing still is what failed.
    expect(simulation.state.lastError).toBe("out-of-time");
  });

  it("starts clean on rerecord but remembers the reason", () => {
    const simulation = fresh();
    recordAndFold(simulation);
    drive(simulation, framesFor([{ ticks: AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks }]));
    simulation.rerecord();
    expect(simulation.state.phase).toBe("recording");
    expect(simulation.recordedFrames.length).toBe(0);
    expect(simulation.state.lastError).toBe("out-of-time");
    expect(actorOf(simulation.state, "present").z).toBeCloseTo(AWAKENING.spawn.z, 6);
  });

  it("ends the recording on its own when the tape is full", () => {
    const simulation = fresh();
    drive(simulation, framesFor([{ forward: true, ticks: AWAKENING.tapeDurationTicks }]));
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.foldedAtTick).toBeNull();
  });
});

describe("the fold tail is the posture, not an event", () => {
  const tailOf = (holds: Hold[]): number => {
    const simulation = fresh();
    drive(simulation, framesFor(holds));
    const tail = simulation.foldTail;
    expect(tail).not.toBeNull();
    return tail ?? NEUTRAL_FRAME;
  };

  it("keeps the feet, the gaze and the grip that were being held", () => {
    const tail = tailOf([{ forward: true, act: true, yawUnits: 512, ticks: 40 }]);
    expect(buttonsOf(tail) & Button.Forward).toBeTruthy();
    expect(buttonsOf(tail) & Button.Act).toBeTruthy();
    expect(yawUnitsOf(tail)).toBe(512);
  });

  it("carries a held posture through the whole padded tape", () => {
    const simulation = fresh();
    drive(simulation, framesFor([{ forward: true, act: true, yawUnits: 512, ticks: 40 }]));
    const tail = simulation.foldTail;
    simulation.fold();
    const frames = simulation.currentTape?.frames ?? [];
    expect(frames.length).toBe(AWAKENING.tapeDurationTicks);
    for (let index = 40; index < frames.length; index += 1) expect(frames[index]).toBe(tail);
  });

  it("does not re-fire a jump for every tick of the tail", () => {
    // Fold mid-air with jump still held: a tail that carried press edges would
    // make the echo hop forever. Edges are derived from transitions, so it does not.
    const simulation = fresh();
    drive(simulation, framesFor([{ ticks: 40 }, { jump: true, ticks: 4 }]));
    simulation.fold();
    let airborneTicks = 0;
    for (let index = 0; index < 120; index += 1) {
      simulation.step(NEUTRAL_FRAME);
      if (actorOf(simulation.state, "past").y > 0.01) airborneTicks += 1;
    }
    expect(airborneTicks).toBeGreaterThan(0);
    expect(airborneTicks).toBeLessThan(40);
  });

  it("lets the echo keep walking when the recording ended walking", () => {
    const simulation = fresh();
    drive(simulation, framesFor([{ forward: true, ticks: 40 }]));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: 90 }]));
    const echo = actorOf(simulation.state, "past");
    // Held forward for the whole tail, so it is pressed against the far wall.
    expect(echo.z).toBeGreaterThan(11);
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });
});

describe("tapes", () => {
  it("round-trips through validation", () => {
    const frames = framesFor([{ forward: true, ticks: AWAKENING.tapeDurationTicks }]);
    const tape = createTape(AWAKENING, frames);
    expect(validateTape(AWAKENING, tape)).toBeNull();
    expect(tape.tickRate).toBe(TICK_RATE);
  });

  it("rejects a tampered frame list", () => {
    const frames = framesFor([{ forward: true, ticks: AWAKENING.tapeDurationTicks }]);
    const tape = createTape(AWAKENING, frames);
    const tampered = { ...tape, frames: [...tape.frames.slice(0, -1), NEUTRAL_FRAME] };
    expect(validateTape(AWAKENING, tampered)).toBe("tape-checksum-mismatch");
  });

  it("rejects a tape recorded against another version of the room", () => {
    const frames = framesFor([{ forward: true, ticks: AWAKENING.tapeDurationTicks }]);
    const tape = createTape({ ...AWAKENING, version: 99 }, frames);
    expect(validateTape(AWAKENING, tape)).toBe("tape-room-mismatch");
  });

  it("replays a loaded tape exactly as it replays a recorded one", () => {
    const recorded = fresh();
    recordAndFold(recorded);
    const tape = recorded.currentTape;
    expect(tape).not.toBeNull();

    const loaded = fresh();
    expect(tape && loaded.loadTape(tape)).toBe(true);
    const frames = framesFor([{ ticks: 40 }, { forward: true, ticks: 130 }]);
    expect(drive(recorded, frames)).toEqual(drive(loaded, frames));
    expect(loaded.state.success).toBe(true);
  });
});
