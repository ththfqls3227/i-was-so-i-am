// The last forty seconds, shot beat by beat.
//
// The ending is the one sequence that cannot be checked from a single pose: it
// is three lines at the last window, a key press, a seal, a fall to black, a
// silence, and a title, and every one of them can break without the others
// noticing. This walks the corridor and photographs all eight.
//
// Usage: node scripts/ending-stills.mjs <outputDirectory>
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const out = process.argv[2];
await mkdir(out, { recursive: true });
const b = await chromium.launch({ headless: true, args: ["--use-angle=metal","--enable-gpu","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await p.waitForFunction(() => globalThis.__I_WAS_SO_I_AM_FP__?.renderer?.ready === true);
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.start());
await p.waitForTimeout(400);
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.switchChamber("ending-corridor"));
await p.waitForTimeout(700);
const at = () => p.evaluate(() => { const a = globalThis.__I_WAS_SO_I_AM_FP__.state.actors.find(x=>x.id==="present"); return {x:a.x,z:a.z}; });
const sub = () => p.evaluate(() => globalThis.document.querySelector(".subtitle")?.textContent ?? "");
const shot = async (name) => { await p.screenshot({ path: `${out}/${name}.png` }); console.log(`${name}  sub="${(await sub()).slice(0,28)}"`); };

// Walk the corridor to the last window.
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.setLook(0, 0));
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyW"));
for (let i=0;i<1400;i++){ const a = await at(); if (a.z > 43.5) break; await p.waitForTimeout(16); }
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyW"));
await p.waitForTimeout(900);
// Face the last window for the lines.
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.setLook(-1.5, 0.04));
await p.waitForTimeout(700);
await shot("f1-line-one");
await p.waitForTimeout(5400);
await shot("f2-line-two");
await p.waitForTimeout(5400);
await shot("f3-line-three");
// To the door and close it.
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.setLook(0, 0));
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyW"));
for (let i=0;i<900;i++){ const v = await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.view); if (v.finalBeat) break; await p.waitForTimeout(16); }
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyW"));
// Step back off the paper: walking until the prompt appears leaves the camera
// against the leaf, and a screen of hanji is not a picture of a door.
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.press("KeyS"));
await p.waitForTimeout(620);
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.release("KeyS"));
await p.waitForTimeout(700);
await shot("f4-last-door");
await p.evaluate(() => globalThis.__I_WAS_SO_I_AM_FP__.fold());
await p.waitForTimeout(700);
await shot("f5-seal");
// Timed against showEnding's own schedule: black starts at 1150 ms and takes
// 900, the silence runs to 3550, the title comes up after that. Sampling the
// silence late catches the title fading in and makes the gap look shorter than
// it is.
await p.waitForTimeout(1100);
await shot("f6-blackout");
await p.waitForTimeout(1100);
await shot("f7-silence");
await p.waitForTimeout(2300);
await shot("f8-title");
await b.close();
