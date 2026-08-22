import { expect, test } from "@playwright/test";
import { act, advanceTo, heldForARealBeat, read, startGame, waitInPage, walkInPage } from "./support/fp";

/**
 * The judging route through the opening four rooms, played in a browser.
 *
 * These assertions were proven first in scripts/fp-journey.mjs, which walked the
 * whole campaign; the ones that gate the submission live here so they run inside
 * the suite against the built bundle. What each room has to demonstrate is the
 * rule it teaches — not that it can be finished, but that it cannot be finished
 * without the echo doing its half.
 *
 * Everything transient is waited for inside the page. A plate the player crosses
 * in half a second cannot be watched from this side of the wire.
 */

// Played in sequence in one page, because that is the thing under test: the
// campaign, not four rooms that each happen to work alone.
test.describe.configure({ mode: "serial" });

test("the opening four rooms can be played through in order", async ({ page }) => {
  // Four rooms played at human speed, including the beats each one is about —
  // 01's is standing still. This is a minutes-long test on purpose; the default
  // budget is for a page that loads, not a campaign that is played.
  test.setTimeout(300_000);
  await startGame(page);

  // ---- 00 Awakening: stand on the plate, fold, walk out behind yourself.
  expect((await read(page)).chamber).toBe("awakening");
  expect((await read(page)).subtitle).toContain("기억 보관소");
  await walkInPage(page, ["KeyW"], "s.plates[0].active === true");
  await waitInPage(page, "s.doors[0].open === true");
  expect(await act(page, "fold")).toBe(true);
  await waitInPage(page, 's.phase === "replay"');
  await walkInPage(page, ["KeyW"], 's.phase === "success"', 25000);

  // ---- 01 The Second Self: the plate ignores you, and obeys him.
  await advanceTo(page, "second-self");
  await walkInPage(page, ["KeyW"], "s.actors.find((a) => a.id === 'present').z > 5.4");
  await page.waitForTimeout(700);
  const standing = await read(page);
  expect(standing.plates[0], "the plate must ignore the living player").toBe(false);
  expect(standing.doors[0]).toBe(false);
  await act(page, "fold");
  await waitInPage(page, 's.phase === "replay"');
  await waitInPage(page, "s.doors[0].open === true", 15000);
  await walkInPage(page, ["KeyW"], 's.phase === "success"', 25000);

  // ---- 02 Holding Hand: a hand left behind holds the door.
  await advanceTo(page, "holding-hand");
  // The pillar is already inside the look raycast from the spawn, so this walks
  // nowhere on purpose. Walking "a little closer" first is what broke it: every
  // command is a round trip, and under tracing those are slow enough that the
  // player sails past the pillar and it ends up behind them.
  await waitInPage(page, "v.focus === 'grip-pillar'", 10000);
  await act(page, "press", "KeyE");
  await waitInPage(page, "s.holds[0].active === true", 10000);
  await waitInPage(page, "s.exitOpen === true", 10000); // the exit opens while the grip is held
  expect((await read(page)).seal, "a record seals in red").toBe("rgb(200, 64, 47)");
  // Fold on a real recording, not the shortest one the rules allow: at that
  // length the echo reaches the grip only as the tape ends and lets go of it.
  await heldForARealBeat(page);
  await act(page, "fold");
  await act(page, "release", "KeyE");
  await waitInPage(page, 's.phase === "replay"');
  // Waited for, not sampled. Two evaluates are two different instants, and
  // reading a state that is still arriving is how this failed intermittently
  // in chromium — the simulation settles holds and the exit inside one tick,
  // so the only thing that can disagree is when we look.
  await waitInPage(page, "s.holds[0].active === true && s.exitOpen === true", 12000);
  await walkInPage(page, ["KeyW"], 's.phase === "success"', 25000);

  // ---- 03 The Hand, Not the Body: your feet open the way for him.
  await advanceTo(page, "hand-not-body");
  await walkInPage(page, ["KeyW"], "s.actors.find((a) => a.id === 'present').z > 8.6", 20000);
  expect((await read(page)).doors[0], "nothing in the recording can open this doorway").toBe(false);
  await act(page, "fold");
  await waitInPage(page, 's.phase === "replay"');
  // Aimed straight at the plate and walked once, rather than out to a corner
  // and forward. Two legs means stopping at a coordinate mid-way, and stopping
  // takes a round trip: overshoot the corner and the plate is no longer ahead.
  await act(page, "setLook", Math.atan2(3.6, 4.9), 0);
  await walkInPage(page, ["KeyW"], "s.plates[0].active === true", 25000);
  await act(page, "setLook", 0, 0);
  await waitInPage(page, "s.doors[0].open === true", 10000); // standing on it opens it for him
  await waitInPage(page, "s.exitOpen === true", 20000);
  const through = await read(page);
  expect(through.pastZ ?? 0, "he reaches the alcove and opens the way out").toBeGreaterThan(9.6);
  // Aimed at the middle of the way out rather than straight ahead. Leaving the
  // plate puts the player about ten centimetres inside the near edge of the
  // exit's footprint, so walking forward from there either just makes it or
  // just misses depending on where the plate let go of them.
  await act(page, "setLook", Math.atan2(1.2, 6.7), 0);
  await walkInPage(page, ["KeyW"], 's.phase === "success"', 30000);
  expect((await read(page)).doors[0], "the doorway shuts behind him").toBe(false);
});
