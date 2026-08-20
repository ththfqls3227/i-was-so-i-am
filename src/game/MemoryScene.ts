import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Engine } from "@babylonjs/core/Engines/engine";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene, ScenePerformancePriority } from "@babylonjs/core/scene";
import { InputBit, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { Simulation } from "../core/simulation";
import { POSITION_SCALE, TICK_MS, type ActorId, type ActorState, type ChamberId, type ForceObjectState, type PlateState, type Rect, type SimulationState, type Tape } from "../core/types";
import { CHAMBERS } from "../content/chambers";
import { CHAMBER_ROUTE } from "../content/manifests";
import { traceRequiredHoldTicks } from "../content/tutorial-timing";

const WORLD_SCALE = 0.02;
const MAX_STEPS_PER_FRAME = 4;

/** Cinematic framing: close enough that a humanoid fills ~1/5 of frame height. */
const CAMERA_RADIUS = 13.5;
const CAMERA_RADIUS_EXIT = 12.2;
const CAMERA_ALPHA = -2.05;
/** Yaw baked into every exit tunnel; the shaft has to undo it to stay side-on. */
const EXIT_YAW = -1.02;
const CAMERA_ALPHA_EXIT = -2.14;

/**
 * Resolution ladder. Rendering starts sharp and only steps down when the
 * machine cannot hold the frame budget — a software rasterizer (or an old
 * integrated GPU) lands on the last rung instead of dropping frames.
 */
const SCALING_LADDER = [1, 1.25, 1.5] as const;


/**
 * Suggested walking routes per chamber, in level units. Authored rather than
 * derived: the point of a route line is that a designer decided where the
 * player should go, including the detours a straight line would miss.
 */
const ROUTE_GUIDES: Partial<Record<ChamberId, {
  present: readonly (readonly [number, number])[];
  past: readonly (readonly [number, number])[];
}>> = {
  awakening: {
    present: [[8, 18], [24, 17.5], [38, 19], [52, 19]],
    past: [[8, 18], [24, 17.5]],
  },
  secondSelf: {
    present: [[8, 22], [20, 19], [36, 23], [52, 23]],
    past: [[8, 22], [16, 14], [19, 9]],
  },
  crossing: {
    present: [[10, 22], [32, 22], [39, 22], [70, 22]],
    past: [[10, 22], [26, 22]],
  },
  handNotBody: {
    present: [[8, 20], [12, 13], [15, 8], [9, 31]],
    past: [[8, 20], [28, 20], [51, 20]],
  },
  traceWeight: {
    present: [[10, 22], [35, 22], [52, 22], [70, 22]],
    past: [[10, 22], [24, 22], [50, 22]],
  },
  handoff: {
    present: [[10, 22], [20, 32], [36, 24], [48, 21], [62, 20], [72, 21]],
    past: [[10, 22], [16, 13], [20, 8]],
  },
  lastHold: {
    present: [[10, 22], [32, 22], [43, 22], [70, 22]],
    past: [[10, 22], [32, 30], [38, 22]],
  },
};

/** Each room signs its trim — inlays, rune slits, cradle rims — in one colour. */
const ROOM_ACCENT: Record<ChamberId, { diffuse: Color3; emissive: Color3 }> = {
  awakening: { diffuse: new Color3(0.05, 0.18, 0.24), emissive: new Color3(0.02, 0.3, 0.44) },
  secondSelf: { diffuse: new Color3(0.04, 0.19, 0.26), emissive: new Color3(0.018, 0.32, 0.47) },
  handNotBody: { diffuse: new Color3(0.2, 0.18, 0.26), emissive: new Color3(0.16, 0.14, 0.34) },
  crossing: { diffuse: new Color3(0.03, 0.2, 0.27), emissive: new Color3(0.015, 0.34, 0.5) },
  traceWeight: { diffuse: new Color3(0.3, 0.16, 0.05), emissive: new Color3(0.34, 0.15, 0.03) },
  handoff: { diffuse: new Color3(0.34, 0.25, 0.07), emissive: new Color3(0.36, 0.24, 0.05) },
  lastHold: { diffuse: new Color3(0.34, 0.33, 0.29), emissive: new Color3(0.4, 0.37, 0.3) },
};
const SLOW_FRAME_MS = 28;
const SCALING_SAMPLE_WINDOW = 60;

type VirtualControl = "up" | "down" | "left" | "right" | "action";

interface HumanoidRig {
  echo: boolean;
  root: TransformNode;
  meshes: AbstractMesh[];
  shimmer: Texture | null;
  leftShoulder: TransformNode;
  rightShoulder: TransformNode;
  leftElbow: TransformNode;
  rightElbow: TransformNode;
  leftHip: TransformNode;
  rightHip: TransformNode;
  leftKnee: TransformNode;
  rightKnee: TransformNode;
  position: Vector3;
  lastPosition: Vector3;
  gait: number;
}

interface WinchVisual {
  root: TransformNode;
  drum: Mesh;
  crank: TransformNode;
  rune: Mesh;
  runeMaterial: StandardMaterial;
}

interface BridgeVisual {
  root: TransformNode;
  openY: number;
  closedY: number;
}

interface WeightVisual {
  root: TransformNode;
  cyanSigil: Mesh;
  amberSigil: Mesh;
  cyanMaterial: StandardMaterial;
  amberMaterial: StandardMaterial;
}

interface ExitVisual {
  root: TransformNode;
  portal: Mesh;
  slab: Mesh;
  portalMaterial: StandardMaterial;
  light: PointLight;
  shaft: TransformNode;
  shaftMaterial: StandardMaterial;
  spillMaterial: StandardMaterial;
  beamMaterial: StandardMaterial;
}

interface TargetGuideVisual {
  root: TransformNode;
  ring: Mesh;
  arrow: Mesh;
}

interface PlateVisual {
  pad: Mesh;
  ring: Mesh;
  ringMaterial: StandardMaterial;
}

interface WorldVisuals {
  root: TransformNode;
  motes: ParticleSystem;
  burst: ParticleSystem;
  ripple: { mesh: Mesh; material: StandardMaterial };
  bridge: BridgeVisual | null;
  winch: WinchVisual | null;
  plate: PlateVisual | null;
  weight: WeightVisual | null;
  handoffOrb: Mesh | null;
  handoffDelivery: Mesh | null;
  exit: ExitVisual;
  guide: TargetGuideVisual;
}

export interface MemorySceneEvents {
  onSnapshot: (state: Readonly<SimulationState>, checksum: string) => void;
  onChamberChange: (chamberId: ChamberId) => void;
}

function material(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive = Color3.Black(),
  alpha = 1,
  specular = diffuse.scale(0.25),
): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = diffuse;
  value.ambientColor = Color3.White();
  value.emissiveColor = emissive;
  value.specularColor = specular;
  value.alpha = alpha;
  value.backFaceCulling = alpha === 1;
  if (alpha < 1) value.needDepthPrePass = true;
  return value;
}

function shortestAngle(current: number, target: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta;
}

export class MemoryScene {
  readonly rendererVersion = Engine.Version;

  get rendererContext(): "webgl1" | "webgl2" {
    return this.engine.webGLVersion === 2 ? "webgl2" : "webgl1";
  }

  private simulation = new Simulation(CHAMBERS.traceWeight);
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly glow: GlowLayer;
  private readonly shadows: ShadowGenerator;
  private visuals: WorldVisuals;
  private sharedStone: { ashlar: StandardMaterial; ashlarEdge: StandardMaterial; flagstone: StandardMaterial } | null = null;
  private chamberMaterials: StandardMaterial[] = [];
  private cameraRest = new Vector3(0.3, 1.15, 0.12);
  private cameraFocus = new Vector3(3.55, 1.24, 0.45);
  private actorVisuals = new Map<ActorId, HumanoidRig>();
  private eventsAdapter: MemorySceneEvents | null = null;
  private accumulator = 0;
  private previousAction = false;
  private recordingStarted = false;
  private pausedByPlayer = false;
  private lastFrameTime = performance.now();
  private lastRenderTime = 0;
  private readonly automatedRenderInterval = navigator.webdriver ? 1000 / 8 : 0;
  private scalingRung = 0;
  private recentFrameMs: number[] = [];
  private cinematicIdle = false;
  private presentMaterials: { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } | null = null;
  private echoMaterials: { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } | null = null;
  private lastPhase: SimulationState["phase"] | null = null;
  /** Trace Weight's guide turns to the weight on the same beat the card does: once the winch has been held long enough. */
  private traceGripStartTick: number | null = null;
  private traceWinchHeldLongEnough = false;
  private rippleAge = -1;
  private idleClock = 0;
  private pressedKeys = new Set<string>();
  private virtualInput = new Set<VirtualControl>();
  private readonly resizeObserver: ResizeObserver;

