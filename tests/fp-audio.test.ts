import { describe, expect, it } from "vitest";
import { FpAudioAdapter, type FpAudioVoice } from "../src/audio/fp-adapter";
import { ROOM_NOTES } from "../src/audio/score";
import { DIORAMAS } from "../src/world/ending";
import type { SimState } from "../src/sim/types";

/**
 * The audio beats are story, not decoration: which window lit which note, when
 * the sync fires, what 08 takes away. They are tested here rather than by
 * walking a browser because a corridor walk that silently fails to reach the
 * far end proves nothing at all.
 */

interface Call {
  name: string;
  args: unknown[];
}

function recorder(): { voice: FpAudioVoice; calls: Call[] } {
  const calls: Call[] = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
  const voice = {
    start: log("start"),
    setMuted: log("setMuted"),
    setPaused: log("setPaused"),
    setSilenced: log("setSilenced"),
    setRoom: log("setRoom"),
    bendRoomDown: log("bendRoomDown"),
    sinkAndReturn: log("sinkAndReturn"),
    footstep: log("footstep"),
    trigger: log("trigger"),
    attune: log("attune"),
    corridorNote: log("corridorNote"),
    resetCorridor: log("resetCorridor"),
    creak: log("creak"),
    // Both are driven by the adapter and neither is asserted here. They are in
    // the mock because `as unknown as FpAudioVoice` below silences the compiler
    // about anything missing: advanceScore is called on every frame, so leaving
    // it out failed seven tests at runtime with a TypeError rather than at the
    // type level, which is the cast's bill coming due.
    advanceScore: log("advanceScore"),
    beginEndingMusic: log("beginEndingMusic"),
    started: true,
    isMuted: false,
    masterGain: 0.42,
  } as unknown as FpAudioVoice;
  return { voice, calls };
}

function stateAt(roomId: string, overrides: Partial<SimState> = {}): SimState {
  return {
    simVersion: "test",
    roomId,
    roomVersion: 1,
    phase: "replay",
    tapeTick: 0,
    actors: [
      { id: "present", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yawUnits: 0, grounded: true, actHeld: false, buttonsPrev: 0, focusId: null },
      { id: "past", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yawUnits: 0, grounded: true, actHeld: false, buttonsPrev: 0, focusId: null },
    ],
    plates: [],
    holds: [],
    doors: [],
    exitOpen: false,
    success: false,
    lastError: null,
    foldedAtTick: null,
    ...overrides,
  } as unknown as SimState;
}

function adapterFor(initial: SimState): { adapter: FpAudioAdapter; calls: Call[]; set: (next: SimState) => void } {
  let current = initial;
  const { voice, calls } = recorder();
  const adapter = new FpAudioAdapter({ state: () => current, engine: voice });
  return { adapter, calls, set: (next) => { current = next; } };
}

const named = (calls: Call[], name: string): Call[] => calls.filter((call) => call.name === name);

describe("the corridor chord", () => {
  it("lights each window's note once, in the order they are walked past", () => {
    const { adapter, calls, set } = adapterFor(stateAt("ending-corridor"));
    adapter.onFrame();
    for (const diorama of DIORAMAS) {
      const state = stateAt("ending-corridor");
      const present = state.actors.find((actor) => actor.id === "present");
      if (present) present.z = diorama.centreZ;
      set(state);
      adapter.onFrame();
      // Standing at the same window again must not sound it twice.
      adapter.onFrame();
    }
    const lit = named(calls, "corridorNote").map((call) => call.args[0]);
    const expected = DIORAMAS.filter((diorama) => !diorama.empty).map((diorama) => diorama.chamberId);
    expect(lit).toEqual(expected);
    // The walk passed ten windows and sounded nine.
    expect(DIORAMAS).toHaveLength(10);
    expect(lit).toHaveLength(9);
  });

  it("never sounds 08, because 08's window is empty", () => {
    // Pinned on both sides of the boundary: the data says the note does not
    // join, and the walk above proves nothing asked for it. The hole in the
    // chord is a room, and a later edit must not quietly fill it.
    const { adapter, calls, set } = adapterFor(stateAt("ending-corridor"));
    adapter.onFrame();
    const past = stateAt("ending-corridor");
    const present = past.actors.find((actor) => actor.id === "present");
    // Walk past every window in one step, the far end included.
    if (present) present.z = Number.MAX_SAFE_INTEGER;
    set(past);
    adapter.onFrame();
    expect(named(calls, "corridorNote").map((call) => call.args[0])).not.toContain("silence");

    const silence = ROOM_NOTES.find((note) => note.chamberId === "silence");
    expect(silence?.joinsChord).toBe(false);
    expect(ROOM_NOTES.filter((note) => note.joinsChord)).toHaveLength(9);
  });

  it("uses a scale with no semitone in it, so any subset of the chord is consonant", () => {
    const joining = ROOM_NOTES.filter((note) => note.joinsChord).map((note) => note.corridorHz);
    for (const a of joining) {
      for (const b of joining) {
        if (a === b) continue;
        const semitones = Math.abs(12 * Math.log2(a / b)) % 12;
        const folded = Math.min(semitones, 12 - semitones);
        // Zero is an octave, which is the most consonant interval there is.
        if (folded < 0.01) continue;
        expect(folded).toBeGreaterThan(1.5);
      }
    }
  });

  it("gives the last window the lowest note, so the chord grounds on the first room", () => {
    const last = DIORAMAS[DIORAMAS.length - 1];
    const lowest = [...ROOM_NOTES].filter((note) => note.joinsChord).sort((a, b) => a.corridorHz - b.corridorHz)[0];
    expect(last?.chamberId).toBe("awakening");
    expect(lowest?.chamberId).toBe("awakening");
  });
});

