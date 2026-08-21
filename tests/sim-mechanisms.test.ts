import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { MIN_TAPE_TICKS } from "../src/sim/constants";
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

  it("still ends the second pass in a room that does not ask for that", () => {
    const simulation = new Simulation(roomWith({ holds: [PILLAR], doors: [door({ kind: "hold", id: "pillar" }, false)] }));
    drive(simulation, framesFor([{ act: true, ticks: MIN_TAPE_TICKS + 4 }]));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks }]));
    expect(simulation.state.phase).toBe("rerecord");
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
