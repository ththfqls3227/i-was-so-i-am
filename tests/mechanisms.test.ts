import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import { POSITION_SCALE, type ChamberDefinition, type Rect } from "../src/core/types";
import { CROSSING_CHAMBER, HANDOFF_CHAMBER } from "../src/content/chambers";

function scaledRect(x: number, y: number, width: number, height: number): Rect {
  return { x: x * POSITION_SCALE, y: y * POSITION_SCALE, width: width * POSITION_SCALE, height: height * POSITION_SCALE };
}

function boundaryWalls(width: number, height: number): Rect[] {
  return [
    scaledRect(0, 0, width, 2),
    scaledRect(0, height - 2, width, 2),
    scaledRect(0, 0, 2, height),
    scaledRect(width - 2, 0, 2, height),
  ];
}

function leftPushChamber(): ChamberDefinition {
  return {
    id: "lastHold",
    version: 1,
    name: "TEST LEFT PUSH",
    subtitle: "",
    hint: "",
    tapeDurationTicks: 8 * 30,
    world: { width: 80 * POSITION_SCALE, height: 45 * POSITION_SCALE },
    spawn: { x: 70 * POSITION_SCALE, y: 22 * POSITION_SCALE },
    forceObject: {
      id: "test-block",
      ...scaledRect(54, 17, 8, 10),
      axis: "x",
      minX: 44 * POSITION_SCALE,
      maxX: 54 * POSITION_SCALE,
      threshold: 1,
      force: 0,
      pushDirection: "left",
    },
    walls: boundaryWalls(80, 45),
    exit: { id: "test-exit", ...scaledRect(6, 17, 6, 10), open: false },
  };
}

describe("bidirectional force object", () => {
  it("moves left under an aligned pusher on its right face and opens the exit at minX", () => {
    const chamber = leftPushChamber();
    const simulation = new Simulation(chamber);
    const pushLeft = encodeInput({ left: true, actionHeld: true });
    let sawForce = false;
    for (let tick = 0; tick < 120; tick += 1) {
      simulation.step(pushLeft);
      sawForce ||= (simulation.state.forceObject?.force ?? 0) > 0;
    }
    expect(sawForce).toBe(true);
    expect(simulation.state.forceObject?.x).toBe(chamber.forceObject?.minX);
    expect(simulation.state.exit.open).toBe(true);
  });

  it("does not credit a pusher facing away from the push direction", () => {
    const chamber = leftPushChamber();
    const simulation = new Simulation(chamber);
    const approach = encodeInput({ left: true });
    for (let tick = 0; tick < 10; tick += 1) simulation.step(approach);
    // Turn around and hold from the same spot: wrong facing, no credit.
    const holdFacingRight = encodeInput({ right: true, actionHeld: true });
    for (let tick = 0; tick < 20; tick += 1) simulation.step(holdFacingRight);
    expect(simulation.state.forceObject?.x).toBe(chamber.forceObject?.maxX);
  });
});

describe("door decoupled from hold", () => {
  it("keeps an ungated door in its authored state instead of forcing it closed", () => {
    const chamber = structuredClone(CROSSING_CHAMBER);
    delete chamber.hold;
    chamber.door = { id: "free-door", rect: scaledRect(39, 17, 2, 11), open: true };
    const simulation = new Simulation(chamber);
    for (let tick = 0; tick < 30; tick += 1) simulation.step(encodeInput({ right: true }));
    expect(simulation.state.door?.open).toBe(true);
  });
});

describe("structured failure codes", () => {
  function timedOut(chamber: ChamberDefinition): Simulation {
    const source = new Simulation(chamber);
    for (let tick = 0; tick < chamber.tapeDurationTicks; tick += 1) source.step(NEUTRAL_INPUT);
    const tape = source.tape;
    if (!tape) throw new Error("Idle tape was not created");
    const simulation = new Simulation(chamber);
    expect(simulation.loadTape(tape)).toBeNull();
    while (simulation.state.phase === "replay") simulation.step(NEUTRAL_INPUT);
    return simulation;
  }

  it("reports door-closed when the crossing times out behind a shut bridge", () => {
    const simulation = timedOut(CROSSING_CHAMBER);
    expect(simulation.state.phase).toBe("rerecord");
    expect(simulation.state.lastError).toBe("door-closed");
  });

  it("reports carrier-not-staged when the handoff past never stages the carrier", () => {
    const simulation = timedOut(HANDOFF_CHAMBER);
    expect(simulation.state.phase).toBe("rerecord");
    expect(simulation.state.lastError).toBe("carrier-not-staged");
  });

  it("keeps tape validation failures as structured codes", () => {
    const source = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < CROSSING_CHAMBER.tapeDurationTicks; tick += 1) source.step(NEUTRAL_INPUT);
    const tape = source.tape;
    if (!tape) throw new Error("Idle tape was not created");
    const simulation = new Simulation(CROSSING_CHAMBER);
    expect(simulation.loadTape({ ...tape, checksum: "00000000" })).toBe("tape-checksum-mismatch");
    expect(simulation.state.lastError).toBe("tape-checksum-mismatch");
  });
});