  constructor(parent: HTMLElement) {
    parent.style.backgroundImage = "none";
    this.canvas = document.createElement("canvas");
    this.canvas.id = "memory-canvas";
    this.canvas.setAttribute("aria-label", "I WAS, SO I AM 3D 게임 화면");
    this.canvas.tabIndex = 0;
    parent.replaceChildren(this.canvas);

    this.engine = new Engine(this.canvas, false, {
      adaptToDeviceRatio: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: true,
    });
    // Automation already halves its render rate; running it at full native
    // resolution with MSAA on top means every one of those frames is the most
    // expensive one the scene can produce, on a software rasteriser. Automated
    // runs start on a cheaper rung — review captures clear navigator.webdriver
    // and so keep full quality.
    if (this.automatedRenderInterval !== 0) this.scalingRung = 1;
    this.engine.setHardwareScalingLevel(SCALING_LADDER[this.scalingRung] ?? 1);
    this.scene = new Scene(this.engine);
    this.scene.performancePriority = ScenePerformancePriority.Aggressive;
    // Clean test chamber: the room is lit, not gloomy. Everything warm no
    // longer has to come from a doorway, so the fog and the vault ambient go.
    this.scene.clearColor = new Color4(0.055, 0.06, 0.072, 1);
    this.scene.ambientColor = new Color3(0.15, 0.155, 0.17);
    this.scene.fogMode = Scene.FOGMODE_NONE;

    this.camera = new ArcRotateCamera(
      "memory-camera",
      CAMERA_ALPHA,
      1.15,
      CAMERA_RADIUS,
      new Vector3(0.3, 1.15, 0.12),
      this.scene,
    );
    this.camera.fov = 0.78;
    this.camera.lowerRadiusLimit = 12.5;
    this.camera.upperRadiusLimit = 14.5;
    this.camera.inputs.clear();

    this.pipeline = new DefaultRenderingPipeline("memory-pipeline", true, this.scene, [this.camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.samples = this.automatedRenderInterval === 0 ? 4 : 1;
    this.pipeline.bloomEnabled = true;
    // A white room reaches any low threshold everywhere at once; bloom is for
    // the emissive signals now, not for the walls.
    this.pipeline.bloomThreshold = 0.92;
    this.pipeline.bloomWeight = 0.16;
    this.pipeline.bloomKernel = 40;
    const grade = this.pipeline.imageProcessing;
    grade.toneMappingEnabled = true;
    grade.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    grade.contrast = 1.05;
    grade.exposure = 1.05;
    grade.vignetteEnabled = true;
    grade.vignetteWeight = 0.45;
    grade.vignetteStretch = 0.4;
    grade.vignetteColor = new Color4(0.06, 0.07, 0.1, 1);
    grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    // Even neutral daylight from the ceiling, with one soft directional to keep
    // objects from floating: contact shadow, not mood.
    const sky = new HemisphericLight("memory-sky", new Vector3(0, 1, 0), this.scene);
    sky.diffuse = new Color3(0.95, 0.96, 1);
    sky.groundColor = new Color3(0.4, 0.41, 0.45);
    sky.intensity = 2.1;
    const key = new DirectionalLight("memory-key", new Vector3(-0.42, -1, -0.28), this.scene);
    key.position = new Vector3(7, 11, 4);
    key.diffuse = new Color3(1, 0.99, 0.96);
    key.specular = new Color3(0.28, 0.28, 0.3);
    key.intensity = 1.5;
    // The accent fills stay, dialled to tint rather than illuminate.
    const temporal = new PointLight("temporal-fill", new Vector3(-5.7, 2.6, 1), this.scene);
    temporal.diffuse = new Color3(0.08, 0.68, 1);
    temporal.intensity = 0.9;
    temporal.range = 7;
    const living = new PointLight("living-fill", new Vector3(3.5, 3.2, -1.5), this.scene);
    living.diffuse = new Color3(1, 0.6, 0.24);
    living.intensity = 0.8;
    living.range = 7;

    this.shadows = new ShadowGenerator(1024, key);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 12;
    this.shadows.bias = 0.0012;
    this.shadows.darkness = 0.62;
    this.glow = new GlowLayer("memory-glow", this.scene, { blurKernelSize: 24 });
    this.glow.intensity = 0.5;

    this.visuals = this.rebuildWorld();
    this.installKeyboard();
    this.updateVisuals(this.simulation.state);

    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(parent);
    this.engine.runRenderLoop(() => this.frame());
  }

  whenReady(): Promise<void> {
    return this.scene.whenReadyAsync();
  }

  actorScreenPosition(id: ActorId): { x: number; y: number } | null {
    const rig = this.actorVisuals.get(id);
    if (!rig) return null;
    const viewport = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const projected = Vector3.Project(
      rig.root.position.add(new Vector3(0, 1, 0)),
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      viewport,
    );
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + projected.x / this.engine.getRenderWidth() * bounds.width,
      y: bounds.top + projected.y / this.engine.getRenderHeight() * bounds.height,
    };
  }

  /** Frames recorded so far in this pass — the tutorial projects pass 2 from them. */
  get recordedFrames(): readonly InputFrame[] {
    return this.simulation.recordedFrames;
  }

  setEventsAdapter(adapter: MemorySceneEvents): void {
    this.eventsAdapter = adapter;
    this.publish();
  }

  switchChamber(chamberId: ChamberId): void {
    this.simulation = new Simulation(CHAMBERS[chamberId]);
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.resetRecordingBeats();
    this.disposeActorVisuals();
    this.disposeWorld();
    this.visuals = this.rebuildWorld();
    this.eventsAdapter?.onChamberChange(chamberId);
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  rerecord(): void {
    this.simulation.rerecord();
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.resetRecordingBeats();
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  /**
   * Fold time: finalize the current recording from the render layer without
   * fabricating input frames — the deterministic core owns the tape fill.
   * Returns true when the fold happened.
   */
  foldRecording(): boolean {
    if (this.pausedByPlayer) return false;
    const folded = this.simulation.foldRecording();
    if (folded) {
      this.startFoldRipple();
      this.updateVisuals(this.simulation.state);
      this.publish();
    }
    return folded;
  }

  loadTape(tape: Tape): void {
    const error = this.simulation.loadTape(tape);
    if (error) throw new Error(error);
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = true;
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  setPaused(paused: boolean): void {
    this.pausedByPlayer = paused;
    if (paused) this.resetInput();
  }

  /** The title card gets a slow camera sway; play does not. */
  setCinematicIdle(active: boolean): void {
    this.cinematicIdle = active;
  }

  setVirtualControl(control: VirtualControl, active: boolean): void {
    if (active) this.virtualInput.add(control);
    else this.virtualInput.delete(control);
  }

  resetInput(): void {
    this.pressedKeys.clear();
    this.virtualInput.clear();
    this.previousAction = false;
  }

  dispose(): void {
    for (const stone of Object.values(this.sharedStone ?? {})) stone.dispose(true, true);
    this.sharedStone = null;
    for (const body of [this.presentMaterials, this.echoMaterials]) {
      for (const bodyMaterial of new Set(Object.values(body ?? {}))) bodyMaterial.dispose(true, true);
    }
    this.presentMaterials = null;
    this.echoMaterials = null;
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  /**
   * Keyboard accessibility: while an overlay button (intro/pause/ending
   * screens, success card) has focus, Space/Enter must activate that button —
   * the game must neither preventDefault nor consume the keys.
   */
  private overlayHasFocus(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const overlay = active.closest<HTMLElement>(".screen, .success-card");
    // A dismissed overlay can briefly keep focus on its hidden button; only a
    // visible overlay may claim the keyboard.
    return overlay !== null && !overlay.hidden;
  }

  private installKeyboard(): void {
    const controlled = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyE", "KeyR",
    ]);
    window.addEventListener("keydown", (event) => {
      if (this.overlayHasFocus()) return;
      if ((event.code === "Enter" || event.code === "NumpadEnter") && !event.repeat) {
        this.foldRecording();
        return;
      }
      if (!controlled.has(event.code)) return;
      event.preventDefault();
      this.pressedKeys.add(event.code);
      // R only rerecords during live play (never on the title or while paused).
      if (event.code === "KeyR" && !event.repeat && !this.pausedByPlayer) this.rerecord();
    });
    window.addEventListener("keyup", (event) => {
      if (this.overlayHasFocus()) return;
      if (!controlled.has(event.code)) return;
      event.preventDefault();
      this.pressedKeys.delete(event.code);
    });
  }

  private frame(): void {
    const now = performance.now();
    const delta = Math.min(now - this.lastFrameTime, 100);
    this.lastFrameTime = now;
    let steps = 0;
    if (!this.pausedByPlayer) {
      this.accumulator += delta;
      while (this.accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        const frame = this.sampleInput();
        if (this.simulation.state.phase === "recording" && !this.recordingStarted && frame === NEUTRAL_INPUT) {
          this.accumulator -= TICK_MS;
          steps += 1;
          continue;
        }
        this.recordingStarted = true;
        this.simulation.step(frame);
        this.trackRecordingBeats();
        this.accumulator -= TICK_MS;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME && this.accumulator >= TICK_MS) this.accumulator = 0;
    }
    const shouldRender = this.automatedRenderInterval === 0 || now - this.lastRenderTime >= this.automatedRenderInterval;
    if (shouldRender) {
      this.idleClock += delta;
      this.updateVisuals(this.simulation.state);
      this.scene.render();
      this.trackFramePacing(delta);
      this.lastRenderTime = now;
    }
    if (steps > 0) this.publish();
  }

  private sampleInput(): InputFrame {
    const action = this.pressedKeys.has("Space") || this.pressedKeys.has("KeyE") || this.virtualInput.has("action");
    let frame = NEUTRAL_INPUT;
    if (this.pressedKeys.has("ArrowUp") || this.pressedKeys.has("KeyW") || this.virtualInput.has("up")) frame |= InputBit.Up;
    if (this.pressedKeys.has("ArrowDown") || this.pressedKeys.has("KeyS") || this.virtualInput.has("down")) frame |= InputBit.Down;
    if (this.pressedKeys.has("ArrowLeft") || this.pressedKeys.has("KeyA") || this.virtualInput.has("left")) frame |= InputBit.Left;
    if (this.pressedKeys.has("ArrowRight") || this.pressedKeys.has("KeyD") || this.virtualInput.has("right")) frame |= InputBit.Right;
    if (action) frame |= InputBit.ActionHeld;
    if (action && !this.previousAction) frame |= InputBit.ActionPressed;
    if (!action && this.previousAction) frame |= InputBit.ActionReleased;
    this.previousAction = action;
    return frame;
  }

  private publish(): void {
    this.eventsAdapter?.onSnapshot(this.simulation.state, this.simulation.checksum());
  }

  private worldPoint(x: number, y: number, height = 0): Vector3 {
    const chamber = this.simulation.chamber;
    return new Vector3(
      (x - chamber.world.width / 2) * WORLD_SCALE,
      height,
      (chamber.world.height / 2 - y) * WORLD_SCALE,
    );
  }

  private rectCenter(rect: Rect, height = 0): Vector3 {
    return this.worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2, height);
  }

  private registerMesh(mesh: Mesh, root: TransformNode, castShadow = true): Mesh {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    if (castShadow) this.shadows.addShadowCaster(mesh);
    return mesh;
  }

  private seededRandom(seed: number): () => number {
    let value = seed >>> 0;
    return (): number => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0xffffffff;
    };
  }

  /**
   * Sobel a greyscale heightmap into a tangent-space normal map. The stone is
   * procedural, so its relief has to be derived rather than authored — this is
   * what gives the block courses a lit edge instead of a painted-on line.
   */
  private normalMapFromHeight(name: string, height: Uint8ClampedArray, size: number, strength: number): DynamicTexture {
    const scratch = this.heightContext(size);
    const image = scratch.createImageData(size, size);
    const at = (x: number, y: number): number => {
      const wrappedX = (x + size) % size;
      const wrappedY = (y + size) % size;
      return height[(wrappedY * size + wrappedX) * 4] ?? 0;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
          - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
        const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
          - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
        let nx = dx / 1020 * strength;
        let ny = dy / 1020 * strength;
        const length = Math.sqrt(nx * nx + ny * ny + 1);
        nx /= length;
        ny /= length;
        const offset = (y * size + x) * 4;
        image.data[offset] = (nx * 0.5 + 0.5) * 255;
        image.data[offset + 1] = (ny * 0.5 + 0.5) * 255;
        image.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255;
        image.data[offset + 3] = 255;
      }
    }
    scratch.putImageData(image, 0, 0);
    const texture = new DynamicTexture(name, { width: size, height: size }, this.scene, false);
    texture.getContext().drawImage(scratch.canvas, 0, 0);
    texture.update(false);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  private heightContext(size: number): CanvasRenderingContext2D {
    return this.canvasContext(size, size);
  }

  private canvasContext(width: number, height: number): CanvasRenderingContext2D {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable");
    return context;
  }

  /**
   * Running-bond ashlar: four large blocks across, half-offset per course, each
   * with its own value. Luminance stays inside the 0.24-0.33 band measured as
   * readable in the C1.5b lighting pass, so the room reads as stone without the
   * fill having to compensate.
   */
  private createAshlarMaterial(name: string, seed: number, scale: number): StandardMaterial {
    const size = 1024;
    const columns = 4;
    const rows = 6;
    const blockWidth = size / columns;
    const blockHeight = size / rows;
    const joint = 7;
    const random = this.seededRandom(seed);
    const texture = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, this.scene, false);
    const context = texture.getContext();
    const height = this.heightContext(size);

    // Values are pre-rolled per course so a block split across the tile seam
    // gets the same treatment on both sides.
    const shades: number[][] = [];
    for (let row = 0; row < rows; row += 1) {
      const course: number[] = [];
      for (let column = 0; column < columns; column += 1) course.push(74 + Math.floor(random() * 24));
      shades.push(course);
    }

    context.fillStyle = "#262c31";
    context.fillRect(0, 0, size, size);
    height.fillStyle = "#3c3c3c";
    height.fillRect(0, 0, size, size);

    for (let row = 0; row < rows; row += 1) {
      const offset = (row % 2) * blockWidth / 2;
      for (let column = -1; column <= columns; column += 1) {
        const wrapped = ((column % columns) + columns) % columns;
        const shade = shades[row]?.[wrapped] ?? 70;
        const x = column * blockWidth + offset + joint / 2;
        const y = row * blockHeight + joint / 2;
        const width = blockWidth - joint;
        const depth = blockHeight - joint;
        context.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 7})`;
        context.fillRect(x, y, width, depth);

        // Fake AO: each block darkens toward its own joint.
        const inset = Math.min(width, depth) * 0.2;
        for (const [gx0, gy0, gx1, gy1, w, h] of [
          [x, y, x + inset, y, inset, depth],
          [x + width, y, x + width - inset, y, -inset, depth],
          [x, y, x, y + inset, width, inset],
          [x, y + depth, x, y + depth - inset, width, -inset],
        ] as const) {
          const shadow = context.createLinearGradient(gx0, gy0, gx1, gy1);
          shadow.addColorStop(0, "rgba(0, 0, 0, 0.22)");
          shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
          context.fillStyle = shadow;
          context.fillRect(Math.min(gx0, gx0 + w), Math.min(gy0, gy0 + h), Math.abs(w), Math.abs(h));
        }

        const relief = 150 + Math.floor((shade - 74) * 2.2);
        height.fillStyle = `rgb(${relief}, ${relief}, ${relief})`;
        height.fillRect(x, y, width, depth);

        // A few blocks are chipped along one edge.
        if (random() > 0.72) {
          const chipWidth = 18 + random() * 46;
          const chipX = x + random() * (width - chipWidth);
          context.fillStyle = "rgba(12, 15, 18, 0.5)";
          context.fillRect(chipX, y + depth - 12, chipWidth, 12);
          height.fillStyle = "rgb(88, 88, 88)";
          height.fillRect(chipX, y + depth - 12, chipWidth, 12);
        }
      }
    }

    // Damp rises from the base of every course; verdigris collects with it.
    const damp = context.createLinearGradient(0, size * 0.52, 0, size);
    damp.addColorStop(0, "rgba(10, 20, 24, 0)");
    damp.addColorStop(1, "rgba(9, 22, 26, 0.28)");
    context.fillStyle = damp;
    context.fillRect(0, size * 0.52, size, size * 0.48);
    for (let index = 0; index < 26; index += 1) {
      const x = random() * size;
      const y = size * 0.45 + random() * size * 0.55;
      const radius = 12 + random() * 46;
      const moss = context.createRadialGradient(x, y, 1, x, y, radius);
      moss.addColorStop(0, `rgba(58, 92, 74, ${0.16 + random() * 0.2})`);
      moss.addColorStop(1, "rgba(58, 92, 74, 0)");
      context.fillStyle = moss;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    for (let index = 0; index < 34; index += 1) {
      const startX = random() * size;
      const startY = random() * size;
      context.beginPath();
      height.beginPath();
      context.moveTo(startX, startY);
      height.moveTo(startX, startY);
      let cursorX = startX;
      let cursorY = startY;
      for (let segment = 1; segment <= 3; segment += 1) {
        cursorX += (random() - 0.5) * 70;
        cursorY += (random() - 0.5) * 52;
        context.lineTo(cursorX, cursorY);
        height.lineTo(cursorX, cursorY);
      }
      context.strokeStyle = `rgba(6, 9, 11, ${0.3 + random() * 0.34})`;
      context.lineWidth = 1 + random() * 2.4;
      context.stroke();
      height.strokeStyle = "rgba(70, 70, 70, 0.8)";
      height.lineWidth = 2 + random() * 2;
      height.stroke();
    }

    for (let index = 0; index < 2400; index += 1) {
      const grain = random() > 0.5 ? 168 : 18;
      context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.015 + random() * 0.03})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }

    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
    texture.update(false);

    const stone = material(this.scene, name, new Color3(0.86, 0.88, 0.9), Color3.Black(), 1, new Color3(0.07, 0.08, 0.09));
    stone.diffuseTexture = texture;
    const relief = this.normalMapFromHeight(`${name}-normal`, height.getImageData(0, 0, size, size).data, size, 2.6);
    relief.uScale = scale;
    relief.vScale = scale;
    stone.bumpTexture = relief;
    stone.specularPower = 28;
    return stone;
  }

  /** Large worn flagstones for the chamber floor, with the same value band. */
  private createFlagstoneMaterial(name: string, seed: number, scale: number): StandardMaterial {
    const size = 1024;
    const cells = 3;
    const cell = size / cells;
    const joint = 9;
    const random = this.seededRandom(seed);
    const texture = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, this.scene, false);
    const context = texture.getContext();
    const height = this.heightContext(size);
    context.fillStyle = "#22272a";
    context.fillRect(0, 0, size, size);
    height.fillStyle = "#3a3a3a";
    height.fillRect(0, 0, size, size);

    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        const shade = 72 + Math.floor(random() * 20);
        const x = column * cell + joint / 2;
        const y = row * cell + joint / 2;
        const span = cell - joint;
        context.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 5})`;
        context.fillRect(x, y, span, span);
        const inset = span * 0.2;
        for (const [gx0, gy0, gx1, gy1, w, h] of [
          [x, y, x + inset, y, inset, span],
          [x + span, y, x + span - inset, y, -inset, span],
          [x, y, x, y + inset, span, inset],
          [x, y + span, x, y + span - inset, span, -inset],
        ] as const) {
          const shadow = context.createLinearGradient(gx0, gy0, gx1, gy1);
          shadow.addColorStop(0, "rgba(0, 0, 0, 0.2)");
          shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
          context.fillStyle = shadow;
          context.fillRect(Math.min(gx0, gx0 + w), Math.min(gy0, gy0 + h), Math.abs(w), Math.abs(h));
        }
        const relief = 150 + Math.floor((shade - 72) * 2);
        height.fillStyle = `rgb(${relief}, ${relief}, ${relief})`;
        height.fillRect(x, y, span, span);
      }
    }

    for (let index = 0; index < 24; index += 1) {
      const startX = random() * size;
      const startY = random() * size;
      context.beginPath();
      height.beginPath();
      context.moveTo(startX, startY);
      height.moveTo(startX, startY);
      let cursorX = startX;
      let cursorY = startY;
      for (let segment = 1; segment <= 3; segment += 1) {
        cursorX += (random() - 0.5) * 90;
        cursorY += (random() - 0.5) * 90;
        context.lineTo(cursorX, cursorY);
        height.lineTo(cursorX, cursorY);
      }
      context.strokeStyle = `rgba(7, 10, 12, ${0.26 + random() * 0.3})`;
      context.lineWidth = 1 + random() * 2;
      context.stroke();
      height.strokeStyle = "rgba(76, 76, 76, 0.8)";
      height.lineWidth = 2;
      height.stroke();
    }
    for (let index = 0; index < 2000; index += 1) {
      const grain = random() > 0.5 ? 160 : 18;
      context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.014 + random() * 0.028})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }

    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
    texture.update(false);
    const stone = material(this.scene, name, new Color3(0.86, 0.88, 0.9), Color3.Black(), 1, new Color3(0.1, 0.11, 0.12));
    stone.diffuseTexture = texture;
    const relief = this.normalMapFromHeight(`${name}-normal`, height.getImageData(0, 0, size, size).data, size, 2.2);
    relief.uScale = scale;
    relief.vScale = scale;
    stone.bumpTexture = relief;
    stone.specularPower = 42;
    return stone;
  }

  /**
   * Off-white wall panelling: large modules, a recessed seam between them and a
   * micro-bevel at every edge. The bevel is the whole point — on a white wall
   * with even light, the seam shadow is the only thing giving the surface scale.
   */
  private createPanelMaterial(name: string, seed: number, scale: number, options: {
    columns: number;
    rows: number;
    base: string;
    seam: string;
    bevel: number;
  }): StandardMaterial {
    const size = 1024;
    const { columns, rows, base, seam, bevel } = options;
    const panelWidth = size / columns;
    const panelHeight = size / rows;
    const gap = 6;
    const random = this.seededRandom(seed);
    const texture = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, this.scene, false);
    const context = texture.getContext();
    const height = this.heightContext(size);
    context.fillStyle = seam;
    context.fillRect(0, 0, size, size);
    height.fillStyle = "#3a3a3a";
    height.fillRect(0, 0, size, size);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column * panelWidth + gap / 2;
        const y = row * panelHeight + gap / 2;
        const width = panelWidth - gap;
        const depth = panelHeight - gap;
        // Panels vary by a hair only: this is a manufactured surface.
        const tint = 1 - random() * 0.045;
        context.fillStyle = base;
        context.fillRect(x, y, width, depth);
        context.fillStyle = `rgba(0, 0, 0, ${(1 - tint) * 1.4})`;
        context.fillRect(x, y, width, depth);
        height.fillStyle = "rgb(196, 196, 196)";
        height.fillRect(x, y, width, depth);
        // Chamfer: the lit top-left edge and the shadowed bottom-right one.
        const lip = Math.max(3, bevel);
        height.fillStyle = "rgb(150, 150, 150)";
        height.fillRect(x, y + depth - lip, width, lip);
        height.fillRect(x + width - lip, y, lip, depth);
        height.fillStyle = "rgb(228, 228, 228)";
        height.fillRect(x, y, width, lip);
        height.fillRect(x, y, lip, depth);
        // A fastener at two corners reads as assembly without adding noise.
        if ((row + column) % 2 === 0) {
          for (const [fx, fy] of [[x + 16, y + 16], [x + width - 16, y + depth - 16]] as const) {
            context.fillStyle = "rgba(120, 122, 126, 0.5)";
            context.beginPath();
            context.arc(fx, fy, 4.5, 0, Math.PI * 2);
            context.fill();
            height.fillStyle = "rgb(120, 120, 120)";
            height.beginPath();
            height.arc(fx, fy, 4.5, 0, Math.PI * 2);
            height.fill();
          }
        }
      }
    }

    // Faint dirt in the seams keeps it from looking like untextured plastic.
    for (let index = 0; index < 900; index += 1) {
      const grain = random() > 0.5 ? 255 : 96;
      context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.012 + random() * 0.022})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }

    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
    texture.update(false);
    const panel = material(this.scene, name, new Color3(0.93, 0.93, 0.94), Color3.Black(), 1, new Color3(0.05, 0.05, 0.06));
    panel.diffuseTexture = texture;
    const relief = this.normalMapFromHeight(`${name}-normal`, height.getImageData(0, 0, size, size).data, size, 1.5);
    relief.uScale = scale;
    relief.vScale = scale;
    panel.bumpTexture = relief;
    panel.specularPower = 64;
    return panel;
  }

  private createBox(name: string, rect: Rect, height: number, boxMaterial: StandardMaterial, root: TransformNode, y = height / 2): Mesh {
    const mesh = MeshBuilder.CreateBox(name, {
      width: rect.width * WORLD_SCALE,
      depth: rect.height * WORLD_SCALE,
      height,
    }, this.scene);
    mesh.position = this.rectCenter(rect, y);
    mesh.material = boxMaterial;
    return this.registerMesh(mesh, root);
  }

  /**
   * Framing follows the route: the camera rests on the midpoint between spawn
   * and exit, so a room whose action sits off the world centre still lands in
   * frame at the closer cinematic radius.
   */
  private updateCameraFraming(): void {
    const chamber = this.simulation.chamber;
    const exitCenterX = chamber.exit.x + chamber.exit.width / 2;
    const exitCenterY = chamber.exit.y + chamber.exit.height / 2;
    const rest = this.worldPoint((chamber.spawn.x + exitCenterX) / 2, (chamber.spawn.y + exitCenterY) / 2, 1.15);
    const exitPoint = this.worldPoint(exitCenterX, exitCenterY, 1.24);
    this.cameraRest = rest;
    this.cameraFocus = Vector3.Lerp(rest, exitPoint, 0.72);
    this.camera.target = rest.clone();
  }

  /**
   * The masonry is generated once and shared by every chamber. Regenerating it
   * per room cost 50-95ms of main-thread canvas work at the switch, and the
   * fixed-step loop answers a stall that long by discarding simulation time.
   */
  private stoneMaterials(): { ashlar: StandardMaterial; ashlarEdge: StandardMaterial; flagstone: StandardMaterial } {
    if (!this.sharedStone) {
      this.sharedStone = {
        ashlar: this.createPanelMaterial("panel-wall", 1861, 1.4, {
          columns: 3, rows: 3, base: "#e8e6e0", seam: "#b9b7b1", bevel: 5,
        }),
        ashlarEdge: this.createPanelMaterial("panel-trim", 6577, 1.1, {
          columns: 2, rows: 2, base: "#dedcd6", seam: "#a9a7a2", bevel: 6,
        }),
        flagstone: this.createPanelMaterial("panel-floor", 3391, 2.1, {
          columns: 2, rows: 2, base: "#dcdad4", seam: "#9d9b96", bevel: 7,
        }),
      };
    }
    return this.sharedStone;
  }

  /**
   * Rebuilds the chamber and takes ownership of whatever materials it created,
   * so the world can be torn down without taking the shared masonry with it.
   */
  private rebuildWorld(): WorldVisuals {
    // Prime the shared masonry first so the snapshot below counts it as
    // pre-existing: claimed as chamber-owned, it would be disposed by the very
    // first room switch and every later room would draw with dead textures.
    this.stoneMaterials();
    const existing = new Set(this.scene.materials);
    const visuals = this.buildWorld();
    this.chamberMaterials = this.scene.materials.filter(
      (candidate): candidate is StandardMaterial => candidate instanceof StandardMaterial && !existing.has(candidate),
    );
    return visuals;
  }

  private buildWorld(): WorldVisuals {
    const root = new TransformNode(`world-${this.simulation.chamber.id}`, this.scene);
    const chamber = this.simulation.chamber;
    this.updateCameraFraming();
    const roomWidth = chamber.world.width * WORLD_SCALE;
    const roomDepth = chamber.world.height * WORLD_SCALE;
    const { ashlar, ashlarEdge, flagstone } = this.stoneMaterials();
    const metal = material(this.scene, "aged-metal", new Color3(0.09, 0.105, 0.12), Color3.Black(), 1, new Color3(0.34, 0.36, 0.38));
    // Inlaid metal, not a light source: the trim earns its glint from the key
    // and the bloom rather than from emissive of its own.
    const bronze = material(this.scene, "memory-bronze", new Color3(0.27, 0.185, 0.082), new Color3(0.006, 0.003, 0.001), 1, new Color3(0.2, 0.14, 0.06));
    bronze.specularPower = 18;
    const voidMaterial = material(this.scene, "memory-void", new Color3(0.001, 0.003, 0.007), new Color3(0, 0.012, 0.03));
    // Dark zones mark where the room does something; they are the only places
    // the value drops in a chamber that is otherwise off-white.
    const darkZone = material(this.scene, "mechanism-zone", new Color3(0.16, 0.17, 0.2), Color3.Black(), 1, new Color3(0.1, 0.1, 0.12));
    const nicheDark = darkZone;
    const observationDark = material(this.scene, "observation-void", new Color3(0.22, 0.23, 0.27), new Color3(0.055, 0.062, 0.078), 1, new Color3(0.05, 0.05, 0.06));
    observationDark.ambientColor = new Color3(0.5, 0.52, 0.58);
    const glassMaterial = material(this.scene, "observation-glass", new Color3(0.55, 0.66, 0.74), new Color3(0.07, 0.11, 0.15), 0.3, new Color3(0.9, 0.95, 1));
    glassMaterial.specularPower = 96;
    const lightStrip = material(this.scene, "ceiling-strip", new Color3(1, 1, 1), new Color3(0.95, 0.96, 1));
    lightStrip.disableLighting = true;
    const cyan = material(this.scene, "temporal-cyan", new Color3(0.025, 0.24, 0.32), new Color3(0.02, 0.68, 0.94));
    // Half the emissive of the signal cyan and outside the glow layer: the
    // depth markers must never compete with the echo for the eye.
    const chasmRune = material(this.scene, "chasm-rune", new Color3(0.02, 0.14, 0.19), new Color3(0.01, 0.32, 0.46));
    const cyanGlass = material(this.scene, "temporal-glass", new Color3(0.015, 0.18, 0.24), new Color3(0.02, 0.38, 0.56), 0.48);
    const roomAccent = ROOM_ACCENT[chamber.id];
    const accent = material(this.scene, "room-accent", roomAccent.diffuse, roomAccent.emissive, 0.85);
    const amber = material(this.scene, "living-amber", new Color3(0.55, 0.25, 0.065), new Color3(0.2, 0.07, 0.008));
    const white = material(this.scene, "exit-white", new Color3(0.82, 0.78, 0.67), new Color3(0.9, 0.82, 0.62), 0.82);

    const lowerVault = MeshBuilder.CreateBox("lower-vault-floor", {
      width: roomWidth + 10,
      depth: roomDepth + 8,
      height: 0.4,
    }, this.scene);
    lowerVault.position = new Vector3(1.8, -2.15, 0.8);
    lowerVault.material = ashlarEdge;
    this.registerMesh(lowerVault, root, false);
    for (const [index, x] of [-7.5, -3.5, 0.5, 4.5, 8.5, 12.5].entries()) {
      const lowerPier = MeshBuilder.CreateBox(`lower-vault-pier-${index}`, { width: 0.8, depth: 1.1, height: 4.2 }, this.scene);
      lowerPier.position = new Vector3(x, -3.9, 3.9 - index % 2 * 1.2);
      lowerPier.material = ashlar;
      this.registerMesh(lowerPier, root, false);
    }

    const foundation = MeshBuilder.CreateBox("chamber-foundation", {
      width: roomWidth - 0.3,
      depth: roomDepth - 0.3,
      height: 0.24,
    }, this.scene);
    foundation.position.y = -0.16;
    foundation.material = ashlar;
    this.registerMesh(foundation, root, false);

    // One flagstone deck instead of fifteen strips: the courses now come from
    // the texture, so the floor no longer needs to be built out of planks.
    const floor = MeshBuilder.CreateBox("chamber-floor", {
      width: roomWidth - 0.42,
      depth: roomDepth - 0.42,
      height: 0.06,
    }, this.scene);
    floor.position.y = -0.01;
    floor.material = flagstone;
    this.registerMesh(floor, root, false);
    for (const z of [-1.82, 1.82]) {
      const inlay = MeshBuilder.CreateBox(`bronze-inlay-${z}`, { width: roomWidth - 1.2, depth: 0.036, height: 0.022 }, this.scene);
      inlay.position = new Vector3(0, 0.028, z);
      inlay.material = accent;
      this.registerMesh(inlay, root, false);
    }

    // Boundary walls become real vault walls on the two sides the camera reads
    // as background. The near/right pair stays low so nothing occludes play.
    for (const [index, wall] of chamber.walls.entries()) {
      // The boundary set is four full-span walls, and the side pair also starts
      // at y === 0 — so identity needs the span, not just the corner.
      const spansWidth = wall.width >= chamber.world.width - 1;
      const spansDepth = wall.height >= chamber.world.height - 1;
      const isBack = wall.y === 0 && spansWidth;
      const isFront = wall.y + wall.height === chamber.world.height && spansWidth;
      const isLeft = wall.x === 0 && spansDepth;
      const isRight = wall.x + wall.width === chamber.world.width && spansDepth;
      const boundary = isBack || isLeft || isFront || isRight;
      // Only the far wall rises. The camera sits off the near-left corner, so a
      // tall left wall stands between the lens and the room — verified in
      // captures, where it swallowed half the frame.
      let wallHeight = 0.48;
      if (isBack) wallHeight = 3.05;
      else if (boundary) wallHeight = 0.72;
      this.createBox(`wall-${index}`, wall, wallHeight, boundary ? ashlarEdge : ashlar, root, wallHeight / 2);
      if (!boundary) this.createBox(`wall-cap-${index}`, wall, 0.08, bronze, root, wallHeight + 0.04);
      if (isBack) {
        this.createBox(`wall-course-${index}`, wall, 0.14, ashlar, root, wallHeight + 0.07);
      }
    }

    const backWall = MeshBuilder.CreateBox("chamber-back-wall", { width: roomWidth + 12, depth: 0.48, height: 8 }, this.scene);
    backWall.position = new Vector3(2.2, 3.65, roomDepth / 2 - 0.18);
    backWall.material = ashlar;
    this.registerMesh(backWall, root);

    // Structural ribs between panel bays — the facility's frame showing through
    // its cladding. No capitals, no niches: this is a built room, not a vault.
    const backZ = roomDepth / 2 - 0.52;
    const bayCount = Math.max(4, Math.round(roomWidth / 3.1));
    const baySpan = (roomWidth + 3) / bayCount;
    for (let index = 0; index <= bayCount; index += 1) {
      const x = -(roomWidth + 3) / 2 + index * baySpan + 1.6;
      const rib = MeshBuilder.CreateBox(`chamber-rib-${index}`, { width: 0.3, depth: 0.34, height: 4.6 }, this.scene);
      rib.position = new Vector3(x, 2.3, backZ);
      rib.material = ashlarEdge;
      this.registerMesh(rib, root);
      const shoe = MeshBuilder.CreateBox(`chamber-rib-shoe-${index}`, { width: 0.46, depth: 0.44, height: 0.22 }, this.scene);
      shoe.position = new Vector3(x, 0.11, backZ);
      shoe.material = darkZone;
      this.registerMesh(shoe, root);
    }
    // A service band at head height ties the bays together.
    const band = MeshBuilder.CreateBox("chamber-service-band", { width: roomWidth + 6, depth: 0.16, height: 0.26 }, this.scene);
    band.position = new Vector3(0, 3.62, backZ - 0.24);
    band.material = darkZone;
    this.registerMesh(band, root);

    // Ceiling strips: the room's actual light source, and the only thing above
    // the walls the camera ever sees.
    for (const [index, z] of [-roomDepth * 0.22, roomDepth * 0.24].entries()) {
      const housing = MeshBuilder.CreateBox(`ceiling-strip-housing-${index}`, {
        width: roomWidth * 0.82,
        depth: 0.44,
        height: 0.18,
      }, this.scene);
      housing.position = new Vector3(0, 4.62, z);
      housing.material = ashlarEdge;
      this.registerMesh(housing, root, false);
      const strip = MeshBuilder.CreateBox(`ceiling-strip-${index}`, {
        width: roomWidth * 0.8,
        depth: 0.3,
        height: 0.06,
      }, this.scene);
      strip.position = new Vector3(0, 4.52, z);
      strip.material = lightStrip;
      strip.isPickable = false;
      strip.receiveShadows = false;
      strip.parent = root;
      this.glow.addIncludedOnlyMesh(strip);
    }

    // One observation window per chamber: an empty room watching this one.
    const windowX = roomWidth * 0.18;
    const observation = MeshBuilder.CreateBox("observation-void", { width: 4.4, depth: 0.5, height: 1.9 }, this.scene);
    observation.position = new Vector3(windowX, 2.35, backZ + 0.18);
    observation.material = observationDark;
    this.registerMesh(observation, root, false);
    const glass = MeshBuilder.CreateBox("observation-glass", { width: 4.4, depth: 0.06, height: 1.9 }, this.scene);
    glass.position = new Vector3(windowX, 2.35, backZ - 0.12);
    glass.material = glassMaterial;
    glass.isPickable = false;
    glass.receiveShadows = false;
    glass.parent = root;
    for (const [index, offset] of [-2.28, 2.28].entries()) {
      const mullion = MeshBuilder.CreateBox(`observation-mullion-${index}`, { width: 0.22, depth: 0.4, height: 2.2 }, this.scene);
      mullion.position = new Vector3(windowX + offset, 2.35, backZ - 0.02);
      mullion.material = ashlarEdge;
      this.registerMesh(mullion, root);
    }
    for (const [index, y] of [1.36, 3.34].entries()) {
      const transom = MeshBuilder.CreateBox(`observation-transom-${index}`, { width: 4.9, depth: 0.4, height: 0.2 }, this.scene);
      transom.position = new Vector3(windowX, y, backZ - 0.02);
      transom.material = ashlarEdge;
      this.registerMesh(transom, root);
    }

    this.createChamberSign(root, backZ, roomWidth);
    this.createRouteLines(root);

    // Dark zones sit under whatever the room asks you to operate.
    const unit = 1 / POSITION_SCALE;
    if (chamber.plate) {
      this.addMechanismZone("plate", [
        (chamber.plate.x + chamber.plate.width / 2) * unit,
        (chamber.plate.y + chamber.plate.height / 2) * unit,
      ], [chamber.plate.width * unit + 2.4, chamber.plate.height * unit + 2.4], darkZone, accent, root);
    }
    if (chamber.hold) {
      this.addMechanismZone("hold", [chamber.hold.x * unit, chamber.hold.y * unit], [7, 7], darkZone, accent, root);
    }
    if (chamber.forceObject) {
      const force = chamber.forceObject;
      const spanLeft = force.minX * unit;
      const spanRight = (force.maxX + force.width) * unit;
      this.addMechanismZone("force", [
        (spanLeft + spanRight) / 2,
        (force.y + force.height / 2) * unit,
      ], [spanRight - spanLeft + 2, force.height * unit + 2.4], darkZone, accent, root);
    }
    if (chamber.handoff) {
      this.addMechanismZone("carrier", [chamber.handoff.x * unit, chamber.handoff.y * unit], [6, 6], darkZone, accent, root);
      this.addMechanismZone("delivery", [
        (chamber.handoff.delivery.x + chamber.handoff.delivery.width / 2) * unit,
        (chamber.handoff.delivery.y + chamber.handoff.delivery.height / 2) * unit,
      ], [chamber.handoff.delivery.width * unit + 1.6, chamber.handoff.delivery.height * unit + 1.6], darkZone, accent, root);
    }

    const spawn = this.worldPoint(chamber.spawn.x, chamber.spawn.y, 0.04);
    const portalDisc = MeshBuilder.CreateCylinder("time-well", { diameter: 1.5, height: 0.08, tessellation: 48 }, this.scene);
    portalDisc.position = spawn;
    portalDisc.material = cyanGlass;
    this.registerMesh(portalDisc, root, false);
    const portalRing = MeshBuilder.CreateTorus("time-well-ring", { diameter: 1.68, thickness: 0.08, tessellation: 64 }, this.scene);
    portalRing.position = spawn.add(new Vector3(0, 0.08, 0));
    portalRing.material = cyan;
    this.registerMesh(portalRing, root, false);
    this.glow.addIncludedOnlyMesh(portalDisc);
    this.glow.addIncludedOnlyMesh(portalRing);
    this.createPortalGlyph(spawn, cyan, root);
    const spawnLight = new PointLight("spawn-light", spawn.add(new Vector3(0, 1.2, 0)), this.scene);
    spawnLight.diffuse = new Color3(0.05, 0.7, 1);
    spawnLight.intensity = 3.6;
    spawnLight.range = 5;
    spawnLight.parent = root;

    // The door mechanism wears the dressing its room means: the two crossing
    // rooms span a chasm, the handoff gate is a portcullis in a wall.
    let bridge: BridgeVisual | null = null;
    if (chamber.door) {
      if (!chamber.door.id.includes("bridge")) {
        bridge = this.createSlideDoor(chamber.door.rect, ashlarEdge, darkZone, accent, root);
      } else {
        bridge = this.createChasmBridge(chamber.door.rect, roomDepth, ashlarEdge, metal, bronze, cyan, cyanGlass, chasmRune, voidMaterial, root);
      }
    }

    const winch = chamber.hold ? this.createWinch(chamber.hold.x, chamber.hold.y, chamber.door?.rect ?? null, ashlarEdge, darkZone, accent, root) : null;
    const plate = chamber.plate ? this.createPlate(chamber.plate, ashlarEdge, darkZone, accent, root) : null;
    const weight = chamber.forceObject ? this.createWeight(chamber.forceObject, ashlarEdge, metal, bronze, cyan, amber, root) : null;

    let handoffOrb: Mesh | null = null;
    let handoffDelivery: Mesh | null = null;
    if (chamber.handoff) {
      handoffOrb = MeshBuilder.CreateSphere("memory-core", { diameter: 0.54, segments: 24 }, this.scene);
      handoffOrb.position = this.worldPoint(chamber.handoff.x, chamber.handoff.y, 0.72);
      handoffOrb.material = cyan;
      this.registerMesh(handoffOrb, root, false);
      this.glow.addIncludedOnlyMesh(handoffOrb);
      handoffDelivery = this.createBox("memory-cradle", chamber.handoff.delivery, 0.42, metal, root, 0.2);
      // A receptacle has to look like it takes something: rim, then a dark mouth.
      const cradleCenter = this.rectCenter(chamber.handoff.delivery, 0);
      const cradleWidth = chamber.handoff.delivery.width * WORLD_SCALE;
      const cradleDepth = chamber.handoff.delivery.height * WORLD_SCALE;
      for (const [index, offset] of [
        [-cradleWidth / 2, 0],
        [cradleWidth / 2, 0],
        [0, -cradleDepth / 2],
        [0, cradleDepth / 2],
      ].entries()) {
        const rim = MeshBuilder.CreateBox(`handoff-rim-${index}`, {
          width: offset[1] === 0 ? 0.16 : cradleWidth + 0.16,
          depth: offset[1] === 0 ? cradleDepth + 0.16 : 0.16,
          height: 0.34,
        }, this.scene);
        rim.position = cradleCenter.add(new Vector3(offset[0] ?? 0, 0.5, offset[1] ?? 0));
        rim.material = accent;
        this.registerMesh(rim, root);
      }
      const mouth = MeshBuilder.CreateBox("handoff-mouth", {
        width: cradleWidth - 0.1,
        depth: cradleDepth - 0.1,
        height: 0.06,
      }, this.scene);
      mouth.position = cradleCenter.add(new Vector3(0, 0.44, 0));
      mouth.material = nicheDark;
      this.registerMesh(mouth, root, false);
    }

    const exit = this.createExit(chamber.exit, ashlarEdge, bronze, white, root);
    const guide = this.createTargetGuide(root);
    const moteTexture = this.createMoteTexture();
    const motes = this.createDustMotes(exit.root, moteTexture);
    const burst = this.createEchoBurst(moteTexture);
    const ripple = this.createFoldRipple(root);
    if (!this.prefersReducedMotion()) motes.start();
    // Architecture materials never change after the chamber is built; the
    // signal materials (cyan/amber/portal/rune) keep animating their emissive.
    for (const stoneLike of [metal, bronze, voidMaterial, nicheDark]) stoneLike.freeze();
    return { root, motes, burst, ripple, bridge, winch, plate, weight, handoffOrb, handoffDelivery, exit, guide };
  }

  /**
   * A pressure plate: a slab set into the floor with a ring that lights while
   * someone stands on it. Built from the chamber's own rect, so a room gets one
   * exactly when its data has one.
   */
  /**
   * Pressure pad: a circular plate sunk into its own dark bay, with a ring that
   * lights while it is held down. Hand, Not Body's plate is deliberately the
   * size of the floor, so that one gets a bordered field with corner brackets
   * instead — a giant pad has to read as a pad, not as the room's floor.
   */
  private createPlate(
    plate: PlateState,
    panel: StandardMaterial,
    dark: StandardMaterial,
    accent: StandardMaterial,
    root: TransformNode,
  ): PlateVisual {
    const width = plate.width * WORLD_SCALE;
    const depth = plate.height * WORLD_SCALE;
    const oversized = Math.max(width, depth) > 3.4;
    const pad = this.createBox(`${plate.id}-pad`, plate, oversized ? 0.06 : 0.12, dark, root, oversized ? 0.03 : 0.06);
    const ringMaterial = material(this.scene, `${plate.id}-ring`, new Color3(0.05, 0.16, 0.22), new Color3(0.03, 0.3, 0.44));
    ringMaterial.ambientColor = Color3.Black();

    if (oversized) {
      // Bordered field: brackets at the corners and a hatched inner margin, so
      // the whole bay reads as one instrument.
      const centre = this.rectCenter(plate, 0.035);
      for (const [index, sx] of [-1, 1].entries()) {
        for (const [jndex, sz] of [-1, 1].entries()) {
          const bracketLong = MeshBuilder.CreateBox(`${plate.id}-bracket-x-${index}-${jndex}`, {
            width: width * 0.22, depth: 0.14, height: 0.05,
          }, this.scene);
          bracketLong.position = centre.add(new Vector3(sx * (width / 2 - width * 0.11), 0.01, sz * (depth / 2 - 0.07)));
          bracketLong.material = accent;
          bracketLong.isPickable = false;
          bracketLong.parent = root;
          this.glow.addIncludedOnlyMesh(bracketLong);
          const bracketShort = MeshBuilder.CreateBox(`${plate.id}-bracket-z-${index}-${jndex}`, {
            width: 0.14, depth: depth * 0.22, height: 0.05,
          }, this.scene);
          bracketShort.position = centre.add(new Vector3(sx * (width / 2 - 0.07), 0.01, sz * (depth / 2 - depth * 0.11)));
          bracketShort.material = accent;
          bracketShort.isPickable = false;
          bracketShort.parent = root;
          this.glow.addIncludedOnlyMesh(bracketShort);
        }
      }
      const hatchCount = Math.max(3, Math.round(width / 0.9));
      for (let index = 0; index < hatchCount; index += 1) {
        const hatch = MeshBuilder.CreateBox(`${plate.id}-hatch-${index}`, { width: 0.06, depth: depth * 0.86, height: 0.04 }, this.scene);
        hatch.position = centre.add(new Vector3(-width / 2 + (index + 0.5) * (width / hatchCount), 0.005, 0));
        hatch.material = panel;
        hatch.isPickable = false;
        hatch.parent = root;
      }
    }

    const ring = MeshBuilder.CreateTorus(`${plate.id}-ring`, {
      diameter: oversized ? Math.min(width, depth) * 0.42 : Math.min(width, depth) * 0.72,
      thickness: oversized ? 0.06 : 0.08,
      tessellation: 44,
    }, this.scene);
    ring.position = this.rectCenter(plate, oversized ? 0.075 : 0.145);
    ring.material = ringMaterial;
    this.registerMesh(ring, root, false);
    this.glow.addIncludedOnlyMesh(ring);
    if (!oversized) {
      const collar = MeshBuilder.CreateCylinder(`${plate.id}-collar`, {
        diameter: Math.min(width, depth) * 0.92,
        height: 0.09,
        tessellation: 40,
      }, this.scene);
      collar.position = this.rectCenter(plate, 0.045);
      collar.material = panel;
      this.registerMesh(collar, root);
    }
    return { pad, ring, ringMaterial };
  }

  /**
   * Crossing rooms: a chasm the bridge deck rises out of. The void reads by
   * contrast, so its edge trim is thin and its depth carries a low fog band
   * rather than more glowing geometry.
   */
  /**
   * Clean-chamber gate: a vertical slide door in a lit frame. It replaces both
   * the vault's portcullis and its monumental slab — a test facility opens the
   * way with machinery, and the same shape reads at every scale.
   */
  private createSlideDoor(
    rect: Rect,
    panel: StandardMaterial,
    dark: StandardMaterial,
    accent: StandardMaterial,
    root: TransformNode,
  ): BridgeVisual {
    const centre = this.rectCenter(rect, 0);
    const span = Math.max(1.6, rect.height * WORLD_SCALE);
    const frame = new TransformNode("gate-frame", this.scene);
    frame.parent = root;
    frame.position = new Vector3(centre.x, 0, centre.z);
    for (const z of [-span / 2 - 0.22, span / 2 + 0.22]) {
      const jamb = MeshBuilder.CreateBox(`gate-jamb-${z}`, { width: 0.46, depth: 0.44, height: 3.1 }, this.scene);
      jamb.position = new Vector3(0, 1.55, z);
      jamb.material = panel;
      this.registerMesh(jamb, frame);
      const light = MeshBuilder.CreateBox(`gate-jamb-light-${z}`, { width: 0.08, depth: 0.1, height: 2.3 }, this.scene);
      light.position = new Vector3(-0.25, 1.5, z);
      light.material = accent;
      light.isPickable = false;
      light.receiveShadows = false;
      light.parent = frame;
      this.glow.addIncludedOnlyMesh(light);
    }
    const head = MeshBuilder.CreateBox("gate-head", { width: 0.62, depth: span + 1.05, height: 0.62 }, this.scene);
    head.position = new Vector3(0, 3.32, 0);
    head.material = panel;
    this.registerMesh(head, frame);
    const sill = MeshBuilder.CreateBox("gate-sill", { width: 0.6, depth: span + 0.5, height: 0.06 }, this.scene);
    sill.position = new Vector3(0, 0.03, 0);
    sill.material = dark;
    this.registerMesh(sill, frame);

    const leaf = new TransformNode("gate-leaf", this.scene);
    leaf.parent = root;
    leaf.position = new Vector3(centre.x, 0, centre.z);
    const slab = MeshBuilder.CreateBox("gate-slab", { width: 0.3, depth: span + 0.1, height: 2.95 }, this.scene);
    slab.position = new Vector3(0, 1.48, 0);
    slab.material = panel;
    this.registerMesh(slab, leaf);
    // A chevron band so the door's travel is legible while it moves.
    for (const [index, y] of [1.0, 1.96].entries()) {
      const chevron = MeshBuilder.CreateBox(`gate-chevron-${index}`, { width: 0.34, depth: span * 0.72, height: 0.16 }, this.scene);
      chevron.position = new Vector3(0, y, 0);
      chevron.material = dark;
      this.registerMesh(chevron, leaf);
    }
    const lip = MeshBuilder.CreateBox("gate-lip", { width: 0.36, depth: span + 0.12, height: 0.1 }, this.scene);
    lip.position = new Vector3(0, 0.06, 0);
    lip.material = accent;
    lip.isPickable = false;
    lip.parent = leaf;
    this.glow.addIncludedOnlyMesh(lip);
    return { root: leaf, openY: 3.05, closedY: 0 };
  }

  private createChasmBridge(
    rect: Rect,
    roomDepth: number,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    cyan: StandardMaterial,
    cyanGlass: StandardMaterial,
    chasmRune: StandardMaterial,
    voidMaterial: StandardMaterial,
    root: TransformNode,
  ): BridgeVisual {
    const center = this.rectCenter(rect, 0);
    const chasm = MeshBuilder.CreateBox("memory-chasm", { width: 1.8, depth: roomDepth - 0.65, height: 0.05 }, this.scene);
    chasm.position = new Vector3(center.x, -3.45, 0);
    chasm.material = voidMaterial;
    this.registerMesh(chasm, root, false);
    for (const offset of [-0.96, 0.96]) {
      const chasmWall = MeshBuilder.CreateBox(`chasm-wall-${offset}`, { width: 0.2, depth: roomDepth - 0.65, height: 6.4 }, this.scene);
      chasmWall.position = new Vector3(center.x + offset, -3.15, 0);
      chasmWall.material = stone;
      this.registerMesh(chasmWall, root, false);
    }
    // A hairline of temporal light along the lip, not a neon strip.
    for (const offset of [-0.86, 0.86]) {
      const edge = MeshBuilder.CreateBox(`chasm-edge-${offset}`, { width: 0.032, depth: roomDepth - 0.65, height: 0.045 }, this.scene);
      edge.position = new Vector3(center.x + offset, 0.055, 0);
      edge.material = cyan;
      this.registerMesh(edge, root, false);
    }
    for (const z of [-2.9, 0, 2.9]) {
      const depthRune = MeshBuilder.CreateCylinder(`chasm-rune-${z}`, { diameter: 0.12, height: 3.8, tessellation: 10 }, this.scene);
      depthRune.position = new Vector3(center.x, -2.05, z);
      depthRune.material = chasmRune;
      this.registerMesh(depthRune, root, false);
    }
    const bridgeRoot = new TransformNode("bridge-root", this.scene);
    bridgeRoot.parent = root;
    bridgeRoot.position = new Vector3(center.x, -1.15, center.z);
    const deckDepth = Math.max(1.35, rect.height * WORLD_SCALE * 0.92);
    const deck = MeshBuilder.CreateBox("bridge-deck", { width: 1.92, depth: deckDepth, height: 0.18 }, this.scene);
    deck.material = metal;
    this.registerMesh(deck, bridgeRoot);
    for (const z of [-deckDepth / 2 + 0.08, deckDepth / 2 - 0.08]) {
      const rail = MeshBuilder.CreateBox(`bridge-rail-${z}`, { width: 1.86, depth: 0.055, height: 0.07 }, this.scene);
      rail.position = new Vector3(0, 0.72, z);
      rail.material = bronze;
      this.registerMesh(rail, bridgeRoot);
      for (const x of [-0.82, 0, 0.82]) {
        const post = MeshBuilder.CreateBox(`bridge-post-${x}-${z}`, { width: 0.055, depth: 0.055, height: 0.7 }, this.scene);
        post.position = new Vector3(x, 0.38, z);
        post.material = bronze;
        this.registerMesh(post, bridgeRoot);
      }
    }
    const chasmLight = new PointLight("chasm-light", new Vector3(center.x, -1.9, center.z), this.scene);
    chasmLight.diffuse = new Color3(0.02, 0.45, 0.8);
    chasmLight.intensity = 4.2;
    chasmLight.range = 7;
    chasmLight.parent = root;
    // Fog collects at the bottom instead of a lit slab floating in the dark.
    const fog = MeshBuilder.CreatePlane("chasm-fog", { width: 1.62, height: roomDepth - 0.9 }, this.scene);
    fog.rotation.x = Math.PI / 2;
    fog.position = new Vector3(center.x, -2.95, 0);
    fog.material = this.createShaftMaterial("chasm-fog-band", this.createChasmFogTexture());
    fog.isPickable = false;
    fog.receiveShadows = false;
    fog.parent = root;
    for (const z of [-2.7, 0, 2.7]) {
      const lowerBrace = MeshBuilder.CreateBox(`chasm-lower-brace-${z}`, { width: 1.72, depth: 0.28, height: 0.26 }, this.scene);
      lowerBrace.position = new Vector3(center.x, -2.28, z);
      lowerBrace.material = metal;
      this.registerMesh(lowerBrace, root, false);
    }
    void cyanGlass;
    return { root: bridgeRoot, openY: 0.13, closedY: -1.15 };
  }

  private createChasmFogTexture(): DynamicTexture {
    const texture = new DynamicTexture("chasm-fog-texture", { width: 128, height: 128 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 128, 128);
    const band = context.createRadialGradient(64, 64, 2, 64, 64, 78);
    band.addColorStop(0, "#123a4c");
    band.addColorStop(0.5, "#0a2130");
    band.addColorStop(1, "#000000");
    context.fillStyle = band;
    context.fillRect(0, 0, 128, 128);
    texture.update(false);
    return texture;
  }

  /**
   * Handoff runs through a gate in a wall, not over a void: bars that ride up
   * into the arch when the past opens it.
   */
  /**
   * Last Hold ends with the past holding a door — the ending copy says so, and
   * the tutorial calls it a handle. So the mechanism is dressed as a monumental
   * slab in a bronze-banded frame, held up rather than bridged across.
   */
  private createMoteTexture(): DynamicTexture {
    const texture = new DynamicTexture("mote-texture", { width: 64, height: 64 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 64, 64);
    const dot = context.createRadialGradient(32, 32, 0, 32, 32, 30);
    dot.addColorStop(0, "rgba(255, 240, 214, 1)");
    dot.addColorStop(0.35, "rgba(255, 226, 178, 0.5)");
    dot.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = dot;
    context.fillRect(0, 0, 64, 64);
    texture.update(false);
    texture.hasAlpha = true;
    return texture;
  }

  /**
   * Dust hanging in the doorway light. Motes are the cheapest way to say the
   * beam is volume rather than a surface, so they live only where it lands.
   */
  private createDustMotes(exitRoot: TransformNode, texture: DynamicTexture): ParticleSystem {
    const motes = new ParticleSystem("exit-dust", 60, this.scene);
    motes.particleTexture = texture;
    // The emitter takes a world point, and the exit root carries both a yaw and
    // an offset, so the beam's centre has to be transformed out of it.
    exitRoot.computeWorldMatrix(true);
    motes.emitter = Vector3.TransformCoordinates(new Vector3(1.6, 1.5, 0), exitRoot.getWorldMatrix());
    motes.minEmitBox = new Vector3(-1.6, -1.3, -0.8);
    motes.maxEmitBox = new Vector3(1.6, 1.3, 0.8);
    motes.color1 = new Color4(1, 0.87, 0.64, 0.7);
    motes.color2 = new Color4(1, 0.78, 0.5, 0.45);
    motes.colorDead = new Color4(0.6, 0.45, 0.25, 0);
    motes.minSize = 0.04;
    motes.maxSize = 0.115;
    motes.minLifeTime = 3.2;
    motes.maxLifeTime = 6.5;
    motes.emitRate = 22;
    motes.blendMode = ParticleSystem.BLENDMODE_ADD;
    motes.gravity = new Vector3(0, -0.012, 0);
    motes.direction1 = new Vector3(-0.05, 0.03, -0.04);
    motes.direction2 = new Vector3(0.05, 0.07, 0.04);
    motes.minEmitPower = 0.01;
    motes.maxEmitPower = 0.05;
    motes.updateSpeed = 0.008;
    return motes;
  }

  /** The echo arriving: a short cyan bloom of motes where the past reappears. */
  private createEchoBurst(texture: DynamicTexture): ParticleSystem {
    const burst = new ParticleSystem("echo-burst", 90, this.scene);
    burst.particleTexture = texture;
    burst.emitter = new Vector3(0, 0, 0);
    burst.minEmitBox = new Vector3(-0.2, 0, -0.2);
    burst.maxEmitBox = new Vector3(0.2, 1.8, 0.2);
    burst.color1 = new Color4(0.5, 0.92, 1, 0.85);
    burst.color2 = new Color4(0.1, 0.62, 0.95, 0.6);
    burst.colorDead = new Color4(0.05, 0.3, 0.5, 0);
    burst.minSize = 0.03;
    burst.maxSize = 0.11;
    burst.minLifeTime = 0.35;
    burst.maxLifeTime = 0.85;
    burst.emitRate = 0;
    burst.blendMode = ParticleSystem.BLENDMODE_ADD;
    burst.gravity = new Vector3(0, 0.35, 0);
    burst.direction1 = new Vector3(-1.1, 0.2, -1.1);
    burst.direction2 = new Vector3(1.1, 1.4, 1.1);
    burst.minEmitPower = 0.4;
    burst.maxEmitPower = 1.5;
    burst.updateSpeed = 0.012;
    return burst;
  }

  /** Time folding: one ring that expands out of the recorder and thins away. */
  private createFoldRipple(worldRoot: TransformNode): { mesh: Mesh; material: StandardMaterial } {
    const rippleMaterial = material(this.scene, "fold-ripple", Color3.Black(), new Color3(0.3, 0.85, 1), 1, Color3.Black());
    rippleMaterial.disableLighting = true;
    rippleMaterial.alphaMode = Constants.ALPHA_ADD;
    rippleMaterial.disableDepthWrite = true;
    const mesh = MeshBuilder.CreateTorus("fold-ripple", { diameter: 1, thickness: 0.055, tessellation: 40 }, this.scene);
    mesh.material = rippleMaterial;
    mesh.parent = worldRoot;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.setEnabled(false);
    this.glow.addIncludedOnlyMesh(mesh);
    return { mesh, material: rippleMaterial };
  }

  /**
   * Entry sign: chamber number, route progress and the mechanisms this room
   * uses. This is the room's primary silent guidance — the tutorial card is the
   * second line of explanation, not the first.
   */
  /**
   * Floor guidance, authored per chamber in level units: an amber solid line for
   * what the present should walk, a cyan dashed one for what the recording
   * should. Same language as the gold target ring, read before any card is.
   */
  private createRouteLines(worldRoot: TransformNode): void {
    const guide = ROUTE_GUIDES[this.simulation.chamber.id];
    if (!guide) return;
    const presentMaterial = material(this.scene, "route-present", new Color3(0.5, 0.28, 0.04), new Color3(0.85, 0.46, 0.06), 0.95);
    presentMaterial.ambientColor = Color3.Black();
    const pastMaterial = material(this.scene, "route-past", new Color3(0.04, 0.34, 0.46), new Color3(0.06, 0.62, 0.86), 0.95);
    pastMaterial.ambientColor = Color3.Black();

    const draw = (points: readonly (readonly [number, number])[], lineMaterial: StandardMaterial, dashed: boolean, name: string): void => {
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (!from || !to) continue;
        const start = this.worldPoint(from[0] * POSITION_SCALE, from[1] * POSITION_SCALE, 0.045);
        const end = this.worldPoint(to[0] * POSITION_SCALE, to[1] * POSITION_SCALE, 0.045);
        const span = Vector3.Distance(start, end);
        if (span < 0.05) continue;
        const angle = Math.atan2(end.z - start.z, end.x - start.x);
        const segments = dashed ? Math.max(1, Math.round(span / 0.44)) : 1;
        for (let piece = 0; piece < segments; piece += 1) {
          const pieceLength = dashed ? (span / segments) * 0.55 : span;
          const centre = dashed
            ? Vector3.Lerp(start, end, (piece + 0.5) / segments)
            : Vector3.Lerp(start, end, 0.5);
          const strip = MeshBuilder.CreateBox(`${name}-${index}-${piece}`, {
            width: pieceLength,
            depth: 0.13,
            height: 0.012,
          }, this.scene);
          strip.position = centre;
          strip.rotation.y = -angle;
          strip.material = lineMaterial;
          strip.isPickable = false;
          strip.receiveShadows = false;
          strip.parent = worldRoot;
          this.glow.addIncludedOnlyMesh(strip);
        }
      }
    };
    draw(guide.present, presentMaterial, false, "route-present");
    draw(guide.past, pastMaterial, true, "route-past");
  }

  /**
   * Dark zones: the floor drops to the mechanism palette wherever the room does
   * something, so an off-white chamber still tells you where to look.
   */
  private addMechanismZone(
    name: string,
    centre: readonly [number, number],
    size: readonly [number, number],
    zoneMaterial: StandardMaterial,
    accent: StandardMaterial,
    worldRoot: TransformNode,
  ): void {
    const pad = MeshBuilder.CreateBox(`${name}-zone`, {
      width: size[0] * POSITION_SCALE * WORLD_SCALE,
      depth: size[1] * POSITION_SCALE * WORLD_SCALE,
      height: 0.03,
    }, this.scene);
    pad.position = this.worldPoint(centre[0] * POSITION_SCALE, centre[1] * POSITION_SCALE, 0.015);
    pad.material = zoneMaterial;
    this.registerMesh(pad, worldRoot, false);
    for (const [index, side] of [-1, 1].entries()) {
      const edge = MeshBuilder.CreateBox(`${name}-zone-edge-${index}`, {
        width: size[0] * POSITION_SCALE * WORLD_SCALE,
        depth: 0.05,
        height: 0.034,
      }, this.scene);
      edge.position = this.worldPoint(centre[0] * POSITION_SCALE, centre[1] * POSITION_SCALE, 0.017)
        .add(new Vector3(0, 0, side * size[1] * POSITION_SCALE * WORLD_SCALE / 2));
      edge.material = accent;
      edge.isPickable = false;
      edge.receiveShadows = false;
      edge.parent = worldRoot;
    }
  }

  private createChamberSign(worldRoot: TransformNode, backZ: number, roomWidth: number): void {
    const chamber = this.simulation.chamber;
    const index = CHAMBER_ROUTE.indexOf(chamber.id);
    const position = index < 0 ? 1 : index + 1;
    const total = CHAMBER_ROUTE.length;
    const width = 1024;
    const height = 512;
    const texture = new DynamicTexture(`chamber-sign-${chamber.id}`, { width, height }, this.scene, true);
    const context = this.canvasContext(width, height);
    context.fillStyle = "#20242b";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#2b3038";
    context.fillRect(12, 12, width - 24, height - 24);

    // Number block.
    context.fillStyle = "#f2f4f7";
    context.font = "bold 300px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(String(position).padStart(2, "0"), 54, 330);

    // Progress: filled pips for cleared ground, hollow for what is left.
    const pipWidth = (width - 660) / total;
    for (let pip = 0; pip < total; pip += 1) {
      const x = 600 + pip * pipWidth;
      context.fillStyle = pip < position ? "#f0b45a" : "#4a515c";
      context.fillRect(x, 96, pipWidth - 10, 16);
    }
    context.fillStyle = "#aeb6c2";
    context.font = "500 58px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    context.fillText(`${String(position).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, 600, 76);

    // Mechanism pictograms: what this room asks of you, as tiles.
    const icons: string[] = ["record"];
    if (chamber.plate) icons.push("plate");
    if (chamber.hold) icons.push("switch");
    if (chamber.forceObject) icons.push("weight");
    if (chamber.handoff) icons.push("carrier");
    if (chamber.plate?.requiredActor === "past" || chamber.hold?.requiredActor === "past" || chamber.forceObject || chamber.handoff) {
      icons.splice(1, 0, "echo");
    }
    const tile = 118;
    const gap = 20;
    for (const [slot, icon] of icons.slice(0, 5).entries()) {
      const x = 600 + slot * (tile + gap);
      const y = 170;
      context.fillStyle = "#1b1f25";
      context.fillRect(x, y, tile, tile);
      context.strokeStyle = "#59616d";
      context.lineWidth = 3;
      context.strokeRect(x + 1.5, y + 1.5, tile - 3, tile - 3);
      this.drawMechanismGlyph(context, icon, x + tile / 2, y + tile / 2, tile * 0.34);
    }

    // A hairline rule and the facility's own label for the room.
    context.strokeStyle = "#454c56";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(54, 372);
    context.lineTo(width - 54, 372);
    context.stroke();
    context.fillStyle = "#8e96a2";
    context.font = "500 52px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    context.fillText(chamber.name.toUpperCase(), 54, 444);
    // The texture pipeline inverts Y on the way to the plane; pre-flip once here
    // so the sign reads upright from the room side.
    const mirrored = this.canvasContext(width, height);
    mirrored.translate(0, height);
    mirrored.scale(1, -1);
    mirrored.drawImage(context.canvas, 0, 0);
    texture.getContext().drawImage(mirrored.canvas, 0, 0);
    texture.update(false);

    const signMaterial = material(this.scene, `chamber-sign-${chamber.id}-material`, new Color3(0.9, 0.9, 0.92), new Color3(0.34, 0.35, 0.38));
    signMaterial.diffuseTexture = texture;
    signMaterial.emissiveTexture = texture;
    signMaterial.ambientColor = Color3.Black();
    signMaterial.backFaceCulling = false;

    const board = MeshBuilder.CreatePlane(`chamber-sign-${chamber.id}-board`, { width: 3.4, height: 1.7 }, this.scene);
    board.position = new Vector3(-roomWidth * 0.2, 2.62, backZ - 0.3);
    board.material = signMaterial;
    board.isPickable = false;
    board.receiveShadows = false;
    board.parent = worldRoot;
    const frame = MeshBuilder.CreateBox(`chamber-sign-${chamber.id}-frame`, { width: 3.62, depth: 0.16, height: 1.92 }, this.scene);
    frame.position = new Vector3(-roomWidth * 0.2, 2.62, backZ - 0.21);
    frame.material = this.stoneMaterials().ashlarEdge;
    this.registerMesh(frame, worldRoot);
  }

  private drawMechanismGlyph(context: CanvasRenderingContext2D, icon: string, cx: number, cy: number, radius: number): void {
    context.strokeStyle = "#dfe5ec";
    context.fillStyle = "#dfe5ec";
    context.lineWidth = 6;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (icon === "record") {
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#f0b45a";
      context.beginPath();
      context.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (icon === "echo") {
      context.strokeStyle = "#5fd0f5";
      for (const [offset, alpha] of [[-radius * 0.42, 1], [radius * 0.42, 0.45]] as const) {
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(cx + offset, cy - radius * 0.45, radius * 0.34, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(cx + offset, cy - radius * 0.08);
        context.lineTo(cx + offset, cy + radius * 0.62);
        context.stroke();
      }
      context.globalAlpha = 1;
      return;
    }
    if (icon === "plate") {
      context.beginPath();
      context.ellipse(cx, cy + radius * 0.25, radius, radius * 0.44, 0, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "#5fd0f5";
      context.beginPath();
      context.ellipse(cx, cy + radius * 0.25, radius * 0.52, radius * 0.22, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(cx, cy - radius * 0.9);
      context.lineTo(cx, cy - radius * 0.25);
      context.stroke();
      return;
    }
    if (icon === "switch") {
      context.beginPath();
      context.moveTo(cx - radius * 0.7, cy + radius * 0.8);
      context.lineTo(cx + radius * 0.7, cy + radius * 0.8);
      context.stroke();
      context.beginPath();
      context.moveTo(cx, cy + radius * 0.8);
      context.lineTo(cx + radius * 0.55, cy - radius * 0.75);
      context.stroke();
      context.fillStyle = "#f0b45a";
      context.beginPath();
      context.arc(cx + radius * 0.55, cy - radius * 0.85, radius * 0.26, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (icon === "weight") {
      context.strokeRect(cx - radius * 0.8, cy - radius * 0.6, radius * 1.6, radius * 1.3);
      context.beginPath();
      context.moveTo(cx - radius * 0.4, cy - radius * 0.6);
      context.lineTo(cx - radius * 0.4, cy + radius * 0.7);
      context.moveTo(cx + radius * 0.4, cy - radius * 0.6);
      context.lineTo(cx + radius * 0.4, cy + radius * 0.7);
      context.stroke();
      return;
    }
    // carrier
    context.strokeRect(cx - radius * 0.72, cy - radius * 0.72, radius * 1.44, radius * 1.44);
    context.strokeStyle = "#5fd0f5";
    context.beginPath();
    context.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
    context.stroke();
  }

  private createTargetGuide(worldRoot: TransformNode): TargetGuideVisual {
    const root = new TransformNode("tutorial-target-root", this.scene);
    root.parent = worldRoot;
    const gold = material(
      this.scene,
      "tutorial-target-gold",
      new Color3(0.78, 0.46, 0.12),
      new Color3(1, 0.52, 0.08),
      0.92,
    );
    const ring = MeshBuilder.CreateTorus("tutorial-target-ring", {
      diameter: 1.45,
      thickness: 0.075,
      tessellation: 40,
    }, this.scene);
    ring.position.y = 0.12;
    ring.material = gold;
    this.registerMesh(ring, root, false);
    const arrow = MeshBuilder.CreateCylinder("tutorial-target-arrow", {
      diameterTop: 0.42,
      diameterBottom: 0,
      height: 0.7,
      tessellation: 4,
    }, this.scene);
    arrow.position.y = 2.15;
    arrow.rotation.z = Math.PI;
    arrow.material = gold;
    this.registerMesh(arrow, root, false);
    this.glow.addIncludedOnlyMesh(ring);
    this.glow.addIncludedOnlyMesh(arrow);
    return { root, ring, arrow };
  }

  /**
   * The hold mechanism as a pillar lever: a column with a lit collar and an arm
   * that swings while it is held. Same silhouette in every room that uses it, so
   * "this is the thing you grab" is learned once.
   */
  private createWinch(
    x: number,
    y: number,
    door: Rect | null,
    panel: StandardMaterial,
    dark: StandardMaterial,
    accent: StandardMaterial,
    worldRoot: TransformNode,
  ): WinchVisual {
    const root = new TransformNode("winch-root", this.scene);
    root.position = this.worldPoint(x, y, 0);
    root.parent = worldRoot;

    const base = MeshBuilder.CreateCylinder("winch-base", { diameter: 1.34, height: 0.16, tessellation: 32 }, this.scene);
    base.position.y = 0.08;
    base.material = dark;
    this.registerMesh(base, root);
    const column = MeshBuilder.CreateCylinder("winch-column", { diameter: 0.44, height: 1.16, tessellation: 24 }, this.scene);
    column.position.y = 0.74;
    column.material = panel;
    this.registerMesh(column, root);
    const shoulder = MeshBuilder.CreateCylinder("winch-shoulder", { diameter: 0.62, height: 0.2, tessellation: 24 }, this.scene);
    shoulder.position.y = 1.36;
    shoulder.material = dark;
    this.registerMesh(shoulder, root);

    // The hub the arm turns on, and the arm itself.
    const drum = MeshBuilder.CreateCylinder("winch-drum", { diameter: 0.4, height: 0.24, tessellation: 20 }, this.scene);
    drum.position.y = 1.48;
    drum.rotation.x = Math.PI / 2;
    drum.material = panel;
    this.registerMesh(drum, root);
    const crank = new TransformNode("winch-crank", this.scene);
    crank.position = new Vector3(0, 1.48, 0);
    crank.parent = root;
    const arm = MeshBuilder.CreateBox("winch-crank-arm", { width: 0.11, depth: 0.11, height: 0.78 }, this.scene);
    arm.position.y = 0.3;
    arm.material = dark;
    this.registerMesh(arm, crank);
    const grip = MeshBuilder.CreateCylinder("winch-handle", { diameter: 0.15, height: 0.34, tessellation: 14 }, this.scene);
    grip.position = new Vector3(0, 0.66, 0);
    grip.rotation.x = Math.PI / 2;
    grip.material = accent;
    this.registerMesh(grip, crank, false);
    this.glow.addIncludedOnlyMesh(grip);

    // The collar is the state light: it brightens while the lever is held.
    const runeMaterial = material(this.scene, "winch-rune", new Color3(0.05, 0.16, 0.22), new Color3(0.02, 0.22, 0.32));
    runeMaterial.ambientColor = Color3.Black();
    const rune = MeshBuilder.CreateTorus("winch-rune", { diameter: 1.12, thickness: 0.06, tessellation: 36 }, this.scene);
    rune.position.y = 0.17;
    rune.material = runeMaterial;
    this.registerMesh(rune, root, false);
    this.glow.addIncludedOnlyMesh(rune);

    if (door) {
      // A conduit from the lever to what it drives, so the link is visible.
      const doorCentre = this.rectCenter(door, 0.06);
      const start = root.position.add(new Vector3(0, 0.06, 0));
      const conduit = MeshBuilder.CreateTube("winch-cable", { path: [start, doorCentre], radius: 0.035, tessellation: 8 }, this.scene);
      conduit.material = dark;
      this.registerMesh(conduit, worldRoot, false);
    }
    return { root, drum, crank, rune, runeMaterial };
  }

  private dressBoulderCluster(
    root: TransformNode,
    rect: ForceObjectState,
    width: number,
    depth: number,
    stone: StandardMaterial,
    cyan: StandardMaterial,
    amber: StandardMaterial,
  ): WeightVisual {
    const random = this.seededRandom(rect.minX + rect.maxX + 977);
    const lumps: [number, number, number, number][] = [
      [0, 0.86, 0, 0.98],
      [-width * 0.24, 0.52, depth * 0.22, 0.62],
      [width * 0.26, 0.58, -depth * 0.2, 0.66],
      [-width * 0.1, 1.42, -depth * 0.16, 0.5],
      [width * 0.14, 1.34, depth * 0.2, 0.44],
      [0, 0.3, 0, 0.78],
    ];
    for (const [index, [x, y, z, radius]] of lumps.entries()) {
      const lump = MeshBuilder.CreateIcoSphere(`bridge-stone-${index}`, {
        radius,
        subdivisions: 1,
        flat: true,
      }, this.scene);
      lump.position = new Vector3(x, y, z);
      lump.rotation = new Vector3(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      lump.scaling = new Vector3(1.15 + random() * 0.3, 0.82 + random() * 0.26, 1.05 + random() * 0.3);
      lump.material = stone;
      this.registerMesh(lump, root);
    }
    for (let index = 0; index < 5; index += 1) {
      const chip = MeshBuilder.CreateIcoSphere(`bridge-rubble-${index}`, {
        radius: 0.11 + random() * 0.1,
        subdivisions: 1,
        flat: true,
      }, this.scene);
      chip.position = new Vector3(
        (random() - 0.5) * (width + 1.1),
        0.08,
        (random() - 0.5) * (depth + 0.9),
      );
      chip.rotation = new Vector3(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      chip.material = stone;
      this.registerMesh(chip, root);
    }
    // The two hand marks stay: they are how the room says who may push.
    const cyanMaterial = material(this.scene, "weight-cyan-sigil", new Color3(0.015, 0.12, 0.16), new Color3(0.01, 0.14, 0.2));
    const amberMaterial = material(this.scene, "weight-amber-sigil", new Color3(0.14, 0.07, 0.015), new Color3(0.15, 0.05, 0.005));
    const cyanSigil = MeshBuilder.CreateTorus("weight-cyan-hand", { diameter: 0.46, thickness: 0.07, tessellation: 24 }, this.scene);
    cyanSigil.position = new Vector3(-width / 2 - 0.12, 0.92, 0.5);
    cyanSigil.rotation.z = Math.PI / 2;
    cyanSigil.material = cyanMaterial;
    this.registerMesh(cyanSigil, root, false);
    const amberSigil = MeshBuilder.CreateTorus("weight-amber-hand", { diameter: 0.46, thickness: 0.07, tessellation: 24 }, this.scene);
    amberSigil.position = new Vector3(-width / 2 - 0.12, 0.92, -0.5);
    amberSigil.rotation.z = Math.PI / 2;
    amberSigil.material = amberMaterial;
    this.registerMesh(amberSigil, root, false);
    this.glow.addIncludedOnlyMesh(cyanSigil);
    this.glow.addIncludedOnlyMesh(amberSigil);
    void cyan;
    void amber;
    return { root, cyanSigil, amberSigil, cyanMaterial, amberMaterial };
  }

  private createWeight(
    rect: ForceObjectState,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    cyan: StandardMaterial,
    amber: StandardMaterial,
    worldRoot: TransformNode,
  ): WeightVisual {
    const root = new TransformNode("memory-weight-root", this.scene);
    root.position = this.rectCenter(rect, 0).add(new Vector3(0.88, 0, 0));
    root.parent = worldRoot;
    const width = rect.width * WORLD_SCALE;
    const depth = rect.height * WORLD_SCALE;
    if (rect.id.includes("stone")) return this.dressBoulderCluster(root, rect, width, depth, stone, cyan, amber);
    const body = MeshBuilder.CreateBox("memory-weight", { width, depth, height: 2.05 }, this.scene);
    body.position.y = 1.08;
    body.material = stone;
    this.registerMesh(body, root);
    const cap = MeshBuilder.CreateBox("memory-weight-cap", { width: width + 0.16, depth: depth + 0.16, height: 0.18 }, this.scene);
    cap.position.y = 2.14;
    cap.material = metal;
    this.registerMesh(cap, root);
    const foot = MeshBuilder.CreateBox("memory-weight-foot", { width: width + 0.24, depth: depth + 0.24, height: 0.2 }, this.scene);
    foot.position.y = 0.16;
    foot.material = metal;
    this.registerMesh(foot, root);
    for (const x of [-width / 2 - 0.035, width / 2 + 0.035]) {
      for (const z of [-depth / 2 - 0.035, depth / 2 + 0.035]) {
        const corner = MeshBuilder.CreateBox(`weight-corner-${x}-${z}`, { width: 0.13, depth: 0.13, height: 1.92 }, this.scene);
        corner.position = new Vector3(x, 1.08, z);
        corner.material = bronze;
        this.registerMesh(corner, root);
      }
    }
    for (const y of [0.44, 1.08, 1.72]) {
      const band = MeshBuilder.CreateBox(`weight-band-${y}`, { width: width + 0.08, depth: depth + 0.08, height: 0.085 }, this.scene);
      band.position.y = y;
      band.material = bronze;
      this.registerMesh(band, root);
    }
    for (const z of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
      const runner = MeshBuilder.CreateBox(`weight-runner-${z}`, { width: width + 0.3, depth: 0.14, height: 0.13 }, this.scene);
      runner.position = new Vector3(0, 0.08, z);
      runner.material = bronze;
      this.registerMesh(runner, root);
    }
    const trackStart = rect.minX;
    const trackEnd = rect.maxX + rect.width;
    const trackLength = (trackEnd - trackStart) * WORLD_SCALE;
    const trackCenterX = this.worldPoint((trackStart + trackEnd) / 2, rect.y, 0).x;
    for (const zValue of [rect.y + 10, rect.y + rect.height - 10]) {
      const track = MeshBuilder.CreateBox(`weight-track-${zValue}`, { width: trackLength, depth: 0.1, height: 0.11 }, this.scene);
      track.position = new Vector3(trackCenterX, 0.055, this.worldPoint(rect.x, zValue, 0).z);
      track.material = metal;
      this.registerMesh(track, worldRoot);
      for (let index = 0; index < 8; index += 1) {
        const tie = MeshBuilder.CreateBox(`track-tie-${zValue}-${index}`, { width: 0.12, depth: 0.34, height: 0.06 }, this.scene);
        tie.position = new Vector3(trackCenterX - trackLength / 2 + index * trackLength / 7, 0.035, track.position.z);
        tie.material = bronze;
        this.registerMesh(tie, worldRoot, false);
      }
    }
    const facePanel = MeshBuilder.CreateBox("weight-engraved-panel", { width: width * 0.62, depth: 0.045, height: 1.04 }, this.scene);
    facePanel.position = new Vector3(0, 1.08, -depth / 2 - 0.035);
    facePanel.material = metal;
    this.registerMesh(facePanel, root);
    for (const y of [0.72, 1.08, 1.44]) {
      const groove = MeshBuilder.CreateBox(`weight-groove-${y}`, { width: width * 0.48, depth: 0.035, height: 0.035 }, this.scene);
      groove.position = new Vector3(0, y, -depth / 2 - 0.07);
      groove.material = bronze;
      this.registerMesh(groove, root, false);
    }
    for (const [index, z] of [-0.62, 0.62].entries()) {
      const handleMaterial = index === 0 ? amber : cyan;
      const grip = MeshBuilder.CreateCylinder(`weight-handle-grip-${index}`, { diameter: 0.11, height: 0.56, tessellation: 12 }, this.scene);
      grip.position = new Vector3(-width / 2 - 0.23, 1.17, z);
      grip.material = handleMaterial;
      this.registerMesh(grip, root, false);
      this.glow.addIncludedOnlyMesh(grip);
      for (const y of [0.91, 1.43]) {
        const bracket = MeshBuilder.CreateBox(`weight-handle-bracket-${index}-${y}`, { width: 0.34, depth: 0.1, height: 0.1 }, this.scene);
        bracket.position = new Vector3(-width / 2 - 0.08, y, z);
        bracket.material = bronze;
        this.registerMesh(bracket, root);
      }
    }
    const cyanMaterial = material(this.scene, "weight-cyan-sigil", new Color3(0.015, 0.12, 0.16), new Color3(0.01, 0.14, 0.2));
    const amberMaterial = material(this.scene, "weight-amber-sigil", new Color3(0.14, 0.07, 0.015), new Color3(0.15, 0.05, 0.005));
    const cyanSigil = MeshBuilder.CreateTorus("weight-cyan-hand", { diameter: 0.5, thickness: 0.075, tessellation: 24 }, this.scene);
    cyanSigil.position = new Vector3(-width / 2 - 0.025, 1.28, 0.62);
    cyanSigil.rotation.z = Math.PI / 2;
    cyanSigil.material = cyanMaterial;
    this.registerMesh(cyanSigil, root, false);
    const amberSigil = MeshBuilder.CreateTorus("weight-amber-hand", { diameter: 0.5, thickness: 0.075, tessellation: 24 }, this.scene);
    amberSigil.position = new Vector3(-width / 2 - 0.025, 1.28, -0.62);
    amberSigil.rotation.z = Math.PI / 2;
    amberSigil.material = amberMaterial;
    this.registerMesh(amberSigil, root, false);
    this.glow.addIncludedOnlyMesh(cyanSigil);
    this.glow.addIncludedOnlyMesh(amberSigil);
    return { root, cyanSigil, amberSigil, cyanMaterial, amberMaterial };
  }

  /**
   * The way out of a lit facility is a lit corridor, not a cave. The opening
   * keeps a bright face and a vertical slide door; what used to be a volumetric
   * shaft is now a soft floor spill, because a beam does not read against white.
   */
  private createExit(
    rect: Rect,
    stone: StandardMaterial,
    bronze: StandardMaterial,
    white: StandardMaterial,
    worldRoot: TransformNode,
  ): ExitVisual {
    const root = new TransformNode("exit-root", this.scene);
    root.position = this.rectCenter(rect, 0).add(new Vector3(3.6, 0, 0));
    root.rotation.y = EXIT_YAW;
    root.parent = worldRoot;
    const depth = Math.max(2.35, rect.height * WORLD_SCALE * 1.05);

    const approach = MeshBuilder.CreateBox("exit-approach", { width: 4.2, depth: 3.15, height: 0.04 }, this.scene);
    approach.position = new Vector3(-1.65, -0.02, 0);
    approach.material = stone;
    this.registerMesh(approach, root);
    const corridorFloor = MeshBuilder.CreateBox("exit-corridor-floor", { width: 4.6, depth: depth - 0.2, height: 0.05 }, this.scene);
    corridorFloor.position = new Vector3(2.2, -0.012, 0);
    corridorFloor.material = stone;
    this.registerMesh(corridorFloor, root);

    const corridorWall = material(this.scene, "exit-corridor-wall", new Color3(0.86, 0.87, 0.89), Color3.Black(), 1, new Color3(0.06, 0.06, 0.07));
    for (const z of [-1, 1]) {
      const side = MeshBuilder.CreateBox(`exit-corridor-side-${z}`, { width: 4.6, depth: 0.3, height: 3.5 }, this.scene);
      side.position = new Vector3(2.2, 1.7, z * (depth / 2 - 0.05));
      side.material = corridorWall;
      this.registerMesh(side, root);
    }
    const corridorCeiling = MeshBuilder.CreateBox("exit-corridor-ceiling", { width: 4.6, depth: depth + 0.2, height: 0.26 }, this.scene);
    corridorCeiling.position = new Vector3(2.2, 3.5, 0);
    corridorCeiling.material = corridorWall;
    this.registerMesh(corridorCeiling, root);
    // The corridor is lit from its own ceiling, which is what sells depth.
    const corridorStrip = material(this.scene, "exit-corridor-strip", new Color3(1, 1, 1), new Color3(1, 0.99, 0.94));
    corridorStrip.disableLighting = true;
    const strip = MeshBuilder.CreateBox("exit-corridor-lamp", { width: 3.6, depth: 0.26, height: 0.05 }, this.scene);
    strip.position = new Vector3(2.3, 3.34, 0);
    strip.material = corridorStrip;
    strip.isPickable = false;
    strip.parent = root;
    this.glow.addIncludedOnlyMesh(strip);

    // Doorway frame, then the bright face the player walks toward.
    for (const z of [-1, 1]) {
      const jamb = MeshBuilder.CreateBox(`exit-jamb-${z}`, { width: 0.34, depth: 0.36, height: 3.3 }, this.scene);
      jamb.position = new Vector3(0.1, 1.65, z * (depth / 2 - 0.12));
      jamb.material = stone;
      this.registerMesh(jamb, root);
    }
    const header = MeshBuilder.CreateBox("exit-header", { width: 0.34, depth: depth + 0.2, height: 0.34 }, this.scene);
    header.position = new Vector3(0.1, 3.3, 0);
    header.material = stone;
    this.registerMesh(header, root);
    const threshold = MeshBuilder.CreateBox("exit-threshold", { width: 0.3, depth: depth - 0.1, height: 0.05 }, this.scene);
    threshold.position = new Vector3(0.1, 0.025, 0);
    threshold.material = bronze;
    this.registerMesh(threshold, root);

    const portalMaterial = material(this.scene, "exit-portal-light", new Color3(0.9, 0.92, 0.95), new Color3(0.92, 0.94, 1), 0.9);
    portalMaterial.disableLighting = true;
    const portal = MeshBuilder.CreateBox("exit-portal", { width: 0.06, depth: depth * 0.62, height: 2.4 }, this.scene);
    portal.position = new Vector3(4.4, 1.28, 0);
    portal.material = portalMaterial;
    this.registerMesh(portal, root, false);
    this.glow.addIncludedOnlyMesh(portal);

    // Vertical slide door: it lifts into the header when the room lets you out.
    const slab = MeshBuilder.CreateBox("exit-slab", { width: 0.2, depth: depth - 0.3, height: 3.1 }, this.scene);
    slab.position = new Vector3(0.1, 1.7, 0);
    slab.material = stone;
    this.registerMesh(slab, root);
    for (const y of [0.7, 1.7, 2.7]) {
      const doorRib = MeshBuilder.CreateBox(`exit-slab-rib-${y}`, { width: 0.26, depth: depth - 0.44, height: 0.12 }, this.scene);
      doorRib.position = new Vector3(0.1, y, 0);
      doorRib.material = bronze;
      doorRib.parent = slab;
      doorRib.position = new Vector3(0, y - 1.7, 0);
      doorRib.isPickable = false;
      this.registerMesh(doorRib, slab);
    }

    const light = new PointLight("exit-beacon", new Vector3(3.6, 1.6, 0), this.scene);
    light.diffuse = new Color3(1, 0.99, 0.95);
    light.intensity = 1.6;
    light.range = 8;
    light.parent = root;
    const { shaft, shaftMaterial, spillMaterial, beamMaterial } = this.createLightShaft(root);
    void white;
    return { root, portal, slab, portalMaterial, light, shaft, shaftMaterial, spillMaterial, beamMaterial };
  }

  private createShaftTexture(name: string, centerY: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width: 256, height: 256 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 256, 256);
    const falloff = context.createRadialGradient(128, centerY, 4, 128, centerY, 206);
    falloff.addColorStop(0, "#f4f7fb");
    falloff.addColorStop(0.24, "#b9c2cb");
    falloff.addColorStop(0.58, "#3c4147");
    falloff.addColorStop(1, "#000000");
    context.fillStyle = falloff;
    context.fillRect(0, 0, 256, 256);
    texture.update(false);
    return texture;
  }

  private createShaftMaterial(name: string, texture: DynamicTexture): StandardMaterial {
    const shaftMaterial = material(this.scene, name, Color3.Black(), new Color3(1, 1, 1), 1, Color3.Black());
    shaftMaterial.emissiveTexture = texture;
    shaftMaterial.disableLighting = true;
    shaftMaterial.backFaceCulling = false;
    shaftMaterial.alphaMode = Constants.ALPHA_ADD;
    shaftMaterial.disableDepthWrite = true;
    return shaftMaterial;
  }

  /**
   * Vertical ramp for the beam itself: bright where it leaves the doorway,
   * spent by the time it reaches the floor. Kept separate from the blob
   * texture so the cone reads as a shaft with edges rather than as fog.
   */
  private createBeamTexture(): DynamicTexture {
    const texture = new DynamicTexture("exit-beam-ramp", { width: 32, height: 256 }, this.scene, false);
    const context = texture.getContext();
    const ramp = context.createLinearGradient(0, 0, 0, 256);
    ramp.addColorStop(0, "#cfd6dd");
    ramp.addColorStop(0.32, "#8b939c");
    ramp.addColorStop(0.7, "#33383d");
    ramp.addColorStop(1, "#0a0b0c");
    context.fillStyle = ramp;
    context.fillRect(0, 0, 32, 256);
    texture.update(false);
    return texture;
  }

  /**
   * The doorway light is geometry, not a post-process. A cone aimed straight
   * out of the tunnel would be seen end-on — the tunnel faces the camera — so
   * the beam is raked steeply downward instead: from the top of the opening to
   * the floor of the room, which the camera sees side-on as a shaft crossing
   * dark air. The opening keeps a halo and the floor keeps the spill.
   */
  private createLightShaft(exitRoot: TransformNode): {
    shaft: TransformNode;
    shaftMaterial: StandardMaterial;
    spillMaterial: StandardMaterial;
    beamMaterial: StandardMaterial;
  } {
    const shaft = new TransformNode("exit-shaft-root", this.scene);
    shaft.parent = exitRoot;
    const place = (mesh: Mesh, shaftMaterial: StandardMaterial): Mesh => {
      mesh.material = shaftMaterial;
      mesh.parent = shaft;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    const shaftMaterial = this.createShaftMaterial("exit-shaft", this.createShaftTexture("exit-shaft-halo", 128));
    const halo = place(MeshBuilder.CreatePlane("exit-shaft-halo", { width: 1.7, height: 2.3 }, this.scene), shaftMaterial);
    halo.rotation.y = -Math.PI / 2;
    halo.position = new Vector3(4.42, 1.15, 0);
    this.glow.addIncludedOnlyMesh(halo);

    // Apex at the top of the opening, base on the flagstones inside the room:
    // a ~45-degree rake, which the camera reads as a beam rather than a blob.
    const beamMaterial = this.createShaftMaterial("exit-beam", this.createBeamTexture());
    // Without this the cone is a solid shape wherever the camera catches it
    // end-on. Weighting the emissive toward grazing angles is what turns the
    // mesh into a beam: bright at the silhouette, near-invisible face-on.
    const edgeWeighting = new FresnelParameters();
    edgeWeighting.bias = 0.05;
    edgeWeighting.power = 2;
    edgeWeighting.leftColor = Color3.White();
    edgeWeighting.rightColor = Color3.Black();
    beamMaterial.emissiveFresnelParameters = edgeWeighting;
    const beam = place(MeshBuilder.CreateCylinder("exit-shaft-beam", {
      height: 4.74,
      diameterTop: 0.5,
      diameterBottom: 1.7,
      tessellation: 26,
      // Caps would show as a lit disc wherever the camera catches the open end.
      cap: Mesh.NO_CAP,
    }, this.scene), beamMaterial);
    // A fake volumetric only reads while the camera sees it side-on, and the
    // exits are yawed toward the viewer. Raking the cone along the camera's
    // screen-right axis (rather than along the tunnel) keeps the beam broadside
    // in every room instead of collapsing into a lit shell in handoff.
    const beamYaw = Math.atan2(-Math.cos(CAMERA_ALPHA), -Math.sin(CAMERA_ALPHA)) - EXIT_YAW;
    beam.rotation = new Vector3(0, beamYaw, -0.83);
    beam.position = new Vector3(2.5, 1.72, 0);

    const spillMaterial = this.createShaftMaterial("exit-spill", this.createShaftTexture("exit-spill-falloff", 40));
    const spill = place(MeshBuilder.CreatePlane("exit-shaft-spill", { width: 2.9, height: 4.5 }, this.scene), spillMaterial);
    spill.rotation.x = Math.PI / 2;
    spill.rotation.z = -Math.PI / 2;
    spill.position = new Vector3(0.75, 0.03, 0);
    return { shaft, shaftMaterial, spillMaterial, beamMaterial };
  }

  private createPortalGlyph(position: Vector3, glyphMaterial: StandardMaterial, root: TransformNode): void {
    const head = MeshBuilder.CreateCylinder("portal-glyph-head", { diameter: 0.22, height: 0.025, tessellation: 24 }, this.scene);
    head.position = position.add(new Vector3(-0.22, 0.09, -0.02));
    head.material = glyphMaterial;
    this.registerMesh(head, root, false);
    const torso = MeshBuilder.CreateBox("portal-glyph-torso", { width: 0.48, height: 0.025, depth: 0.16 }, this.scene);
    torso.position = position.add(new Vector3(0.08, 0.09, 0));
    torso.rotation.y = -0.34;
    torso.material = glyphMaterial;
    this.registerMesh(torso, root, false);
    for (const [index, z] of [-0.15, 0.15].entries()) {
      const limb = MeshBuilder.CreateBox(`portal-glyph-limb-${index}`, { width: 0.42, height: 0.022, depth: 0.08 }, this.scene);
      limb.position = position.add(new Vector3(0.36, 0.095, z));
      limb.rotation.y = z < 0 ? 0.52 : -0.5;
      limb.material = glyphMaterial;
      this.registerMesh(limb, root, false);
    }
  }

  private createLimb(name: string, length: number, radius: number, limbMaterial: StandardMaterial, parent: TransformNode, echo: boolean): Mesh {
    const limb = MeshBuilder.CreateCapsule(name, { radius, height: length, tessellation: 12, subdivisions: 2, capSubdivisions: 4 }, this.scene);
    limb.position.y = -length / 2;
    limb.material = limbMaterial;
    limb.parent = parent;
    limb.isPickable = false;
    limb.receiveShadows = !echo;
    if (!echo) this.shadows.addShadowCaster(limb);
    return limb;
  }

  /**
   * The echo is light pretending to be a body: additive so it never occludes,
   * with a vertical ramp that both drives the shimmer and fades the limbs out
   * toward hands and boots.
   */
  private createEchoMaterials(): { core: StandardMaterial; fade: StandardMaterial } {
    const id = "shared";
    const ramp = new DynamicTexture(`echo-ramp-${id}`, { width: 16, height: 256 }, this.scene, false);
    const context = ramp.getContext();
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#9fe8ff");
    gradient.addColorStop(0.22, "#43b8e8");
    gradient.addColorStop(0.55, "#1e8ec0");
    gradient.addColorStop(0.82, "#136e99");
    gradient.addColorStop(1, "#0d4f72");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 16, 256);
    for (let index = 0; index < 30; index += 1) {
      const y = Math.random() * 256;
      context.fillStyle = `rgba(190, 240, 255, ${0.06 + Math.random() * 0.12})`;
      context.fillRect(0, y, 16, 1 + Math.random() * 2);
    }
    ramp.update(false);
    ramp.wrapV = Texture.WRAP_ADDRESSMODE;

    // Additive was the right answer against a dark vault and the wrong one here:
    // adding light to an already-white room returns white, so the echo vanished.
    // It is alpha-blended now, and a Fresnel rim does the work additive used to —
    // the silhouette stays bright while the body reads as translucent volume,
    // which holds against both the panels and the dark mechanism zones.
    const build = (name: string, alpha: number, rimStrength: number): StandardMaterial => {
      const echoMaterial = material(this.scene, name, new Color3(0.03, 0.28, 0.4), new Color3(1, 1, 1), alpha, Color3.Black());
      echoMaterial.emissiveTexture = ramp;
      echoMaterial.disableLighting = true;
      // The shared material() helper turns on a depth pre-pass for anything
      // translucent, which was harmless in the vault and renders the echo as a
      // black silhouette here. The ghost owns its own depth behaviour.
      echoMaterial.needDepthPrePass = false;
      echoMaterial.backFaceCulling = true;
      // Opt out of the room's ambient: the ghost is its own light source, and a
      // flat grey added on top is what turned it into a white smudge.
      echoMaterial.ambientColor = Color3.Black();
      const rim = new FresnelParameters();
      rim.bias = 0.24;
      rim.power = 1.4;
      rim.leftColor = new Color3(rimStrength * 1.3, rimStrength * 1.3, rimStrength * 1.3);
      rim.rightColor = new Color3(rimStrength * 0.62, rimStrength * 0.62, rimStrength * 0.62);
      echoMaterial.emissiveFresnelParameters = rim;
      return echoMaterial;
    };
    return { core: build(`echo-core-${id}`, 0.88, 1), fade: build(`echo-fade-${id}`, 0.62, 0.8) };
  }

  private bodyMaterials(echo: boolean): { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } {
    if (echo) {
      if (!this.echoMaterials) {
        const built = this.createEchoMaterials();
        this.echoMaterials = { jacket: built.core, skin: built.fade, cloth: built.core, extremity: built.fade };
      }
      return this.echoMaterials;
    }
    if (!this.presentMaterials) {
      const cloth = material(this.scene, "present-cloth", new Color3(0.17, 0.18, 0.21));
      this.presentMaterials = {
        jacket: material(this.scene, "present-jacket", new Color3(0.62, 0.33, 0.09), new Color3(0.03, 0.008, 0)),
        skin: material(this.scene, "present-skin", new Color3(0.46, 0.3, 0.21)),
        cloth,
        extremity: cloth,
      };
    }
    return this.presentMaterials;
  }

  private createHumanoid(id: ActorId, echo: boolean): HumanoidRig {
    const root = new TransformNode(`human-${id}`, this.scene);
    const position = this.worldPoint(this.simulation.chamber.spawn.x, this.simulation.chamber.spawn.y, 0.12);
    root.position = position.clone();
    root.scaling.setAll(1.16);
    // Tunic, hood and boots read as one silhouette; skin is only face and hands.
    const { jacket, skin, cloth, extremity } = this.bodyMaterials(echo);
    const meshes: AbstractMesh[] = [];
    const addBodyMesh = (mesh: Mesh, bodyMaterial: StandardMaterial): Mesh => {
      mesh.material = bodyMaterial;
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.receiveShadows = !echo;
      if (!echo) this.shadows.addShadowCaster(mesh);
      meshes.push(mesh);
      return mesh;
    };

    const torso = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-torso`, { radius: 0.27, height: 0.96, tessellation: 14, subdivisions: 2, capSubdivisions: 5 }, this.scene), jacket);
    torso.position.y = 1.46;
    torso.scaling = new Vector3(0.7, 1, 1.06);
    torso.rotation.z = -0.05;
    // The tunic skirt below the belt is what gives the silhouette its taper.
    const tunic = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-tunic`, {
      diameterTop: 0.5,
      diameterBottom: 0.66,
      height: 0.46,
      tessellation: 14,
    }, this.scene), jacket);
    tunic.position.y = 1.01;
    tunic.scaling.x = 0.78;
    const pelvis = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-pelvis`, { radius: 0.2, height: 0.3, tessellation: 12, subdivisions: 1, capSubdivisions: 4 }, this.scene), cloth);
    pelvis.position.y = 0.9;
    pelvis.scaling.z = 1.1;
    const head = addBodyMesh(MeshBuilder.CreateSphere(`human-${id}-head`, { diameter: 0.29, segments: 16 }, this.scene), skin);
    head.position = new Vector3(0.02, 2.03, 0);
    const neck = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-neck`, { diameter: 0.13, height: 0.18, tessellation: 10 }, this.scene), skin);
    neck.position.y = 1.86;
    if (!echo) {
      // Hood: a cone behind the head, plus the shoulder mantle it falls from.
      const hood = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-hood`, {
        diameterTop: 0.2,
        diameterBottom: 0.46,
        height: 0.26,
        tessellation: 14,
      }, this.scene), cloth);
      hood.position = new Vector3(-0.13, 1.98, 0);
      hood.rotation.z = -0.62;
      // Small enough to stay a collar: the amber tunic has to carry the figure.
      const mantle = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-mantle`, {
        diameterTop: 0.32,
        diameterBottom: 0.56,
        height: 0.18,
        tessellation: 14,
      }, this.scene), cloth);
      mantle.position.y = 1.79;
      mantle.scaling.x = 0.82;
    }

    const leftShoulder = new TransformNode(`human-${id}-left-shoulder`, this.scene);
    const rightShoulder = new TransformNode(`human-${id}-right-shoulder`, this.scene);
    leftShoulder.position = new Vector3(0, 1.72, -0.36);
    rightShoulder.position = new Vector3(0, 1.72, 0.36);
    leftShoulder.parent = rightShoulder.parent = root;
    const leftUpperArm = this.createLimb(`human-${id}-left-upper-arm`, 0.5, 0.1, jacket, leftShoulder, echo);
    const rightUpperArm = this.createLimb(`human-${id}-right-upper-arm`, 0.5, 0.1, jacket, rightShoulder, echo);
    meshes.push(leftUpperArm, rightUpperArm);
    const leftElbow = new TransformNode(`human-${id}-left-elbow`, this.scene);
    const rightElbow = new TransformNode(`human-${id}-right-elbow`, this.scene);
    leftElbow.position.y = rightElbow.position.y = -0.48;
    leftElbow.parent = leftShoulder;
    rightElbow.parent = rightShoulder;
    const leftLowerArm = this.createLimb(`human-${id}-left-lower-arm`, 0.45, 0.08, extremity, leftElbow, echo);
    const rightLowerArm = this.createLimb(`human-${id}-right-lower-arm`, 0.45, 0.08, extremity, rightElbow, echo);
    meshes.push(leftLowerArm, rightLowerArm);
    for (const [name, elbow] of [["left", leftElbow], ["right", rightElbow]] as const) {
      const hand = MeshBuilder.CreateSphere(`human-${id}-${name}-hand`, { diameter: 0.17, segments: 10 }, this.scene);
      hand.position.y = -0.47;
      hand.material = echo ? extremity : skin;
      hand.parent = elbow;
      hand.isPickable = false;
      if (!echo) this.shadows.addShadowCaster(hand);
      meshes.push(hand);
    }

    const leftHip = new TransformNode(`human-${id}-left-hip`, this.scene);
    const rightHip = new TransformNode(`human-${id}-right-hip`, this.scene);
    leftHip.position = new Vector3(0, 0.86, -0.17);
    rightHip.position = new Vector3(0, 0.86, 0.17);
    leftHip.parent = rightHip.parent = root;
    const leftThigh = this.createLimb(`human-${id}-left-thigh`, 0.5, 0.125, cloth, leftHip, echo);
    const rightThigh = this.createLimb(`human-${id}-right-thigh`, 0.5, 0.125, cloth, rightHip, echo);
    meshes.push(leftThigh, rightThigh);
    const leftKnee = new TransformNode(`human-${id}-left-knee`, this.scene);
    const rightKnee = new TransformNode(`human-${id}-right-knee`, this.scene);
    leftKnee.position.y = rightKnee.position.y = -0.48;
    leftKnee.parent = leftHip;
    rightKnee.parent = rightHip;
    const leftShin = this.createLimb(`human-${id}-left-shin`, 0.46, 0.1, extremity, leftKnee, echo);
    const rightShin = this.createLimb(`human-${id}-right-shin`, 0.46, 0.1, extremity, rightKnee, echo);
    meshes.push(leftShin, rightShin);
    for (const [name, z] of [["left", -0.17], ["right", 0.17]] as const) {
      const boot = addBodyMesh(MeshBuilder.CreateBox(`human-${id}-${name}-boot`, { width: 0.36, depth: 0.2, height: 0.22 }, this.scene), extremity);
      boot.position = new Vector3(0.07, 0.13, z);
      const cuff = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-${name}-cuff`, {
        diameter: 0.26,
        height: 0.14,
        tessellation: 10,
      }, this.scene), extremity);
      cuff.position = new Vector3(0.02, 0.3, z);
    }
    return {
      echo,
      root,
      meshes,
      shimmer: echo && jacket.emissiveTexture instanceof Texture ? jacket.emissiveTexture : null,
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      position,
      lastPosition: position.clone(),
      gait: 0,
    };
  }

  private disposeActorVisuals(): void {
    for (const rig of this.actorVisuals.values()) {
      for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
      rig.root.dispose(false, false);
    }
    this.actorVisuals.clear();
  }

  private disposeWorld(): void {
    this.visuals.motes.dispose(true);
    this.visuals.burst.dispose(true);
    for (const mesh of this.visuals.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh);
    this.visuals.root.dispose(false, false);
    for (const chamberMaterial of this.chamberMaterials) chamberMaterial.dispose(true, true);
    this.chamberMaterials = [];
  }

  /**
   * Latches the one recording beat the guide needs. It runs per simulation tick
   * rather than per rendered frame, so a throttled or stuttering renderer reads
   * the same grip length the card does.
   */
  private trackRecordingBeats(): void {
    const state = this.simulation.state;
    if (state.phase !== "recording") return;
    if (!state.hold?.active) {
      this.traceGripStartTick = null;
      return;
    }
    this.traceGripStartTick ??= state.tapeTick;
    if (state.tapeTick - this.traceGripStartTick >= traceRequiredHoldTicks()) this.traceWinchHeldLongEnough = true;
  }

  private resetRecordingBeats(): void {
    this.traceGripStartTick = null;
    this.traceWinchHeldLongEnough = false;
  }

  private targetGuidePosition(state: Readonly<SimulationState>): Vector3 | null {
    if (state.success) return null;
    const exit = (): Vector3 => this.rectCenter(state.exit, 0.05);
    const hold = (): Vector3 | null => state.hold ? this.worldPoint(state.hold.x, state.hold.y, 0.02) : null;
    const weight = (): Vector3 | null => state.forceObject
      ? this.worldPoint(state.forceObject.x - 24, state.forceObject.y + state.forceObject.height / 2, 0.02)
      : null;
    const plate = (): Vector3 | null => state.plate ? this.rectCenter(state.plate, 0.02) : null;

    switch (state.chamberId) {
      case "awakening":
        // The plate is the only thing to do here until the door is up.
        return state.door?.open === true ? exit() : plate();
      case "secondSelf":
        return state.phase === "recording" || state.phase === "rerecord" ? plate() : exit();
      case "handNotBody":
        if (state.phase === "recording" || state.phase === "rerecord") {
          // Nothing to walk to: the recording's whole job is pressing into the
          // shut door, so point at the door the echo will pass through.
          return state.door ? this.rectCenter(state.door.rect, 0.02) : exit();
        }
        return state.exit.open ? exit() : plate();
      case "crossing":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
      case "traceWeight":
        if (state.phase === "recording" || state.phase === "rerecord") {
          // Follow the recording's own beat, not the clock: a player who grips
          // the winch generously must not be waved at the weight while the card
          // is still telling them to hold on.
          return this.traceWinchHeldLongEnough ? weight() : hold();
        }
        if (state.door && !state.door.latched) {
          return this.worldPoint(
            state.door.rect.x + state.door.rect.width + 25,
            state.door.rect.y + state.door.rect.height / 2,
            0.02,
          );
        }
        if (state.forceObject && state.forceObject.x < state.forceObject.maxX) return weight();
        return exit();
      case "handoff":
        if (!state.handoff) return exit();
        // Pass 1 is only the switch; pass 2 is the box, then the cradle.
        if (state.phase === "recording" || state.phase === "rerecord") return hold();
        if (state.handoff.delivered) return exit();
        if (state.handoff.holder === "present") return this.rectCenter(state.handoff.delivery, 0.02);
        return this.worldPoint(state.handoff.x, state.handoff.y, 0.02);
      case "lastHold":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
    }
  }

  private updateVisuals(state: Readonly<SimulationState>): void {
    this.updateBeats(state);
    const activeIds = new Set(state.actors.map((actor) => actor.id));
    for (const [id, rig] of this.actorVisuals) {
      if (activeIds.has(id)) continue;
      for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
      rig.root.dispose(false, false);
      this.actorVisuals.delete(id);
    }
    for (const actor of state.actors) {
      let rig = this.actorVisuals.get(actor.id);
      const shouldEcho = actor.id === "past" && state.phase !== "recording";
      if (rig && rig.echo !== shouldEcho) {
        for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
        rig.root.dispose(false, false);
        this.actorVisuals.delete(actor.id);
        rig = undefined;
      }
      if (!rig) {
        rig = this.createHumanoid(actor.id, shouldEcho);
        this.actorVisuals.set(actor.id, rig);
      }
      this.updateHumanoid(rig, actor);
    }

    if (this.visuals.bridge && state.door) {
      const targetY = state.door.open ? this.visuals.bridge.openY : this.visuals.bridge.closedY;
      this.visuals.bridge.root.position.y += (targetY - this.visuals.bridge.root.position.y) * 0.16;
    }
    if (this.visuals.winch && state.hold) {
      if (state.hold.active) {
        this.visuals.winch.drum.rotation.z += 0.075;
        this.visuals.winch.crank.rotation.x += 0.075;
      }
      const glow = state.hold.active ? new Color3(0.03, 0.8, 1) : new Color3(0.01, 0.18, 0.26);
      this.visuals.winch.runeMaterial.emissiveColor = glow;
      const runeScale = state.hold.active ? 1.1 + Math.sin(performance.now() * 0.012) * 0.05 : 1;
      this.visuals.winch.rune.scaling.setAll(runeScale);
    }
    if (this.visuals.plate && state.plate) {
      // Cyan when the echo is holding it down, amber for the living body: the
      // ring says which self the plate is answering to.
      const pressedByPast = state.plate.pressedBy.includes("past") && state.phase !== "recording";
      const glow = !state.plate.active
        ? new Color3(0.02, 0.16, 0.24)
        : pressedByPast
          ? new Color3(0.03, 0.8, 1)
          : new Color3(1, 0.42, 0.06);
      this.visuals.plate.ringMaterial.emissiveColor = glow;
      this.visuals.plate.pad.position.y += ((state.plate.active ? 0.03 : 0.065) - this.visuals.plate.pad.position.y) * 0.2;
    }
    if (this.visuals.weight && state.forceObject) {
      const target = this.rectCenter(state.forceObject, 0);
      this.visuals.weight.root.position = Vector3.Lerp(this.visuals.weight.root.position, target, 0.38);
      const pastContributing = state.actors.some((actor) => actor.id === "past" && actor.actionHeld && actor.targetId === state.forceObject?.id);
      const presentContributing = state.actors.some((actor) => actor.id === "present" && actor.actionHeld && actor.targetId === state.forceObject?.id);
      this.visuals.weight.cyanMaterial.emissiveColor = pastContributing ? new Color3(0.04, 0.82, 1) : new Color3(0.01, 0.12, 0.17);
      this.visuals.weight.amberMaterial.emissiveColor = presentContributing ? new Color3(1, 0.34, 0.035) : new Color3(0.14, 0.04, 0.004);
      this.visuals.weight.cyanSigil.scaling.setAll(pastContributing ? 1.12 : 1);
      this.visuals.weight.amberSigil.scaling.setAll(presentContributing ? 1.12 : 1);
    }
    if (this.visuals.handoffOrb && state.handoff) {
      const target = this.worldPoint(state.handoff.x, state.handoff.y, 0.72 + Math.sin(performance.now() * 0.004) * 0.08);
      this.visuals.handoffOrb.position = Vector3.Lerp(this.visuals.handoffOrb.position, target, 0.22);
    }
    if (this.visuals.handoffDelivery && state.handoff) {
      this.visuals.handoffDelivery.scaling.y += ((state.handoff.delivered ? 1.8 : 1) - this.visuals.handoffDelivery.scaling.y) * 0.12;
    }

    const guideTarget = this.targetGuidePosition(state);
    this.visuals.guide.root.setEnabled(Boolean(guideTarget));
    if (guideTarget) {
      this.visuals.guide.root.position = guideTarget;
      const reducedMotion = document.body.classList.contains("reduce-motion");
      const pulse = reducedMotion ? 1 : 1 + Math.sin(performance.now() * 0.006) * 0.1;
      this.visuals.guide.ring.scaling.setAll(pulse);
      this.visuals.guide.arrow.position.y = reducedMotion ? 2.15 : 2.15 + Math.sin(performance.now() * 0.004) * 0.18;
      this.visuals.guide.arrow.rotation.y += reducedMotion ? 0 : 0.012;
    }

    const exitOpen = state.exit.open;
    const present = state.actors.find((actor) => actor.id === "present");
    const focusExit = state.success || Boolean(present && present.x >= state.exit.x - 80);
    const cameraTarget = focusExit ? this.cameraFocus : this.cameraRest;
    this.camera.target = Vector3.Lerp(this.camera.target, cameraTarget, 0.12);
    const restAlpha = focusExit ? CAMERA_ALPHA_EXIT : CAMERA_ALPHA;
    this.camera.alpha += (restAlpha + this.idleDrift() - this.camera.alpha) * 0.12;
    this.camera.radius += ((focusExit ? CAMERA_RADIUS_EXIT : CAMERA_RADIUS) - this.camera.radius) * 0.12;
    const shaftReach = exitOpen ? 0.09 : 0.035;
    this.visuals.exit.light.intensity = exitOpen ? 3 + Math.sin(performance.now() * 0.004) * 0.25 : 1.1;
    this.visuals.exit.portalMaterial.emissiveColor = exitOpen ? new Color3(0.65, 0.42, 0.18) : new Color3(0.08, 0.08, 0.07);
    this.visuals.exit.portalMaterial.alpha = exitOpen ? 0.65 : 0.16;
    this.visuals.exit.slab.position.y += ((exitOpen ? -2.05 : 1.84) - this.visuals.exit.slab.position.y) * 0.12;
    this.visuals.exit.shaftMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.94, shaftReach * 0.86);
    this.visuals.exit.spillMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.9, shaftReach * 0.78);
    const beamReach = shaftReach * 1.15;
    this.visuals.exit.beamMaterial.emissiveColor = new Color3(beamReach, beamReach * 0.92, beamReach * 0.82);
  }

  /**
   * One-shot beats: the echo materialising as the tape hands over, and the ring
   * that marks a fold. Both are motion, so both sit out under reduced motion.
   */
  private updateBeats(state: Readonly<SimulationState>): void {
    const reduced = this.prefersReducedMotion();
    if (this.lastPhase === "recording" && state.phase === "replay" && !reduced) {
      const past = state.actors.find((actor) => actor.id === "past");
      if (past) {
        this.visuals.burst.emitter = this.worldPoint(past.x, past.y, 0.1);
        this.visuals.burst.manualEmitCount = 70;
        this.visuals.burst.start();
      }
    }
    this.lastPhase = state.phase;

    if (this.rippleAge >= 0) {
      this.rippleAge += 1;
      const life = this.rippleAge / 42;
      if (life >= 1 || reduced) {
        this.visuals.ripple.mesh.setEnabled(false);
        this.rippleAge = -1;
      } else {
        const spread = 0.6 + life * 5.4;
        this.visuals.ripple.mesh.scaling.set(spread, 1, spread);
        const fade = (1 - life) * 0.7;
        this.visuals.ripple.material.emissiveColor.set(fade * 0.34, fade * 0.9, fade);
      }
    }
  }

  private startFoldRipple(): void {
    if (this.prefersReducedMotion()) return;
    const present = this.simulation.state.actors.find((actor) => actor.id === "present");
    if (!present) return;
    this.visuals.ripple.mesh.position = this.worldPoint(present.x, present.y, 0.12);
    this.visuals.ripple.mesh.setEnabled(true);
    this.rippleAge = 0;
  }

  /** Slow alpha sway that only breathes under the title card. */
  private idleDrift(): number {
    if (!this.cinematicIdle || this.prefersReducedMotion()) return 0;
    return Math.sin(this.idleClock * 0.00016) * 0.075;
  }

  private prefersReducedMotion(): boolean {
    return document.body.classList.contains("reduce-motion")
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  /**
   * Frame pacing guard: sustained slow frames step the render resolution down
   * one rung rather than letting the whole scene stutter. Never steps back up —
   * a machine that failed the budget once will fail it again.
   */
  private trackFramePacing(deltaMs: number): void {
    if (this.automatedRenderInterval !== 0 || this.pausedByPlayer) return;
    if (this.scalingRung >= SCALING_LADDER.length - 1) return;
    this.recentFrameMs.push(deltaMs);
    if (this.recentFrameMs.length < SCALING_SAMPLE_WINDOW) return;
    const sorted = [...this.recentFrameMs].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.recentFrameMs = [];
    if (median <= SLOW_FRAME_MS) return;
    this.scalingRung += 1;
    const level = SCALING_LADDER[this.scalingRung] ?? 1.5;
    this.engine.setHardwareScalingLevel(level);
    if (this.scalingRung > 1) this.pipeline.samples = 1;
    console.debug(`[memory-scene] ${median.toFixed(1)}ms frames — render scale stepped to ${level}`);
  }

  private updateHumanoid(rig: HumanoidRig, actor: ActorState): void {
    const target = this.worldPoint(actor.x, actor.y, 0.12);
    const targetId = actor.targetId ?? "";
    const pushing = actor.actionHeld && targetId.includes("weight");
    const operating = actor.actionHeld && (targetId.includes("winch") || targetId.includes("hold"));
    if (pushing) {
      target.x += rig.echo ? -1.15 : -0.68;
      target.z += rig.echo ? 0.64 : -0.64;
    }
    if (operating) target.x -= actor.facingX * 0.48;
    const distance = Vector3.Distance(target, rig.lastPosition);
    const moving = distance > 0.001;
    rig.position = Vector3.Lerp(rig.position, target, 0.5);
    if (moving) rig.gait += 0.3;
    const bob = moving ? Math.abs(Math.sin(rig.gait)) * 0.052 : Math.sin(performance.now() * 0.0025) * 0.012;
    // The echo's ramp scrolls upward; a still echo is a reduced-motion echo.
    if (rig.shimmer && !this.prefersReducedMotion()) rig.shimmer.vOffset = (rig.shimmer.vOffset + 0.0022) % 1;
    rig.root.position = rig.position.add(new Vector3(0, bob, 0));
    const facing = Math.atan2(-actor.facingY, actor.facingX || 0.001);
    rig.root.rotation.y += (shortestAngle(rig.root.rotation.y, facing) - rig.root.rotation.y) * 0.28;
    rig.root.rotation.z += ((pushing ? -0.3 : operating ? -0.12 : 0) - rig.root.rotation.z) * 0.25;

    if (pushing) {
      const shoulderOffset = rig.echo ? -0.08 : 0.08;
      rig.leftShoulder.rotation.z += (1.12 + shoulderOffset - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (1.22 - shoulderOffset - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z += (-0.14 - rig.leftElbow.rotation.z) * 0.25;
      rig.rightElbow.rotation.z += (-0.22 - rig.rightElbow.rotation.z) * 0.25;
      // Lean-in: back leg straight and driving, front knee bent under the load.
      rig.leftHip.rotation.z = rig.echo ? 0.34 : -0.46;
      rig.rightHip.rotation.z = rig.echo ? -0.42 : 0.34;
      rig.leftKnee.rotation.z = rig.echo ? 0.2 : 0.46;
      rig.rightKnee.rotation.z = rig.echo ? 0.48 : 0.18;
    } else if (operating) {
      // Crouch into the winch: weight down, both hands committed to the crank.
      rig.leftShoulder.rotation.z += (0.94 - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (0.94 - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z = 0.34;
      rig.rightElbow.rotation.z = 0.34;
      rig.leftHip.rotation.z = -0.3;
      rig.rightHip.rotation.z = 0.26;
      rig.leftKnee.rotation.z = 0.42;
      rig.rightKnee.rotation.z = 0.38;
    } else if (moving) {
      const swing = Math.sin(rig.gait) * 0.72;
      rig.leftShoulder.rotation.z = swing * 0.62;
      rig.rightShoulder.rotation.z = -swing * 0.62;
      rig.leftElbow.rotation.z = Math.max(0, -swing) * 0.3;
      rig.rightElbow.rotation.z = Math.max(0, swing) * 0.3;
      rig.leftHip.rotation.z = -swing;
      rig.rightHip.rotation.z = swing;
      rig.leftKnee.rotation.z = Math.max(0, swing) * 0.55;
      rig.rightKnee.rotation.z = Math.max(0, -swing) * 0.55;
    } else {
      for (const joint of [rig.leftShoulder, rig.rightShoulder, rig.leftElbow, rig.rightElbow, rig.leftHip, rig.rightHip, rig.leftKnee, rig.rightKnee]) {
        joint.rotation.z *= 0.78;
      }
    }
    rig.lastPosition = target;
  }
}
