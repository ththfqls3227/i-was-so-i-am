import "./fp/style.css";
import { FpAudioAdapter } from "./audio/fp-adapter";
import { Hud } from "./fp/hud";
import { DEFAULT_MOUSE_SENSITIVITY, FirstPersonScene } from "./fp/scene";
import { runCorpus } from "./sim/corpus";
import { ROSTER } from "./world/roster";
import type { SimState } from "./sim/types";

/**
 * Entry point for the first-person build. The old top-down game still lives in
 * src/main.ts and still compiles; nothing here imports it.
 */

const SENSITIVITY_KEY = "i-was-so-i-am:sensitivity:v1";
const EXPOSE_TEST_API = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";

declare global {
  interface Window {
    __I_WAS_SO_I_AM_FP__?: {
      readonly state: Readonly<SimState>;
      readonly checksum: string;
      readonly renderer: { ready: boolean; context: "webgl1" | "webgl2" };
      /**
       * The determinism corpus, run in whatever engine is showing this page.
       *
       * Exposed rather than imported from source by the cross-engine gate,
       * which used to fetch /src/sim/corpus.ts and therefore needed a dev
       * server to transpile it. That meant the one gate whose whole job is to
       * prove the shipped simulation agrees across engines was the one gate
       * never run against the shipped build.
       */
      runCorpus: () => string[];
      /** Read-only audio state. Audio never writes to the simulation. */
      readonly audio: { readonly started: boolean; readonly muted: boolean; readonly masterGain: number };
      setMuted: (muted: boolean) => void;
      readonly view: ReturnType<FirstPersonScene["viewModel"]>;
      start: () => void;
      look: (deltaX: number, deltaY: number) => void;
      setLook: (yaw: number, pitch: number) => void;
      switchChamber: (id: string) => boolean;
      advanceChamber: () => boolean;
      chamberId: () => string;
      press: (code: string) => void;
      release: (code: string) => void;
      fold: () => boolean;
      rerecord: () => void;
      setSensitivity: (value: number) => void;
    };
  }
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app is missing from the document");

const scene = new FirstPersonScene(app);

const stored = Number.parseFloat(localStorage.getItem(SENSITIVITY_KEY) ?? "");
scene.mouseSensitivity = Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_MOUSE_SENSITIVITY;

// Audio subscribes to the render lane and reads simulation state; it has no
// route back into either. The context is built inside the first real gesture
// below, never before, so no browser logs an autoplay warning.
const MUTE_KEY = "i-was-so-i-am:muted:v1";
const audio = new FpAudioAdapter({
  state: () => scene.state,
  muted: localStorage.getItem(MUTE_KEY) === "true",
});

// Where the campaign was left. A judge's browser died mid-room and the only
// way back in was the title and four rooms of replays — a save is written on
// every room change and spent from the title card.
const CHAMBER_KEY = "i-was-so-i-am:chamber:v1";
let lastSavedChamberId = scene.currentChamber.sim.id;
const saveChamber = (): void => {
  try {
    localStorage.setItem(CHAMBER_KEY, scene.currentChamber.sim.id);
  } catch {
    // Storage refused is a session without a bookmark, nothing worse.
  }
};

const hud = new Hud(app, {
  onStart: () => {
    audio.start();
    scene.resume();
    scene.requestPointerLock();
  },
  onContinue: () => {
    const target = ROSTER.byIdOrNull(localStorage.getItem(CHAMBER_KEY) ?? "");
    if (target) scene.switchChamber(target);
    audio.start();
    scene.resume();
    scene.requestPointerLock();
  },
  onRerecord: () => {
    hud.clearTransient();
    scene.rerecord();
    scene.requestPointerLock();
  },
  onAdvance: () => {
    hud.clearTransient();
    scene.advanceChamber();
    scene.requestPointerLock();
  },
});

{
  const saved = ROSTER.byIdOrNull(localStorage.getItem(CHAMBER_KEY) ?? "");
  // Not the first room (nothing to skip) and not the corridor (an ending is
  // not a place to be dropped back into cold).
  if (saved && saved.sim.id !== ROSTER.first.sim.id && ROSTER.after(saved.sim.id) !== null) {
    hud.offerContinue(`이어하기 — ${saved.number} ${saved.sim.name}`);
  }
}

scene.attach({
  onFrame: (view) => {
    hud.update(view, performance.now());
    audio.onFrame();
    // The bookmark follows every way a room can change — the button, the N
    // key, a continue — instead of being wired into one of them.
    const chamberId = scene.currentChamber.sim.id;
    if (chamberId !== lastSavedChamberId) {
      lastSavedChamberId = chamberId;
      saveChamber();
    }
  },
  onFootstep: (actor, y, speed) => audio.onFootstep(actor, y, speed),
  onPhaseChange: (phase) => {
    // A fresh recording clears whatever the last attempt was saying. The
    // button path already did this; the R key goes straight through the scene,
    // and a judge watched "this tape never reached the plate" caption a
    // recording that was, at that moment, reaching it.
    if (phase === "recording") hud.clearTransient();
    // Not in the corridor. There is nothing stored at the end of it and the
    // facility has already said everything it is going to say; a filing
    // confirmation on top of the closing lines turns them into a receipt.
    if (phase === "success" && !scene.currentChamber.finalBeat) {
      hud.say("보관 완료.", performance.now(), 4200);
    }
  },
  onFold: () => {
    hud.playFoldFlash();
    audio.onFold();
  },
  onSealing: (seconds) => {
    hud.beginSeal(seconds);
    audio.onSealing();
  },
  onEnding: () => hud.showEnding(scene.tapes.count),
  onLine: (line) => hud.say(line, performance.now(), 5200),
});

// One way in, so the engine, the storage and the mark on screen cannot
// disagree about whether the archive is silent.
function applyMute(muted: boolean): void {
  audio.setMuted(muted);
  hud.setMuted(muted);
  try {
    localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    // Storage refused. Silence is still silence for this run.
  }
}

applyMute(audio.engine.isMuted);
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyM" || event.repeat) return;
  applyMute(!audio.engine.isMuted);
});

