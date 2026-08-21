import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { GIVING_BACK, LONG_STANDING, TWO_OF_US, UNKEPT } from "../src/world/chambers-04-07";
import { ROSTER } from "../src/world/roster";
import type { RoomDefinition } from "../src/sim/types";
import { actorOf, doorOpen, drive, framesFor, type Hold } from "./support/fp-drive";

interface Golden {
  room: RoomDefinition;
  record: Hold[];
  replay: Hold[];
}

const holdActive = (simulation: Simulation, id: string): boolean =>
  simulation.state.holds.find((hold) => hold.id === id)?.active ?? false;
const plateActive = (simulation: Simulation, id: string): boolean =>
  simulation.state.plates.find((plate) => plate.id === id)?.active ?? false;

const GOLDENS: Record<string, Golden> = {
  "two-of-us": {
    room: TWO_OF_US,
    // Walk to the grip on the ground floor and end the recording holding it.
    record: [{ forward: true, ticks: 30 }, { act: true, ticks: 40 }],
    // Up the stairs he opened, along the gallery, take the second grip — which
    // latches the way out — then walk through it.
    replay: [
      { forward: true, right: true, ticks: 34 },
      { forward: true, ticks: 52 },
      { act: true, ticks: 20 },
      { forward: true, ticks: 80 },
    ],
  },
  "long-standing": {
    room: LONG_STANDING,
    // Stand a long time on the first plate, then walk to the second and stop.
    record: [
      { forward: true, left: true, ticks: 32 },
      { ticks: 150 },
      { right: true, ticks: 50 },
      { ticks: 12 },
    ],
    // In through the door his standing opens, and out through the one he opens
    // by moving on.
    replay: [
      { forward: true, ticks: 70 },
      { ticks: 150 },
      { forward: true, ticks: 130 },
    ],
  },
  "giving-back": {
    room: GIVING_BACK,
    // The same recording 03 taught: walk at the shut doorway and keep walking.
    record: [{ forward: true, ticks: 220 }],
    // Stand on the plate and wait. That is the room.
    // Around the partition, not into it — it only spans the middle of the hall,
    // which is the whole reason he cannot follow.
    replay: [
      { forward: true, right: true, ticks: 26 },
      { ticks: 220 },
      { forward: true, right: true, ticks: 40 },
      { forward: true, ticks: 230 },
    ],
  },
  unkept: {
    room: UNKEPT,
    // Forward and gripping at once — the tail that causes accidents elsewhere.
    record: [{ forward: true, act: true, ticks: 80 }],
    // Onto the plate and stay there — stepping off shuts the door on him.
    replay: [
      { forward: true, right: true, ticks: 36 },
      { ticks: 200 },
      { forward: true, ticks: 150 },
    ],
  },
};

function play(golden: Golden): Simulation {
  const simulation = new Simulation(golden.room);
  drive(simulation, framesFor(golden.record));
  expect(simulation.canFold).toBe(true);
  expect(simulation.fold()).toBe(true);
  drive(simulation, framesFor(golden.replay));
  return simulation;
}

describe("the golden path through 04 to 07", () => {
  for (const [id, golden] of Object.entries(GOLDENS)) {
    it(`${id} can be finished`, () => {
      const simulation = play(golden);
      expect(simulation.state.phase).toBe("success");
    });

    it(`${id} replays identically every time`, () => {
      expect(play(golden).checksum()).toBe(play(golden).checksum());
    });
  }
});

