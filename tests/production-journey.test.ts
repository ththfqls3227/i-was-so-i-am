import { describe, expect, it } from "vitest";
import { InputBit, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { createInitialState, Simulation, simulationConstants } from "../src/core/simulation";
import type { ChamberDefinition, ChamberId, Tape } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { goldenFor } from "../src/content/golden";
import {
  CHAMBER_ROUTE,
  CHAMBER_SECTORS,
  CHAMBER_TAPE_CAP_TICKS,
  PROLOGUE_TAPE_CAP_TICKS,
} from "../src/content/manifests";

const EXPECTED_ROUTE = [
  "awakening",
  "secondSelf",
  "crossing",
  "handNotBody",
  "traceWeight",
  "handoff",
  "lastHold",
] as const;

/**
 * Chamber 00 teaches the record/replay loop and nothing else: the present
 * presses its own plate, so an idle past still finishes it. Every other room
 * owes the cooperation assertion below.
 */
const SOLO_SOLVABLE: readonly ChamberId[] = ["awakening"];
const COOPERATIVE = EXPECTED_ROUTE.filter((id) => !SOLO_SOLVABLE.includes(id));

function run(chamber: ChamberDefinition, tape: Tape, presentFrames: InputFrame[]): Simulation {
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  for (const frame of presentFrames) {
    if (simulation.state.phase !== "replay") break;
    simulation.step(frame);
  }
  return simulation;
}

function idleTape(chamber: ChamberDefinition): Tape {
  const simulation = new Simulation(chamber);
  for (let tick = 0; tick < chamber.tapeDurationTicks; tick += 1) {
    simulation.step(NEUTRAL_INPUT);
  }
  if (!simulation.tape) throw new Error(`Idle tape was not created for ${chamber.id}`);
  return simulation.tape;
}

describe("production manifest", () => {
  it("keeps the authored route stable", () => {
    expect(CHAMBER_ROUTE).toEqual(EXPECTED_ROUTE);
  });

  it("defines each route entry exactly once", () => {
    expect(new Set(CHAMBER_ROUTE).size).toBe(EXPECTED_ROUTE.length);
    expect(Object.keys(CHAMBERS).sort()).toEqual([...EXPECTED_ROUTE].sort());
  });

  it("files every chamber under exactly one sector, in route order", () => {
    expect(CHAMBER_SECTORS.flatMap((sector) => [...sector.chambers])).toEqual([...EXPECTED_ROUTE]);
  });

  it.each(EXPECTED_ROUTE)("keeps %s inside its sector's tape budget", (chamberId) => {
    const prologue = CHAMBER_SECTORS[0]?.chambers ?? [];
    const cap = prologue.includes(chamberId) ? PROLOGUE_TAPE_CAP_TICKS : CHAMBER_TAPE_CAP_TICKS;
    expect(CHAMBERS[chamberId].tapeDurationTicks).toBeLessThanOrEqual(cap);
  });
});

describe("cooperation contract", () => {
  it.each(EXPECTED_ROUTE)("completes %s on its canonical golden path", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const golden = goldenFor(chamberId);
    const simulation = run(chamber, golden.past, golden.present);
    expect(simulation.state.success).toBe(true);
    expect(simulation.state.phase).toBe("success");
  });

  it.each(EXPECTED_ROUTE)("does not complete %s when the present actor is idle", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const golden = goldenFor(chamberId);
    const simulation = run(chamber, golden.past, Array<InputFrame>(chamber.tapeDurationTicks).fill(NEUTRAL_INPUT));
    expect(simulation.state.success).toBe(false);
  });

  it.each(COOPERATIVE)("does not complete %s when the past actor is idle", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const golden = goldenFor(chamberId);
    const simulation = run(chamber, idleTape(chamber), golden.present);
    expect(simulation.state.success).toBe(false);
  });

  it.each(SOLO_SOLVABLE)("completes %s from an idle recording — the prologue asks for no help", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const simulation = run(chamber, idleTape(chamber), goldenFor(chamberId).present);
    expect(simulation.state.success).toBe(true);
  });

  it.each(EXPECTED_ROUTE)("authors the %s past tape through a fold that repeats one steady posture", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const tape = goldenFor(chamberId).past;
    expect(tape.frames).toHaveLength(chamber.tapeDurationTicks);
    const tail = tape.frames.at(-1) ?? 0;
    // A posture is which keys are down. Edges are events and must not repeat.
    expect(tail & (InputBit.ActionPressed | InputBit.ActionReleased)).toBe(0);
    // Whatever the tail is, every filled tick is the same one — the echo holds
    // a single pose rather than replaying anything.
    const filled = tape.frames.slice(-simulationConstants.minTapeTicks);
    expect(filled.every((frame) => frame === tail)).toBe(true);
  });
});