scene.start();

// Clicking the canvas after Escape puts you straight back in. Pointerdown for the
// same reason the look controls use it: Babylon eats the compatibility events.
scene.canvas.addEventListener("pointerdown", () => {
  // Also the fallback gesture: if the run began without the start button, this
  // is the first trusted click the page has seen.
  audio.start();
  if (scene.hasStarted && scene.isPaused) {
    scene.resume();
    scene.requestPointerLock();
  }
});

if (EXPOSE_TEST_API) {
  window.__I_WAS_SO_I_AM_FP__ = {
    get state() {
      return scene.state;
    },
    get checksum() {
      return scene.checksum;
    },
    get renderer() {
      return { ready: scene.ready, context: scene.rendererContext };
    },
    runCorpus: () => runCorpus(ROSTER.first.sim),
    get audio() {
      return {
        started: audio.engine.started,
        muted: audio.engine.isMuted,
        masterGain: audio.engine.masterGain,
      };
    },
    setMuted: (muted: boolean) => applyMute(muted),
    get view() {
      return scene.viewModel();
    },
    start: () => scene.resume(),
    look: (deltaX, deltaY) => scene.look(deltaX, deltaY),
    setLook: (yaw, pitch) => scene.setLook(yaw, pitch),
    switchChamber: (id) => {
      const chamber = ROSTER.byIdOrNull(id);
      if (!chamber) return false;
      scene.switchChamber(chamber);
      return true;
    },
    advanceChamber: () => scene.advanceChamber(),
    chamberId: () => scene.currentChamber.sim.id,
    press: (code) => scene.press(code),
    release: (code) => scene.release(code),
    fold: () => scene.beginFold(),
    rerecord: () => scene.rerecord(),
    setSensitivity: (value) => {
      scene.mouseSensitivity = value;
      localStorage.setItem(SENSITIVITY_KEY, String(scene.mouseSensitivity));
    },
  };
}
