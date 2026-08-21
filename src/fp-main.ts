import "./fp/style.css";
import { Hud } from "./fp/hud";
import { DEFAULT_MOUSE_SENSITIVITY, FirstPersonScene } from "./fp/scene";
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

const hud = new Hud(app, {
  onStart: () => {
    scene.resume();
    scene.requestPointerLock();
  },
  onRerecord: () => {
    scene.rerecord();
    scene.requestPointerLock();
  },
  onAdvance: () => {
    scene.advanceChamber();
    scene.requestPointerLock();
  },
});

scene.attach({
  onFrame: (view) => hud.update(view, performance.now()),
  onPhaseChange: (phase) => {
    if (phase === "success") hud.say("보관 완료.", performance.now(), 4200);
  },
  onFold: () => hud.playFoldFlash(),
});

scene.start();

// Clicking the canvas after Escape puts you straight back in. Pointerdown for the
// same reason the look controls use it: Babylon eats the compatibility events.
scene.canvas.addEventListener("pointerdown", () => {
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
    fold: () => scene.fold(),
    rerecord: () => scene.rerecord(),
    setSensitivity: (value) => {
      scene.mouseSensitivity = value;
      localStorage.setItem(SENSITIVITY_KEY, String(scene.mouseSensitivity));
    },
  };
}