describe("the rooms", () => {
  it("hands the room id to the bed on entry, so 08 can be the room that takes it away", () => {
    const { adapter, calls } = adapterFor(stateAt("silence"));
    adapter.onFrame();
    expect(named(calls, "setRoom").map((call) => call.args[0])).toEqual(["silence"]);
  });

  it("sinks and returns on an opening door, and never plays a chime", () => {
    const shut = stateAt("awakening", { doors: [{ id: "d", open: false, latched: false }] } as Partial<SimState>);
    const { adapter, calls, set } = adapterFor(shut);
    adapter.onFrame();
    set(stateAt("awakening", { doors: [{ id: "d", open: true, latched: false }] } as Partial<SimState>));
    adapter.onFrame();
    expect(named(calls, "sinkAndReturn")).toHaveLength(1);
    expect(named(calls, "bendRoomDown")).toHaveLength(0);
    expect(named(calls, "trigger").map((call) => call.args[0])).toContain("door-slide");
  });

  it("lets the finale's door settle a semitone down and stay there", () => {
    const shut = stateAt("last-hold", { doors: [{ id: "d", open: false, latched: false }] } as Partial<SimState>);
    const { adapter, calls, set } = adapterFor(shut);
    adapter.onFrame();
    set(stateAt("last-hold", { doors: [{ id: "d", open: true, latched: false }] } as Partial<SimState>));
    adapter.onFrame();
    expect(named(calls, "bendRoomDown")).toHaveLength(1);
    expect(named(calls, "sinkAndReturn")).toHaveLength(0);
  });
});

describe("the seal", () => {
  it("takes everything away for the finale's held breath and gives it back with the stamp", () => {
    const { adapter, calls } = adapterFor(stateAt("last-hold"));
    adapter.onSealing();
    expect(named(calls, "setSilenced").map((call) => call.args[0])).toEqual([true]);
    adapter.onFold();
    expect(named(calls, "setSilenced").map((call) => call.args[0])).toEqual([true, false]);
    expect(named(calls, "trigger").map((call) => call.args[0])).toEqual(["seal-finale"]);
  });

  it("stamps the ordinary seal in every other room", () => {
    const { adapter, calls } = adapterFor(stateAt("awakening"));
    adapter.onFold();
    expect(named(calls, "trigger").map((call) => call.args[0])).toEqual(["seal"]);
  });
});

describe("footsteps", () => {
  it("puts the echo on the same floor as the player, and the gallery on boards", () => {
    const { adapter, calls } = adapterFor(stateAt("two-of-us"));
    adapter.onFootstep("present", 0, 2);
    adapter.onFootstep("past", 0, 2);
    adapter.onFootstep("present", 3.4, 2);
    expect(named(calls, "footstep").map((call) => call.args)).toEqual([
      ["present", "brick"],
      ["past", "brick"],
      ["present", "timber"],
    ]);
  });
});

describe("the sync beat", () => {
  it("fires once in the gallery, when his holding is what put me up there", () => {
    const below = stateAt("two-of-us", { holds: [{ id: "h", active: true }] } as Partial<SimState>);
    const { adapter, calls, set } = adapterFor(below);
    adapter.onFrame();
    expect(named(calls, "attune")).toHaveLength(0);

    const upstairs = stateAt("two-of-us", { holds: [{ id: "h", active: true }] } as Partial<SimState>);
    const present = upstairs.actors.find((actor) => actor.id === "present");
    if (present) present.y = 3.4;
    set(upstairs);
    adapter.onFrame();
    adapter.onFrame();
    expect(named(calls, "attune")).toHaveLength(1);
  });

  it("stays quiet while recording, when there is nobody to be in time with", () => {
    const alone = stateAt("two-of-us", { phase: "recording", holds: [{ id: "h", active: true }] } as Partial<SimState>);
    const present = alone.actors.find((actor) => actor.id === "present");
    if (present) present.y = 3.4;
    const { adapter, calls } = adapterFor(alone);
    adapter.onFrame();
    expect(named(calls, "attune")).toHaveLength(0);
  });
});
