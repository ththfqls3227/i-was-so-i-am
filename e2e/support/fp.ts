import type { Page } from "@playwright/test";

/**
 * Driving the first-person build from a spec.
 *
 * These are the helpers scripts/fp-journey.mjs grew while it was the only thing
 * playing the campaign end to end, moved here so the suite and the script drive
 * the game the same way. Every one of them exists because a simpler version was
 * wrong first — the notes say which.
 */

export interface Snapshot {
  chamber: string;
  phase: string;
  x: number;
  z: number;
  y: number;
  pastZ: number | null;
  exitOpen: boolean;
  plates: boolean[];
  holds: boolean[];
  holdById: Record<string, boolean>;
  plateById: Record<string, boolean>;
  doorById: Record<string, boolean>;
  doors: boolean[];
  subtitle: string;
  sealing: boolean;
  rerecordNotice: string;
  crosshairSealing: string;
  canFold: boolean;
  finalBeat: string | null;
  resultKind: string;
  resultBody: string;
  resultHint: string;
  seal: string;
}

/**
 * Do something to the page, forgiving a handle that is briefly absent.
 *
 * Whether the handle is missing is asked of the page rather than guessed from
 * the error text: "Cannot read properties of undefined" is also what a real bug
 * in the evaluated code says, and retrying that would bury it and then blame
 * the handle for another thing's fault.
 */
async function withHandle<T>(page: Page, what: () => Promise<T>, attempts = 25): Promise<T> {
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await what();
    } catch (error) {
      const present = await page
        .evaluate(() => window.__I_WAS_SO_I_AM_FP__ !== undefined)
        .catch(() => false);
      if (present) throw error;
      last = error;
      await page.waitForTimeout(120);
    }
  }
  throw new Error(`The page never produced a test handle: ${String(last)}`);
}

export const read = (page: Page): Promise<Snapshot> =>
  withHandle(page, () => page.evaluate(() => {
    const fp = window.__I_WAS_SO_I_AM_FP__;
    if (!fp) throw new Error("The page has no test handle");
    const state = fp.state;
    const present = state.actors.find((actor) => actor.id === "present");
    const past = state.actors.find((actor) => actor.id === "past");
    const el = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(selector);
    const stamp = el(".seal");
    return {
      chamber: fp.chamberId(),
      phase: String(state.phase),
      x: present?.x ?? 0,
      z: present?.z ?? 0,
      y: present?.y ?? 0,
      pastZ: past?.z ?? null,
      exitOpen: state.exitOpen,
      plates: state.plates.map((plate) => plate.active),
      holds: state.holds.map((hold) => hold.active),
      holdById: Object.fromEntries(state.holds.map((hold) => [hold.id, hold.active])),
      plateById: Object.fromEntries(state.plates.map((plate) => [plate.id, plate.active])),
      doorById: Object.fromEntries(state.doors.map((door) => [door.id, door.open])),
      doors: state.doors.map((door) => door.open),
      subtitle: el(".subtitle")?.textContent ?? "",
      sealing: fp.view.sealing === true,
      rerecordNotice: fp.view.rerecordNotice ?? "",
      crosshairSealing: el(".crosshair")?.dataset.sealing ?? "",
      canFold: fp.view.canFold === true,
      finalBeat: fp.view.finalBeat ?? null,
      resultKind: el(".result")?.dataset.kind ?? "",
      resultBody: el(".result p")?.textContent ?? "",
      resultHint: el(".result .hint")?.textContent ?? "",
      seal: stamp ? window.getComputedStyle(stamp).backgroundColor : "none",
    };
  }));

export const act = (page: Page, name: string, ...args: unknown[]): Promise<unknown> =>
  withHandle(page, () => page.evaluate(
    ([method, rest]) => {
      const fp = window.__I_WAS_SO_I_AM_FP__ as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined;
      const call = fp?.[method];
      if (!call) throw new Error(`The page has no test handle method ${method}`);
      return call(...rest);
    },
    [name, args] as [string, unknown[]],
  ));

