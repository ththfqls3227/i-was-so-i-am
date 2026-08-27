import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { MIN_TAPE_TICKS, PLAYER_RADIUS, STEP_HEIGHT } from "../src/sim/constants";
import type { RoomDefinition } from "../src/sim/types";
import { solidsFor } from "../src/sim/mechanisms";
import { AWAKENING } from "../src/world/room";
import { actorOf, doorOpen, drive, framesFor, WALK_TO_PLATE } from "./support/fp-drive";
import { door, ENTRY_PLATE, FAR_PLATE, PILLAR, roomWith, SECOND_PILLAR } from "./support/fp-rooms";

const holdState = (simulation: Simulation, id: string): boolean =>
  simulation.state.holds.find((hold) => hold.id === id)?.active ?? false;

describe("grips", () => {
  const gripRoom = roomWith({ holds: [PILLAR], doors: [door({ kind: "hold", id: "pillar" })] });

  it("is taken by looking at it and holding Act", () => {
    const simulation = new Simulation(gripRoom);
    drive(simulation, framesFor([{ ticks: 2 }]));
    expect(holdState(simulation, "pillar")).toBe(false);
    drive(simulation, framesFor([{ act: true, ticks: 2 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    expect(actorOf(simulation.state, "present").targetId).toBe("pillar");
  });

  it("is not taken by holding Act while looking elsewhere", () => {
    const simulation = new Simulation(gripRoom);
    // Facing half a turn away from the pillar.
    drive(simulation, framesFor([{ act: true, yawUnits: 2048, ticks: 6 }]));
    expect(holdState(simulation, "pillar")).toBe(false);
  });

  it("survives looking away once it is in hand", () => {
    const simulation = new Simulation(gripRoom);
    drive(simulation, framesFor([{ act: true, ticks: 3 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    drive(simulation, framesFor([{ act: true, yawUnits: 2048, ticks: 10 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
  });

  it("is lost by walking out of reach, and cannot be retaken until Act is released", () => {
    const simulation = new Simulation(gripRoom);
    drive(simulation, framesFor([{ act: true, ticks: 3 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    // Back away past the release radius, still holding Act.
    drive(simulation, framesFor([{ act: true, back: true, ticks: 40 }]));
    expect(holdState(simulation, "pillar")).toBe(false);
    expect(actorOf(simulation.state, "present").lockedOutTargetId).toBe("pillar");
    // Walking back into range with Act still down must not re-grip. Stop short
    // of the pillar so it is still in front of the crosshair.
    drive(simulation, framesFor([{ act: true, forward: true, ticks: 20 }]));
    expect(holdState(simulation, "pillar")).toBe(false);
    // Letting go clears the lockout.
    drive(simulation, framesFor([{ ticks: 2 }, { act: true, ticks: 4 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
  });

  it("lets a held hand reach a different grip without releasing", () => {
    // The lockout bars the grip you walked away from, not every grip. This is
    // the failure the 2D core had to be taught twice.
    const twoGrips = roomWith({
      holds: [PILLAR, SECOND_PILLAR],
      doors: [door({ kind: "hold", id: "second-pillar" })],
    });
    const simulation = new Simulation(twoGrips);
    drive(simulation, framesFor([{ act: true, ticks: 3 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    // Walk sideways to the other pillar without ever letting go.
    drive(simulation, framesFor([{ act: true, right: true, ticks: 22 }, { act: true, ticks: 6 }]));
    expect(holdState(simulation, "pillar")).toBe(false);
    expect(holdState(simulation, "second-pillar")).toBe(true);
    expect(actorOf(simulation.state, "present").targetId).toBe("second-pillar");
    // Taking hold of something else is what clears the lockout — the bar was
    // only ever on the grip this hand walked out of.
    expect(actorOf(simulation.state, "present").lockedOutTargetId).toBeNull();
  });

  it("opens a door while held and closes it when let go", () => {
    const simulation = new Simulation(gripRoom);
    drive(simulation, framesFor([{ act: true, ticks: 4 }]));
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
    drive(simulation, framesFor([{ ticks: 3 }]));
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });

  it("credits only the actor a grip asks for", () => {
    const echoOnly = roomWith({
      holds: [{ ...PILLAR, requiredActor: "past" }],
      doors: [door({ kind: "hold", id: "pillar" })],
    });
    const simulation = new Simulation(echoOnly);
    drive(simulation, framesFor([{ act: true, ticks: 6 }]));
    expect(actorOf(simulation.state, "present").targetId).toBe("pillar");
    expect(holdState(simulation, "pillar")).toBe(false);
  });
});

describe("the finale mechanism", () => {
  it("keeps a non-latching door open on a grip the echo was folded holding", () => {
    // Room 09 in miniature. The only door in the campaign that does not latch,
    // held open for as long as it takes by a hand that was frozen holding it.
    const finale = roomWith({
      holds: [PILLAR],
      doors: [door({ kind: "hold", id: "pillar" }, false)],
    });
    const simulation = new Simulation(finale);
    drive(simulation, framesFor([{ act: true, ticks: MIN_TAPE_TICKS + 4 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    expect(simulation.fold()).toBe(true);

    // The living player stands well clear; only the echo can be holding this.
    drive(simulation, framesFor([{ ticks: 60 }]));
    expect(actorOf(simulation.state, "past").targetId).toBe("pillar");
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);

    // And past the end of the tape, which is where the gauge runs out and the
    // player is still walking to a gate twelve seconds away.
    drive(simulation, framesFor([{ ticks: AWAKENING.tapeDurationTicks + 90 }]));
    expect(holdState(simulation, "pillar")).toBe(true);
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });

  it("lets the second pass outlive its window when the echo persists", () => {
    const finale = roomWith({
      holds: [PILLAR],
      doors: [door({ kind: "hold", id: "pillar" }, false)],
      echoPersists: true,
    });
    const simulation = new Simulation(finale);
    drive(simulation, framesFor([{ act: true, ticks: MIN_TAPE_TICKS + 4 }]));
    simulation.fold();
    const beyond = AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks + 200;
    drive(simulation, framesFor([{ ticks: beyond }]));
    expect(simulation.state.phase).toBe("replay");
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });

  it("leaves the echo standing there after the run is won", () => {
    // "Cross the threshold and look back and he is still there." Nothing has to
    // be skipped for this — winning freezes the world rather than clearing it —
    // so the test exists to stop that being changed by accident.
    const simulation = new Simulation(roomWith({ holds: [], doors: [door({ kind: "plate", id: "entry-plate" }, true)] }));
    drive(simulation, framesFor(WALK_TO_PLATE));
    simulation.fold();
    drive(simulation, framesFor([{ forward: true, ticks: 200 }]));
    expect(simulation.state.phase).toBe("success");
    expect(simulation.state.actors.map((actor) => actor.id).sort()).toEqual(["past", "present"]);
  });

  it("still ends the second pass in a room that does not ask for that", () => {
    const simulation = new Simulation(roomWith({ holds: [PILLAR], doors: [door({ kind: "hold", id: "pillar" }, false)] }));
    drive(simulation, framesFor([{ act: true, ticks: MIN_TAPE_TICKS + 4 }]));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks }]));
    expect(simulation.state.phase).toBe("rerecord");
  });
});

describe("a door that waits before it moves", () => {
  // No shipped room uses one any more: every plate in the building is now
  // instant both ways, which is the rule the owner asked for and the one 00
  // used to be the single exception to. The field is still supported, so it
  // stays tested — on a synthetic room, where a timing is chosen on purpose
  // rather than inherited from a chamber three files away.
  const delay = 22;

  it("counts only while the plate is pressed, and opens exactly on the delay", () => {
    const waiting = roomWith({
      doors: [{ ...door({ kind: "plate", id: "entry-plate" }, false), openDelayTicks: delay }],
    });
    const simulation = new Simulation(waiting);
    // Walk on and stand there, one tick at a time, watching the count.
    drive(simulation, framesFor([{ forward: true, ticks: 38 }]));
    while ((simulation.state.doors[0]?.heldTicks ?? 0) < delay - 1) {
      expect(simulation.state.doors[0]?.open).toBe(false);
      drive(simulation, framesFor([{ ticks: 1 }]));
    }
    // One short.
    expect(simulation.state.doors[0]?.heldTicks).toBe(delay - 1);
    expect(simulation.state.doors[0]?.open).toBe(false);
    // And there.
    drive(simulation, framesFor([{ ticks: 1 }]));
    expect(simulation.state.doors[0]?.heldTicks).toBe(delay);
    expect(simulation.state.doors[0]?.open).toBe(true);
  });

  it("is still solid one tick before the delay, and gone on it", () => {
    // A plate that is pressed from the first tick, so the only thing between
    // the player and the doorway is the wait.
    const waiting = roomWith({
      plates: [{ ...ENTRY_PLATE, forcedActive: true }],
      holds: [],
      doors: [{ ...door({ kind: "plate", id: "entry-plate" }, false), openDelayTicks: delay }],
    });
    const simulation = new Simulation(waiting);

    drive(simulation, framesFor([{ ticks: delay - 1 }]));
    expect(simulation.state.doors[0]?.open).toBe(false);
    // The brush is what stops a player, so that is what gets asserted.
    expect(solidsFor(waiting, simulation.state.doors).some((brush) => brush.id === "inner-door")).toBe(true);

    drive(simulation, framesFor([{ ticks: 1 }]));
    expect(simulation.state.doors[0]?.open).toBe(true);
    expect(solidsFor(waiting, simulation.state.doors).some((brush) => brush.id === "inner-door")).toBe(false);
  });

  it("actually blocks a walking player until it opens", () => {
    // Long enough that the player arrives at the doorway before the wait is up.
    const slow = 120;
    const waiting = roomWith({
      plates: [{ ...ENTRY_PLATE, forcedActive: true }],
      holds: [],
      doors: [{ ...door({ kind: "plate", id: "entry-plate" }, true), openDelayTicks: slow }],
    });
    const simulation = new Simulation(waiting);
    drive(simulation, framesFor([{ forward: true, ticks: slow - 20 }]));
    expect(simulation.state.doors[0]?.open).toBe(false);
    expect(actorOf(simulation.state, "present").z).toBeLessThan(12);

    drive(simulation, framesFor([{ forward: true, ticks: 80 }]));
    expect(simulation.state.doors[0]?.open).toBe(true);
    expect(actorOf(simulation.state, "present").z).toBeGreaterThan(12.6);
  });

  it("forgets its progress if the gate is let go", () => {
    const waiting = roomWith({
      plates: [ENTRY_PLATE],
      holds: [],
      doors: [{ ...door({ kind: "plate", id: "entry-plate" }, false), openDelayTicks: delay }],
    });
    const simulation = new Simulation(waiting);
    drive(simulation, framesFor([{ forward: true, ticks: 38 }, { ticks: 4 }]));
    expect(simulation.state.doors[0]?.heldTicks).toBeGreaterThan(0);
    expect(simulation.state.doors[0]?.open).toBe(false);
    drive(simulation, framesFor([{ back: true, ticks: 30 }]));
    expect(simulation.state.doors[0]?.heldTicks).toBe(0);
  });
});

describe("stairs", () => {
  /**
   * A flight rising in `rise` steps, each 0.6 m deep, with a landing on top —
   * without the landing the body climbs the flight and then walks straight off
   * the end of it, which is a fall, not a failure to climb.
   */
  const flight = (rise: number, steps: number, fromZ = 4): RoomDefinition["brushes"] => {
    const treads: RoomDefinition["brushes"] = [];
    for (let index = 0; index < steps; index += 1) {
      treads.push({
        id: `tread-${index}`,
        min: { x: -3, y: -0.6, z: fromZ + index * 0.6 },
        max: { x: 3, y: rise * (index + 1), z: fromZ + (index + 1) * 0.6 },
      });
    }
    const topZ = fromZ + steps * 0.6;
    treads.push({
      id: "landing",
      min: { x: -3, y: -0.6, z: topZ },
      max: { x: 3, y: rise * steps, z: topZ + 3 },
    });
    // A wall at the end of the landing, so a body that climbed successfully
    // stays up there instead of strolling off and reporting a fall as a failure
    // to climb.
    treads.push({
      id: "landing-end",
      min: { x: -3, y: -0.6, z: topZ + 3 },
      max: { x: 3, y: rise * steps + 3, z: topZ + 3.6 },
    });
    return treads;
  };

  const stairRoom = (rise: number, steps = 6) =>
    roomWith({
      holds: [],
      plates: [],
      doors: [],
      brushes: [...AWAKENING.brushes, ...flight(rise, steps)],
    });

  it("walks up a flight at the step height without jumping", () => {
    const simulation = new Simulation(stairRoom(STEP_HEIGHT));
    drive(simulation, framesFor([{ forward: true, ticks: 90 }]));
    const actor = actorOf(simulation.state, "present");
    // Six treads at 0.35 puts the landing at 2.1 m, and nothing here ever jumped.
    expect(actor.y).toBeCloseTo(STEP_HEIGHT * 6, 2);
    expect(actor.z).toBeGreaterThan(7.6);
  });

  it("climbs at walking pace rather than one step per jump", () => {
    // Six steps inside two seconds is the difference between a staircase and an
    // obstacle course.
    const simulation = new Simulation(stairRoom(STEP_HEIGHT));
    drive(simulation, framesFor([{ forward: true, ticks: 60 }]));
    expect(actorOf(simulation.state, "present").y).toBeCloseTo(STEP_HEIGHT * 6, 2);
  });

  it("walks back down again", () => {
    const simulation = new Simulation(stairRoom(STEP_HEIGHT));
    drive(simulation, framesFor([{ forward: true, ticks: 90 }]));
    expect(actorOf(simulation.state, "present").y).toBeCloseTo(STEP_HEIGHT * 6, 2);
    drive(simulation, framesFor([{ back: true, ticks: 150 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.y).toBeCloseTo(0, 2);
    expect(actor.z).toBeLessThan(4);
  });

  it("refuses a step taller than the step height", () => {
    // A hair over, and it is a wall again.
    const simulation = new Simulation(stairRoom(STEP_HEIGHT + 0.02));
    drive(simulation, framesFor([{ forward: true, ticks: 90 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.y).toBeCloseTo(0, 3);
    expect(actor.z).toBeLessThan(4);
  });

  it("does not let a body climb in mid-air", () => {
    // Jumping at a too-tall step must not convert into a climb on the way past.
    const simulation = new Simulation(stairRoom(1.2, 2));
    drive(simulation, framesFor([{ forward: true, jump: true, ticks: 90 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.y).toBeLessThan(1.2);
    expect(actor.z).toBeLessThan(4.4);
  });

  it("leaves a plain wall exactly as impassable as it was", () => {
    // Into the side wall, which has no doorway in it to walk through.
    const simulation = new Simulation(roomWith({ holds: [], plates: [], doors: [] }));
    drive(simulation, framesFor([{ forward: true, yawUnits: 1024, ticks: 200 }]));
    const actor = actorOf(simulation.state, "present");
    expect(actor.y).toBeCloseTo(0, 6);
    expect(actor.x).toBeCloseTo(6 - PLAYER_RADIUS, 2);
  });
});

describe("composite gates", () => {
  const bothPlates = roomWith({
    plates: [ENTRY_PLATE, FAR_PLATE],
    holds: [],
    doors: [
      door({
        kind: "all",
        of: [
          { kind: "plate", id: "entry-plate" },
          { kind: "plate", id: "far-plate" },
        ],
      }),
    ],
  });

  it("stays shut for one of two plates", () => {
    const simulation = new Simulation(bothPlates);
    drive(simulation, framesFor(WALK_TO_PLATE));
    expect(simulation.state.plates.find((plate) => plate.id === "entry-plate")?.active).toBe(true);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });

  it("opens when a forced plate supplies the second half", () => {
    // Room 08: one plate is already pressed by a record the archive is
    // replaying, and the player only has to stand on the other.
    const withOldEcho = roomWith({
      plates: [ENTRY_PLATE, { ...FAR_PLATE, forcedActive: true }],
      holds: [],
      doors: bothPlates.doors,
    });
    const simulation = new Simulation(withOldEcho);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
    drive(simulation, framesFor(WALK_TO_PLATE));
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });

  it("refuses an empty conjunction", () => {
    const simulation = new Simulation(roomWith({ holds: [], doors: [door({ kind: "all", of: [] })] }));
    drive(simulation, framesFor([{ ticks: 4 }]));
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });
});

describe("the exit gate", () => {
  it("is open from the start when a room does not gate it", () => {
    expect(new Simulation(AWAKENING).state.exitOpen).toBe(true);
  });

  it("follows a grip when a room gates it on one", () => {
    const gated = roomWith({
      holds: [PILLAR],
      doors: [door({ kind: "plate", id: "entry-plate" }, true)],
      exitGatedBy: { kind: "hold", id: "pillar" },
    });
    const simulation = new Simulation(gated);
    expect(simulation.state.exitOpen).toBe(false);
    drive(simulation, framesFor([{ act: true, ticks: 4 }]));
    expect(simulation.state.exitOpen).toBe(true);
    drive(simulation, framesFor([{ ticks: 3 }]));
    expect(simulation.state.exitOpen).toBe(false);
  });
});

describe("a room that takes no recording", () => {
  const silent = roomWith({
    recordingDisabled: true,
    plates: [ENTRY_PLATE, { ...FAR_PLATE, forcedActive: true }],
    holds: [],
    doors: [
      door({
        kind: "all",
        of: [
          { kind: "plate", id: "entry-plate" },
          { kind: "plate", id: "far-plate" },
        ],
      }, true),
    ],
  });

  it("opens straight into its only pass, with no echo and nothing to fold", () => {
    const simulation = new Simulation(silent);
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.recordingEnabled).toBe(false);
    expect(simulation.state.actors.map((actor) => actor.id)).toEqual(["present"]);
    drive(simulation, framesFor([{ ticks: MIN_TAPE_TICKS + 10 }]));
    expect(simulation.canFold).toBe(false);
    expect(simulation.fold()).toBe(false);
  });

  it("has no clock to run out of", () => {
    const simulation = new Simulation(silent);
    const beyond = AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks + 120;
    drive(simulation, framesFor([{ ticks: beyond }]));
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.lastError).toBeNull();
  });

  it("can still be finished by walking it", () => {
    const simulation = new Simulation(silent);
    drive(simulation, framesFor(WALK_TO_PLATE));
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
    drive(simulation, framesFor([{ forward: true, ticks: 140 }]));
    expect(simulation.state.phase).toBe("success");
  });

  it("returns to its own opening phase on rerecord", () => {
    const simulation = new Simulation(silent);
    drive(simulation, framesFor([{ ticks: 10 }]));
    simulation.rerecord();
    expect(simulation.state.phase).toBe("replay");
  });
});
