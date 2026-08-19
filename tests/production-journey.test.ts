import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { createInitialState, Simulation } from "../src/core/simulation";
import type { ChamberDefinition, ChamberId, Tape } from "../src/core/types";
import { CHAMBERS } from "../src/content/chambers";
import { goldenFor } from "../src/content/golden";
import { FOUR_ROOM_ROUTE } from "../src/content/manifests";

const EXPECTED_ROUTE = ["crossing", "traceWeight", "handoff", "lastHold"] as const;

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

describe("four-room production manifest", () => {
  it("keeps the authored route stable", () => {
    expect(FOUR_ROOM_ROUTE).toEqual(EXPECTED_ROUTE);
  });

  it("defines each route entry exactly once", () => {
    expect(new Set(FOUR_ROOM_ROUTE).size).toBe(EXPECTED_ROUTE.length);
    expect(Object.keys(CHAMBERS).sort()).toEqual([...EXPECTED_ROUTE].sort());
  });

  it.each(EXPECTED_ROUTE)("keeps %s within the fourteen-second tape limit", (chamberId) => {
    expect(CHAMBERS[chamberId].tapeDurationTicks).toBeLessThanOrEqual(14 * 30);
  });
});

describe("four-room cooperation contract", () => {
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

  it.each(EXPECTED_ROUTE)("does not complete %s when the past actor is idle", (chamberId) => {
    const chamber = CHAMBERS[chamberId];
    const golden = goldenFor(chamberId);
    const simulation = run(chamber, idleTape(chamber), golden.present);
    expect(simulation.state.success).toBe(false);
  });

  it.each(EXPECTED_ROUTE)("authors the %s past tape through a fold with an ActionHeld-only tail", (chamberId) => {
    const holdOnly = encodeInput({ actionHeld: true });
    const tape = goldenFor(chamberId).past;
    expect(tape.frames).toHaveLength(CHAMBERS[chamberId].tapeDurationTicks);
    expect(tape.frames.at(-1)).toBe(holdOnly);
  });
});

describe("authored emotional gates", () => {
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

  it("requires the present to redirect the staged Handoff core through the gate the past holds open", () => {
    const chamber = CHAMBERS.handoff;
    const golden = goldenFor("handoff");
    expect(golden.present).not.toEqual(golden.past.frames);
    const simulation = run(chamber, golden.past, golden.present);
    expect(simulation.state.handoff).toMatchObject({
      stagedByPast: true,
      receivedByPresent: true,
      redirectedByPresent: true,
      delivered: true,
    });
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
    const route: readonly ChamberId[] = FOUR_ROOM_ROUTE;
    expect(route).toEqual(EXPECTED_ROUTE);
  });
});