/**
 * Wait for something to become true *inside the page*.
 *
 * Polling from the test side cannot be used for anything transient: each round
 * trip pulls a whole snapshot across, and while that is in flight the player
 * keeps walking. The plate in 00 is two metres across and takes half a second
 * to cross — long enough to be missed entirely between two polls, which reads
 * as "the plate never activated" when what happened is nobody was looking.
 *
 * `expression` is evaluated in the browser with `s` bound to the simulation
 * state, so it costs nothing to check and cannot miss a frame.
 */
export function waitInPage(page: Page, expression: string, ms = 20000): Promise<unknown> {
  return page.waitForFunction(
    `(() => {
      const fp = window.__I_WAS_SO_I_AM_FP__;
      if (!fp) return false;
      const s = fp.state;
      const v = fp.view;
      void s; void v;
      return (${expression});
    })()`,
    null,
    { timeout: ms, polling: 50 },
  );
}

async function setKeys(page: Page, method: "press" | "release", keys: string[]): Promise<void> {
  await withHandle(page, () => page.evaluate(
    ([action, codes]) => {
      const fp = window.__I_WAS_SO_I_AM_FP__;
      if (!fp) throw new Error("The page has no test handle");
      for (const code of codes) {
        if (action === "press") fp.press(code);
        else fp.release(code);
      }
    },
    [method, keys] as const,
  ));
}

/** Hold keys until the page says to stop. Position-steered, never duration-guessed. */
export async function walkInPage(page: Page, keys: string[], expression: string, ms = 25000): Promise<void> {
  await setKeys(page, "press", keys);
  try {
    await waitInPage(page, expression, ms);
  } finally {
    // Clear diagonal input in one browser task. Separate Playwright round trips
    // can leave one direction active for a slow render frame and carry the
    // actor straight off the small plate that ended the wait.
    await setKeys(page, "release", keys);
  }
}

/** Where the living player is right now, cheaply. */
export function presentZ(page: Page): Promise<number> {
  return page.evaluate(() => {
    const fp = window.__I_WAS_SO_I_AM_FP__;
    return fp?.state.actors.find((actor) => actor.id === "present")?.z ?? 0;
  });
}

export async function until(page: Page, predicate: (s: Snapshot) => boolean, ms = 20000): Promise<Snapshot> {
  const deadline = Date.now() + ms;
  for (;;) {
    const snapshot = await read(page);
    if (predicate(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error(`timeout; last ${JSON.stringify(snapshot)}`);
    await page.waitForTimeout(20);
  }
}

/** Hold keys until the world says to stop, rather than for a guessed duration. */
export async function walkUntil(
  page: Page,
  keys: string[],
  predicate: (s: Snapshot) => boolean,
  ms = 25000,
): Promise<Snapshot> {
  await setKeys(page, "press", keys);
  try {
    return await until(page, predicate, ms);
  } finally {
    await setKeys(page, "release", keys);
  }
}

/**
 * Keep hold of something long enough for the recording to be worth replaying.
 *
 * The shortest tape the rules allow behaves differently from any tape a player
 * makes: the echo reaches the grip only as the tape runs out and does not keep
 * hold of it, which makes 02 and 04 unwinnable. Driving the game at its limits
 * tests the limits, not the game.
 */
export const heldForARealBeat = (page: Page): Promise<void> => page.waitForTimeout(1300);

/**
 * Advance, and wait for the room to actually be the next one.
 *
 * This replaced ten fixed waits. A blind delay is wrong in both directions: dead
 * time when the switch is quick, and a half-built room handed to the next
 * assertion when it is slow.
 */
export async function advanceTo(page: Page, expected: string): Promise<void> {
  await act(page, "advanceChamber");
  await page.waitForFunction(
    (id) => window.__I_WAS_SO_I_AM_FP__?.chamberId() === id,
    expected,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => window.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true,
    null,
    { timeout: 20000 },
  );
}

/** Load the first-person build and get past the title. */
export async function startGame(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true, null, { timeout: 60000 });
  await page.locator("#start-button").click();
  await page.waitForTimeout(500);
  await act(page, "setLook", 0, 0);
}