describe("authored emotional gates", () => {
  it("opens Awakening's door from the plate and leaves it open behind the player", () => {
    const chamber = CHAMBERS.awakening;
    const golden = goldenFor("awakening");
    const simulation = run(chamber, golden.past, golden.present);
    expect(simulation.state.door?.latched).toBe(true);
    expect(simulation.state.success).toBe(true);
  });

  it("holds Second Self's door open only while the echo stands on the plate", () => {
    const chamber = CHAMBERS.secondSelf;
    const golden = goldenFor("secondSelf");
    const simulation = new Simulation(chamber);
    expect(simulation.loadTape(golden.past)).toBeNull();
    let sawEchoPressing = false;
    for (const frame of golden.present) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      sawEchoPressing ||= simulation.state.plate?.pressedBy.includes("past") === true && simulation.state.door?.open === true;
    }
    expect(sawEchoPressing).toBe(true);
    expect(simulation.state.success).toBe(true);
    // The living self standing there instead would open nothing.
    const solo = run(chamber, idleTape(chamber), golden.present);
    expect(solo.state.plate?.active).toBe(false);
    expect(solo.state.success).toBe(false);
  });

  it("walks Hand, Not Body's echo through a door its recording never saw open", () => {
    const chamber = CHAMBERS.handNotBody;
    const golden = goldenFor("handNotBody");
    const doorX = chamber.door?.rect.x ?? Number.POSITIVE_INFINITY;
    // The recording ends with the past still pinned on the near side.
    const recording = new Simulation(chamber);
    for (const frame of golden.past.frames) {
      if (recording.state.phase !== "recording") break;
      recording.step(frame);
    }
    expect(recording.state.actors[0]?.x).toBeLessThan(doorX);

    const simulation = run(chamber, golden.past, golden.present);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    expect(past?.x).toBeGreaterThan(doorX);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.success).toBe(true);
  });

  it("crosses Trace Weight's first gate while the past holds the winch", () => {
    const chamber = CHAMBERS.traceWeight;
    const golden = goldenFor("traceWeight");
    const simulation = new Simulation(chamber);
    expect(simulation.loadTape(golden.past)).toBeNull();
    for (const frame of golden.present) {
      simulation.step(frame);
      if (simulation.state.door?.latched) break;
    }
    expect(simulation.state.door?.latched).toBe(true);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.forceObject?.x).toBe(chamber.forceObject?.minX);
  });

  it("moves Trace Weight only after both actors contribute beyond the crossed gate", () => {
    const chamber = CHAMBERS.traceWeight;
    const golden = goldenFor("traceWeight");
    const simulation = new Simulation(chamber);
    expect(simulation.loadTape(golden.past)).toBeNull();
    const initialX = chamber.forceObject?.minX;
    for (const frame of golden.present) {
      simulation.step(frame);
      if (simulation.state.forceObject?.x !== initialX) break;
    }
    expect(simulation.state.door?.latched).toBe(true);
    expect(simulation.state.forceObject?.force).toBe(chamber.forceObject?.threshold);
    expect(simulation.state.forceObject?.x).toBeGreaterThan(initialX ?? Number.POSITIVE_INFINITY);
  });

  it("leaves the past credited at the handle behind the bridged gap while the present crosses Last Hold", () => {
    const chamber = CHAMBERS.lastHold;
    const golden = goldenFor("lastHold");
    const simulation = run(chamber, golden.past, golden.present);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    const present = simulation.state.actors.find((actor) => actor.id === "present");
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.forceObject?.x).toBe(chamber.forceObject?.minX);
    expect(past?.x).toBeLessThan(chamber.door?.rect.x ?? Number.NEGATIVE_INFINITY);
    expect(present?.x).toBeGreaterThan(chamber.door?.rect.x ?? Number.POSITIVE_INFINITY);
  });

  it("requires the present to carry the Handoff box through the gate the past holds open", () => {
    const chamber = CHAMBERS.handoff;
    const golden = goldenFor("handoff");
    expect(golden.present).not.toEqual(golden.past.frames);
    const simulation = run(chamber, golden.past, golden.present);
    expect(simulation.state.handoff).toMatchObject({ carriedByPresent: true, delivered: true });
    expect(simulation.state.door?.open).toBe(true);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(simulation.state.success).toBe(true);
  });
});

describe("canonical room reset", () => {
  it.each(EXPECTED_ROUTE)("restores %s to its authored recording state", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const simulation = new Simulation(chamber);
    expect(simulation.loadTape(goldenFor(chamberId).past)).toBeNull();
    simulation.step(goldenFor(chamberId).present[0]);
    simulation.rerecord();
    expect(simulation.state).toEqual(createInitialState(chamber));
    expect(simulation.tape).toBeNull();
  });
});

describe("typed route contract", () => {
  it("accepts every production route entry as a ChamberId", () => {
    const route: readonly ChamberId[] = CHAMBER_ROUTE;
    expect(route).toEqual(EXPECTED_ROUTE);
  });
});