describe("each chamber needs the echo to do its half", () => {
  it("04: the way up is shut unless someone is holding below", () => {
    const simulation = new Simulation(TWO_OF_US);
    drive(simulation, framesFor([{ forward: true, right: true, ticks: 40 }]));
    expect(holdActive(simulation, "ground-grip")).toBe(false);
    expect(doorOpen(simulation.state, "upper-door")).toBe(false);
  });

  it("04: the gallery grip latches the way out, so you can let go and leave", () => {
    const simulation = play(GOLDENS["two-of-us"] as Golden);
    // Finished, and by the end the player is nowhere near the grip.
    expect(simulation.state.phase).toBe("success");
    expect(doorOpen(simulation.state, "way-out")).toBe(true);
    expect(simulation.state.doors.find((door) => door.id === "way-out")?.latched).toBe(true);
  });

  it("05: a recording that stands only briefly leaves you locked out", () => {
    const simulation = new Simulation(LONG_STANDING);
    drive(simulation, framesFor([
      { forward: true, left: true, ticks: 32 },
      { ticks: 10 },
      { right: true, ticks: 50 },
      { ticks: 12 },
    ]));
    simulation.fold();
    drive(simulation, framesFor([{ forward: true, ticks: 70 }]));
    // He has already left plate A by the time anyone could reach the doorway.
    expect(plateActive(simulation, "plate-a")).toBe(false);
    expect(doorOpen(simulation.state, "way-in")).toBe(false);
    const actor = actorOf(simulation.state, "present");
    expect(actor.z).toBeLessThan(10);
  });

  it("06: the wait on the plate is the room, and it is six seconds", () => {
    const simulation = new Simulation(GIVING_BACK);
    drive(simulation, framesFor((GOLDENS["giving-back"] as Golden).record));
    simulation.fold();
    // Get onto the plate, then count how long there is nothing to do.
    drive(simulation, framesFor([{ forward: true, right: true, ticks: 26 }]));
    expect(plateActive(simulation, "amber-plate")).toBe(true);
    let waited = 0;
    while (!simulation.state.exitOpen && waited < 400) {
      drive(simulation, framesFor([{ ticks: 1 }]));
      waited += 1;
    }
    expect(simulation.state.exitOpen).toBe(true);
    // Six seconds, give or take a stride. Long enough to be the point.
    expect(waited).toBeGreaterThan(150);
    expect(waited).toBeLessThan(220);
  });

  it("06: stepping off the plate shuts the doorway behind him", () => {
    const simulation = play(GOLDENS["giving-back"] as Golden);
    expect(actorOf(simulation.state, "past").z).toBeGreaterThan(29.6);
    expect(doorOpen(simulation.state, "slot-door")).toBe(false);
  });

  it("07: he takes the grip because the slot points him at it", () => {
    const simulation = play(GOLDENS.unkept as Golden);
    expect(holdActive(simulation, "slot-grip")).toBe(true);
    expect(actorOf(simulation.state, "past").targetId).toBe("slot-grip");
  });

  it("07: the way out closes the moment his grip would fail", () => {
    // A recording that walks the slot without gripping reaches the same place
    // and opens nothing, which is what makes the doubled tail the answer.
    const simulation = new Simulation(UNKEPT);
    drive(simulation, framesFor([{ forward: true, ticks: 80 }]));
    simulation.fold();
    drive(simulation, framesFor([
      { forward: true, right: true, ticks: 36 },
      { forward: true, ticks: 10 },
      { ticks: 200 },
    ]));
    expect(holdActive(simulation, "slot-grip")).toBe(false);
    expect(simulation.state.exitOpen).toBe(false);
  });
});

describe("the full roster", () => {
  it("runs 00 to 07 in order", () => {
    expect(ROSTER.all.map((chamber) => chamber.number)).toEqual([
      "00", "01", "02", "03", "04", "05", "06", "07",
    ]);
  });

  it("chains every chamber to the next and stops at the end", () => {
    const ids = ROSTER.all.map((chamber) => chamber.sim.id);
    for (let index = 0; index < ids.length - 1; index += 1) {
      expect(ROSTER.after(ids[index] as string)?.sim.id).toBe(ids[index + 1]);
    }
    expect(ROSTER.after(ids[ids.length - 1] as string)).toBeNull();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every chamber a spawn that is inside its own room", () => {
    for (const chamber of ROSTER.all) {
      const simulation = new Simulation(chamber.sim);
      const start = actorOf(simulation.state, "present");
      drive(simulation, framesFor([{ ticks: 4 }]));
      const settled = actorOf(simulation.state, "present");
      expect(Math.abs(settled.x - start.x)).toBeLessThan(0.05);
      expect(Math.abs(settled.z - start.z)).toBeLessThan(0.05);
      expect(settled.y).toBeCloseTo(0, 3);
    }
  });

  it("draws every solid it collides with", () => {
    // The 03 bug, made structural: any brush that is not part of the shell has
    // to appear in the dressing too, or it is a wall nobody can see.
    for (const chamber of ROSTER.all) {
      const drawn = new Set(chamber.dressing.blocks.map((block) => block.id));
      const undrawable = chamber.sim.brushes
        .filter((brush) => !/^(floor|ceiling|wall-|corridor-|tread-|deck)/.test(brush.id))
        .filter((brush) => !drawn.has(brush.id));
      expect({ chamber: chamber.sim.id, undrawable: undrawable.map((brush) => brush.id) }).toEqual({
        chamber: chamber.sim.id,
        undrawable: [],
      });
    }
  });
});
